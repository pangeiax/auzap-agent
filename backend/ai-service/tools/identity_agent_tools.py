"""
Tools expostas ao identity_agent. Encapsulam as primitivas de identidade em
operações de alto nível que a LLM consome para conduzir o cadastro.

Princípio: a LLM decide *quando* chamar cada tool e *como* falar com o cliente;
a validação de CPF, normalização de telefone, busca de duplicata, merge e
persistência continuam determinísticos aqui.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import logging
import redis as sync_redis

from config import REDIS_HOST, REDIS_PASSWORD, REDIS_PORT
from db import get_connection
from tools.identity_tools import (
    client_has_active_appointments_or_lodgings,
    digits_only,
    extract_identity_llm,
    fetch_pets_and_upcoming,
    find_other_client_by_identity,
    looks_like_br_mobile,
    merge_clients,
    normalize_br_phone,
    resolve_identity_phone,
    sanitize_extracted_name,
    update_client_identity,
    valid_cpf,
)


def _partial_key(company_id: int, client_phone: str) -> str:
    return f"identity_partial:{company_id}:{client_phone}"


def _read_partial(company_id: int, client_phone: str) -> dict:
    """Lê dados parciais acumulados de cadastro (sync, pra ser chamado de tools Agno)."""
    try:
        r = sync_redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            password=REDIS_PASSWORD or None,
            decode_responses=True,
        )
        raw = r.get(_partial_key(company_id, client_phone))
        r.close()
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return data if isinstance(data, dict) else {}
    except Exception:
        logger.warning("identity_partial | falha ao ler", exc_info=True)
        return {}


def _write_partial(company_id: int, client_phone: str, partial: dict) -> None:
    try:
        r = sync_redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            password=REDIS_PASSWORD or None,
            decode_responses=True,
        )
        r.set(
            _partial_key(company_id, client_phone),
            json.dumps(partial, ensure_ascii=False),
            ex=60 * 60 * 24,
        )
        r.close()
    except Exception:
        logger.warning("identity_partial | falha ao gravar", exc_info=True)


def _delete_partial(company_id: int, client_phone: str) -> None:
    try:
        r = sync_redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            password=REDIS_PASSWORD or None,
            decode_responses=True,
        )
        r.delete(_partial_key(company_id, client_phone))
        r.close()
    except Exception:
        logger.warning("identity_partial | falha ao limpar", exc_info=True)

logger = logging.getLogger("ai-service.tools.identity_agent")


def _run_sync(coro):
    """
    Executa coroutine de dentro de uma tool síncrona (Agno). Quando há um event
    loop já rodando (FastAPI), roda o coroutine numa thread separada para evitar
    `RuntimeError: asyncio.run() cannot be called from a running event loop`.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        # Sem loop ativo na thread atual — pode usar asyncio.run direto.
        return asyncio.run(coro)
    # Há loop rodando — delega para uma thread sem loop.
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(asyncio.run, coro)
        return future.result()


def preprocess_identity_message(
    company_id: int,
    client_phone: str,
    client: dict,
    message_text: str,
) -> dict:
    """
    Roda DETERMINISTICAMENTE a extração da mensagem atual + leitura dos
    parciais já acumulados em Redis e retorna o snapshot consolidado.

    Chamado pelo router antes de invocar o identity_agent — garante que a
    memória entre turnos é determinística (não depende do LLM lembrar de
    chamar `parse_personal_data`).

    Atualiza o Redis com o novo snapshot e retorna:
        {full_name, email, phone, cpf_digits, this_turn_extracted,
         cpf_invalid, reroute_cpf_to_phone, missing}
    """
    msg = (message_text or "").strip()
    extracted: dict = {}
    if msg:
        try:
            extracted = _run_sync(
                extract_identity_llm(msg, company_id=company_id)
            ) or {}
        except Exception:
            logger.exception("preprocess_identity_message | extract LLM falhou")
            extracted = {}

    new_name = (extracted.get("full_name") or "").strip()
    new_cpf = digits_only(str(extracted.get("cpf_digits") or ""))
    new_email = (extracted.get("email") or "").strip()
    new_phone_raw = str(extracted.get("phone_raw") or "")

    cpf_invalid = bool(new_cpf) and not valid_cpf(new_cpf)
    reroute = False
    if cpf_invalid and looks_like_br_mobile(new_cpf):
        if not new_phone_raw:
            new_phone_raw = new_cpf
        new_cpf = ""
        cpf_invalid = False
        reroute = True

    new_name = sanitize_extracted_name(new_name, client.get("name"))
    phone_norm, _ = resolve_identity_phone(new_phone_raw, msg, new_cpf)

    partial = _read_partial(company_id, client_phone)

    merged = {
        "full_name": (
            (client.get("name") or "") or partial.get("full_name", "")
        ),
        "email": (
            (client.get("email") or "") or partial.get("email", "")
        ),
        "phone": (
            (client.get("manual_phone") or "") or partial.get("phone", "")
        ),
        "cpf_digits": (
            (client.get("cpf") or "") or partial.get("cpf_digits", "")
        ),
    }
    if new_name:
        merged["full_name"] = new_name
    if new_email:
        merged["email"] = new_email
    if phone_norm:
        merged["phone"] = phone_norm
    if new_cpf and valid_cpf(new_cpf):
        merged["cpf_digits"] = new_cpf

    _write_partial(company_id, client_phone, {
        "full_name": merged["full_name"],
        "email": merged["email"],
        "phone": merged["phone"],
        "cpf_digits": merged["cpf_digits"],
    })

    missing: list[str] = []
    if not merged["full_name"]:
        missing.append("nome completo")
    if not merged["email"]:
        missing.append("e-mail")
    if not merged["phone"]:
        missing.append("telefone")
    if not merged["cpf_digits"] or not valid_cpf(merged["cpf_digits"]):
        missing.append("cpf")

    # Auto-save: quando temos todos os 4 campos, persistimos imediatamente sem
    # depender do LLM chamar `save_identity`. Modelos pequenos (mini/nano) erram
    # essa chamada com frequência; deixar determinístico evita o cliente ficar
    # preso em loop de "manda os dados".
    autosave_result: dict | None = None
    if not missing and client_phone:
        # Lookup do client_id atual do banco (caso ainda não exista no `client`).
        client_id_for_save = client.get("id")
        if not client_id_for_save:
            try:
                with get_connection() as conn:
                    cur = conn.cursor()
                    cur.execute(
                        "SELECT id::text AS id FROM clients WHERE company_id=%s AND phone=%s LIMIT 1",
                        (company_id, client_phone),
                    )
                    row = cur.fetchone()
                    client_id_for_save = row["id"] if row else None
                    # Cliente ainda não existe no banco (caso comum quando o
                    # /run é chamado sem o webhook ter rodado antes — em
                    # produção, o webhook do Baileys cria o registro). Cria um
                    # cadastro mínimo aqui pra que a persistência funcione.
                    if not client_id_for_save:
                        cur.execute(
                            """
                            INSERT INTO clients (company_id, phone, conversation_stage, last_message_at, is_active)
                            VALUES (%s, %s, 'initial', NOW(), TRUE)
                            ON CONFLICT (company_id, phone) DO UPDATE SET last_message_at = NOW()
                            RETURNING id::text AS id
                            """,
                            (company_id, client_phone),
                        )
                        new_row = cur.fetchone()
                        client_id_for_save = new_row["id"] if new_row else None
                        logger.info(
                            "preprocess autosave | criou cliente novo id=%s phone=%s",
                            client_id_for_save, client_phone,
                        )
            except Exception:
                logger.exception("preprocess autosave | falha ao buscar/criar client_id")
                client_id_for_save = None

        if client_id_for_save:
            try:
                # Procura duplicata por CPF/telefone normalizado.
                other_id = find_other_client_by_identity(
                    company_id=company_id,
                    current_id=str(client_id_for_save),
                    cpf=merged["cpf_digits"],
                    phone_norm=merged["phone"],
                )
                merged_dup = False
                if other_id:
                    # GUARDRAIL: silent merge nunca apaga cadastro com agendamentos
                    # futuros ou hospedagens ativas. Em produção, o caso legítimo
                    # (cliente migrando de plataforma) tem pets/histórico mas raramente
                    # agendamentos futuros — e bloquear esse caso evita perda de
                    # dados quando há colisão acidental de CPF/telefone (testes,
                    # cadastros bagunçados, fraude).
                    if client_has_active_appointments_or_lodgings(
                        company_id, str(other_id)
                    ):
                        logger.warning(
                            "preprocess autosave | merge BLOQUEADO | "
                            "remove_id=%s tem agendamentos/hospedagens ativos. "
                            "CPF/telefone colidindo com cadastro vivo — "
                            "precisa de intervenção humana.",
                            other_id,
                        )
                        autosave_result = {
                            "saved": False,
                            "error": "CPF ou telefone já está cadastrado para outro cliente com agendamento ativo. Precisa de atendente humano para resolver.",
                            "needs_human": True,
                        }
                        return {
                            **merged,
                            "this_turn_extracted": {
                                "full_name": new_name,
                                "email": new_email,
                                "phone": phone_norm,
                                "cpf_digits": new_cpf if (new_cpf and valid_cpf(new_cpf)) else "",
                            },
                            "cpf_invalid": cpf_invalid,
                            "reroute_cpf_to_phone": reroute,
                            "missing": missing,
                            "autosave": autosave_result,
                        }
                    else:
                        try:
                            merge_clients(company_id, str(client_id_for_save), str(other_id))
                            merged_dup = True
                        except Exception:
                            logger.exception("preprocess autosave | merge falhou")

                update_client_identity(
                    company_id,
                    str(client_id_for_save),
                    name=merged["full_name"],
                    email=merged["email"],
                    cpf=merged["cpf_digits"],
                    manual_phone=merged["phone"],
                )
                _delete_partial(company_id, client_phone)

                try:
                    pets, appts = fetch_pets_and_upcoming(company_id, str(client_id_for_save))
                except Exception:
                    pets, appts = [], []

                autosave_result = {
                    "saved": True,
                    "merged_with_existing": merged_dup,
                    "existing_pets": pets,
                    "existing_appointments": [
                        {
                            "scheduled_date": (
                                a["scheduled_date"].isoformat()
                                if hasattr(a.get("scheduled_date"), "isoformat")
                                else str(a.get("scheduled_date"))
                            ),
                            "status": a.get("status"),
                            "service_name": a.get("service_name"),
                        }
                        for a in appts
                    ],
                }
                logger.info(
                    "preprocess autosave | OK | merged_dup=%s pets=%d appts=%d",
                    merged_dup, len(pets), len(appts),
                )
            except Exception:
                logger.exception("preprocess autosave | update falhou")
                autosave_result = {"saved": False, "error": "Falha ao gravar no banco"}

    return {
        **merged,
        "this_turn_extracted": {
            "full_name": new_name,
            "email": new_email,
            "phone": phone_norm,
            "cpf_digits": new_cpf if (new_cpf and valid_cpf(new_cpf)) else "",
        },
        "cpf_invalid": cpf_invalid,
        "reroute_cpf_to_phone": reroute,
        "missing": missing,
        "autosave": autosave_result,
    }


def _clear_redis_for_client(company_id: int, client_phone: str) -> None:
    """Limpa chaves Redis do cliente (histórico/router_ctx) — usado em escalate."""
    try:
        r = sync_redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            password=REDIS_PASSWORD or None,
            decode_responses=True,
        )
        for key in (
            f"chat:{company_id}:{client_phone}",
            f"chat_router_ctx:{company_id}:{client_phone}",
            f"chat_summary:{company_id}:{client_phone}",
            f"identity_mig:{company_id}:{client_phone}",
        ):
            r.delete(key)
        r.close()
    except Exception:
        logger.warning("identity_agent | falha ao limpar Redis", exc_info=True)


def build_identity_agent_tools(
    company_id: int,
    client_id: str,
    client_phone: str,
    known_identity: dict,
) -> list:
    """
    Constrói as tools do identity_agent com IDs pré-vinculados via closure.

    `known_identity` é o snapshot já no banco (nome, email, manual_phone, cpf)
    no início do turno — evita que a LLM precise consultar o banco para saber
    o que já existe.
    """

    def parse_personal_data(message_text: str) -> dict:
        """
        Extrai dados pessoais (nome completo, e-mail, telefone, CPF) da mensagem
        do cliente. Os campos extraídos são MESCLADOS automaticamente com
        parciais já acumulados de turnos anteriores e persistidos — você não
        precisa lembrar entre turnos.

        Retorna um JSON com:
          • full_name, email, phone, cpf_digits — VALORES ACUMULADOS (banco +
            todos os parciais já vistos + esta mensagem)
          • this_turn_extracted — só o que veio nesta mensagem
          • cpf_invalid — true se o CPF desta mensagem é inválido
          • reroute_cpf_to_phone — true se o "CPF" era na verdade telefone
          • missing — lista de campos ainda em branco após a mesclagem
                     (use para decidir o que pedir ou se chama save_identity)
        """
        if not message_text or not message_text.strip():
            message_text = ""

        extracted = _run_sync(extract_identity_llm(message_text, company_id=company_id)) if message_text else {}

        new_name = (extracted.get("full_name") or "").strip()
        new_cpf = digits_only(str(extracted.get("cpf_digits") or ""))
        new_email = (extracted.get("email") or "").strip()
        new_phone_raw = str(extracted.get("phone_raw") or "")

        cpf_invalid = bool(new_cpf) and not valid_cpf(new_cpf)
        reroute = False
        if cpf_invalid and looks_like_br_mobile(new_cpf):
            if not new_phone_raw:
                new_phone_raw = new_cpf
            new_cpf = ""
            cpf_invalid = False
            reroute = True

        new_name = sanitize_extracted_name(new_name, known_identity.get("name"))

        phone_norm, _manual_display = resolve_identity_phone(
            new_phone_raw, message_text, new_cpf
        )

        # Mescla com parciais acumulados de turnos anteriores. Campos do banco
        # têm prioridade BAIXA (já estão no known_identity). Parciais > mensagem
        # nova só pra campos vazios — campos preenchidos sobrescrevem.
        partial = _read_partial(company_id, client_phone)

        # Snapshot: banco → parciais acumulados → extração desta mensagem
        merged = {
            "full_name": (
                known_identity.get("name", "") or partial.get("full_name", "")
            ),
            "email": (
                known_identity.get("email", "") or partial.get("email", "")
            ),
            "phone": (
                known_identity.get("manual_phone", "") or partial.get("phone", "")
            ),
            "cpf_digits": (
                known_identity.get("cpf", "") or partial.get("cpf_digits", "")
            ),
        }
        # Aplica o que veio agora (sobrescreve só se não vazio)
        if new_name:
            merged["full_name"] = new_name
        if new_email:
            merged["email"] = new_email
        if phone_norm:
            merged["phone"] = phone_norm
        if new_cpf and valid_cpf(new_cpf):
            merged["cpf_digits"] = new_cpf

        # Persiste os parciais novos pra próximo turno (se save_identity falhar)
        _write_partial(company_id, client_phone, {
            "full_name": merged["full_name"],
            "email": merged["email"],
            "phone": merged["phone"],
            "cpf_digits": merged["cpf_digits"],
        })

        missing: list[str] = []
        if not merged["full_name"]:
            missing.append("nome completo")
        if not merged["email"]:
            missing.append("e-mail")
        if not merged["phone"]:
            missing.append("telefone")
        if not merged["cpf_digits"] or not valid_cpf(merged["cpf_digits"]):
            missing.append("cpf")

        return {
            **merged,
            "this_turn_extracted": {
                "full_name": new_name,
                "email": new_email,
                "phone": phone_norm,
                "cpf_digits": new_cpf if (new_cpf and valid_cpf(new_cpf)) else "",
            },
            "cpf_invalid": cpf_invalid,
            "reroute_cpf_to_phone": reroute,
            "missing": missing,
        }

    def save_identity(
        full_name: str = "",
        email: str = "",
        phone: str = "",
        cpf: str = "",
    ) -> dict:
        """
        Persiste o cadastro do cliente. Pode ser chamada com strings vazias —
        a tool une o que você passa com os parciais acumulados em Redis (de
        turnos anteriores via `parse_personal_data`) e com o snapshot do banco.
        Só persiste quando os 4 campos finais estão completos e válidos.

        Retorna:
            success: bool
            error: descrição do que faltou (se success=False)
            missing: lista de campos ainda em branco
            merged_with_existing: true se uniu com cadastro antigo
            existing_pets: pets já cadastrados (após eventual merge)
            existing_appointments: agendamentos futuros (após merge)

        Após success=True, os parciais Redis são limpos. A próxima ação do
        cliente (agendar, etc.) pode ser executada normalmente.
        """
        if not client_id:
            return {"success": False, "error": "client_id ausente; não é possível salvar."}

        partial = _read_partial(company_id, client_phone)

        # Mesclagem: argumento explícito > parcial Redis > banco (known_identity).
        full_name = (full_name or "").strip() or (partial.get("full_name") or "") or (known_identity.get("name") or "")
        email = (email or "").strip() or (partial.get("email") or "") or (known_identity.get("email") or "")
        phone_in = (phone or "").strip() or (partial.get("phone") or "") or (known_identity.get("manual_phone") or "")
        cpf_in = (cpf or "").strip() or (partial.get("cpf_digits") or "") or (known_identity.get("cpf") or "")

        full_name = full_name.strip()
        email = email.strip()
        phone_norm = normalize_br_phone(phone_in)
        cpf_digits = digits_only(cpf_in)

        missing: list[str] = []
        if not full_name:
            missing.append("full_name")
        if not email:
            missing.append("email")
        if not phone_norm:
            missing.append("phone")
        if not cpf_digits or not valid_cpf(cpf_digits):
            missing.append("cpf")

        if missing:
            return {
                "success": False,
                "error": f"Dados incompletos/inválidos: {', '.join(missing)}",
                "missing": missing,
            }

        # Procura duplicata por CPF ou telefone normalizado.
        try:
            other_id = find_other_client_by_identity(
                company_id=company_id,
                current_id=str(client_id),
                cpf=cpf_digits,
                phone_norm=phone_norm,
            )
        except Exception:
            logger.exception("save_identity | falha ao procurar duplicata")
            other_id = None

        merged = False
        if other_id:
            try:
                merge_clients(company_id, str(client_id), str(other_id))
                merged = True
            except Exception:
                logger.exception("save_identity | merge falhou (seguindo sem merge)")

        try:
            update_client_identity(
                company_id,
                str(client_id),
                name=full_name,
                email=email,
                cpf=cpf_digits,
                manual_phone=phone_norm,
            )
        except Exception:
            logger.exception("save_identity | update_client_identity falhou")
            return {"success": False, "error": "Falha ao gravar no banco."}

        # Cadastro persistido — limpa parciais Redis pra não vazar pro próximo fluxo.
        _delete_partial(company_id, client_phone)

        try:
            pets, appts = fetch_pets_and_upcoming(company_id, str(client_id))
        except Exception:
            logger.exception("save_identity | fetch_pets_and_upcoming falhou")
            pets, appts = [], []

        return {
            "success": True,
            "merged_with_existing": merged,
            "existing_pets": pets,
            "existing_appointments": [
                {
                    "scheduled_date": (
                        a["scheduled_date"].isoformat()
                        if hasattr(a.get("scheduled_date"), "isoformat")
                        else str(a.get("scheduled_date"))
                    ),
                    "status": a.get("status"),
                    "service_name": a.get("service_name"),
                }
                for a in appts
            ],
        }

    def escalate_due_to_refusal(reason: str) -> dict:
        """
        Use quando o cliente RECUSA terminantemente o cadastro depois que você
        já explicou por que ele é necessário, ou quando você percebe que o
        cliente está em uma situação delicada (ex.: pet em hotel agora, urgência
        médica) e o cadastro vai atrapalhar — escala para humano e pausa a IA.

        NÃO use no primeiro sinal de relutância — explique uma vez e dê chance
        do cliente seguir. Só escale se ele insistir em recusar.
        """
        reason = (reason or "Cliente recusou o cadastro / não foi possível concluir.").strip()
        if not client_id:
            return {"success": False, "error": "client_id ausente."}
        try:
            with get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    UPDATE clients
                    SET ai_paused = TRUE,
                        ai_paused_at = NOW(),
                        ai_pause_reason = %s
                    WHERE id = %s::uuid AND company_id = %s
                    """,
                    (f"[IDENTITY] {reason}", str(client_id), company_id),
                )
        except Exception:
            logger.exception("escalate_due_to_refusal | falha no UPDATE")
            return {"success": False, "error": "Falha ao pausar IA."}

        _clear_redis_for_client(company_id, client_phone)
        return {"success": True, "reason": reason}

    return [parse_personal_data, save_identity, escalate_due_to_refusal]
