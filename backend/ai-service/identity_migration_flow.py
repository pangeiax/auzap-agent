"""
Fluxo determinístico de recadastro (WhatsApp) quando manual_phone e cpf estão vazios.
Mensagens fixas, escalação em recusa ou menção a serviço em andamento, deduplicação e merge.
"""

from __future__ import annotations

import json
import logging
import os
import random
import re
from typing import Any

from openai import AsyncOpenAI

from config import resolve_model_for_company
from db import get_connection
from memory.redis_memory import (
    clear_identity_migration_phase,
    get_identity_migration_data,
    get_identity_migration_phase,
    set_identity_migration_phase,
)
from tools.escalation_tools import build_escalation_tools

logger = logging.getLogger("ai-service.identity_migration")


async def _redis_clear_best_effort(company_id: int, client_phone: str) -> None:
    try:
        await clear_identity_migration_phase(company_id, client_phone)
    except Exception:
        logger.warning(
            "identity_migration | falha ao limpar fase Redis (ignorado)",
            exc_info=True,
        )


async def _redis_set_or_abort(
    company_id: int, client_phone: str, phase: str, partial: dict | None = None
) -> bool:
    try:
        await set_identity_migration_phase(company_id, client_phone, phase, partial)
        return True
    except Exception:
        logger.exception(
            "identity_migration | falha ao gravar fase Redis — abortando fluxo dedicado"
        )
        return False


async def _redis_set_completed_best_effort(
    company_id: int, client_phone: str
) -> None:
    try:
        await set_identity_migration_phase(company_id, client_phone, "completed")
    except Exception:
        logger.warning(
            "identity_migration | falha ao marcar completed no Redis",
            exc_info=True,
        )


WELCOME_MESSAGE = (
    "Opa, tudo bem? 😊 Que bom te ver por aqui!  Se você é cliente antigo: pedimos desculpas, "
    "mas estamos migrando de plataforma e precisamos te recadastrar — você e seu pet.  "
    "Se você é cliente novo: seja bem-vindo(a)! Vamos fazer seu cadastro agora? É rapidinho! 🐾"
)

ASK_DETAILS_MESSAGE = (
    "Me passa os dados assim (pode copiar, preencher e enviar):\n\n"
    "Nome completo:\n"
    "E-mail:\n"
    "Telefone:\n"
    "CPF:\n\n"
    "No telefone use DDD + número (ex.: 11 99999-9999). "
    "É importante que o telefone seja diferente do CPF.\n\n"
    "(Sobre o pet: se você já for cliente, a gente localiza pelos seus dados; se for novo, "
    "cadastramos o pet no passo seguinte.)"
)

REFUSE_MARKERS = (
    "não quero",
    "nao quero",
    "prefiro não",
    "prefiro nao",
    "não vou",
    "nao vou",
    "sem cadastro",
    "não obrigado",
    "nao obrigado",
    "dispenso",
    "não preciso",
    "nao preciso",
    "cancela",
    "desisto",
)

IN_SERVICE_MARKERS = (
    "buscar meu pet",
    "buscar o pet",
    "pegar meu pet",
    "indo buscar",
    "como está meu pet",
    "como esta meu pet",
    "como ta meu pet",
    "meu pet aí",
    "meu pet ai",
    "pet no hotel",
    "no hotel",
    "na creche",
    "pet na creche",
    "deixei o pet",
    "pet aí na",
    "pet ai na",
    "como está o pet",
    "como ta o pet",
)


def _digits_only(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def _valid_cpf(cpf: str) -> bool:
    if len(cpf) != 11 or cpf == cpf[0] * 11:
        return False

    def _d(base: str, factor: int) -> int:
        s = sum(int(base[i]) * (factor - i) for i in range(len(base)))
        m = (s * 10) % 11
        return 0 if m == 10 else m

    if _d(cpf[:9], 10) != int(cpf[9]):
        return False
    if _d(cpf[:10], 11) != int(cpf[10]):
        return False
    return True


def _normalize_br_phone(digits: str) -> str:
    """Só retorna telefone BR com código 55 + DDD + número (12 ou 13 dígitos totais)."""
    d = _digits_only(digits)
    if not d:
        return ""
    if d.startswith("55") and len(d) in (12, 13):
        return d
    if len(d) in (10, 11):
        return "55" + d
    return ""


def _is_valid_normalized_br_phone(phone_norm: str) -> bool:
    return bool(_normalize_br_phone(phone_norm))


# DDDs válidos no Brasil. Usado pra distinguir "11 dígitos que parecem celular"
# de "11 dígitos que são CPF inválido" — sem essa validação, qualquer número de
# 11 dígitos passa como telefone e um CPF errado acaba reclassificado como phone.
_VALID_BR_DDDS = frozenset({
    "11", "12", "13", "14", "15", "16", "17", "18", "19",
    "21", "22", "24", "27", "28",
    "31", "32", "33", "34", "35", "37", "38",
    "41", "42", "43", "44", "45", "46", "47", "48", "49",
    "51", "53", "54", "55",
    "61", "62", "63", "64", "65", "66", "67", "68", "69",
    "71", "73", "74", "75", "77", "79",
    "81", "82", "83", "84", "85", "86", "87", "88", "89",
    "91", "92", "93", "94", "95", "96", "97", "98", "99",
})


def _looks_like_br_mobile(digits: str) -> bool:
    """True se o número bate com padrão de celular BR: DDD válido + 9 inicial após DDD."""
    d = _digits_only(digits)
    if d.startswith("55") and len(d) == 13:
        d = d[2:]
    if len(d) != 11:
        return False
    return d[:2] in _VALID_BR_DDDS and d[2] == "9"


def _phone_norm_collides_with_cpf(phone_norm: str, cpf: str) -> bool:
    """Evita salvar o CPF (ou 55+CPF) como telefone."""
    if len(cpf) != 11 or not phone_norm:
        return False
    d = _digits_only(phone_norm)
    if d == "55" + cpf:
        return True
    if len(d) == 11 and d == cpf:
        return True
    return False


def _text_scrub_cpf(msg: str, cpf: str) -> str:
    if len(cpf) != 11:
        return msg
    t = msg
    t = t.replace(cpf, " ")
    t = t.replace(f"{cpf[:3]}.{cpf[3:6]}.{cpf[6:9]}-{cpf[9:]}", " ")
    t = t.replace(f"{cpf[:3]}.{cpf[3:6]}.{cpf[6:9]}.{cpf[9:]}", " ")
    return t


def _extract_phone_from_message(msg: str, cpf: str) -> tuple[str, str]:
    """
    Tenta achar telefone na mensagem sem juntar todos os dígitos (evita CPF + números do e-mail).
    Retorna (phone_norm, texto_para_manual_phone) ou ('', '').
    """
    scrubbed = _text_scrub_cpf(msg, cpf)
    # 1. Label explícito: "telefone: ..."
    m = re.search(
        r"(?:telefone|celular|whatsapp|fone)\s*[:.]?\s*([\d\s().\-+]{10,22})",
        scrubbed,
        re.I,
    )
    if m:
        raw = m.group(1).strip()
        n = _normalize_br_phone(raw)
        if _is_valid_normalized_br_phone(n) and not _phone_norm_collides_with_cpf(n, cpf):
            return n, raw
    # 2. Linha isolada que parece telefone
    for line in scrubbed.splitlines():
        line = line.strip()
        if not line or "@" in line:
            continue
        if re.match(r"^(?:e-?mail|email|cpf|nome\s*completo)\s*:", line, re.I):
            continue
        if re.match(r"^(?:cpf)\s*[:.]?\s*\d", line, re.I):
            continue
        n = _normalize_br_phone(line)
        if _is_valid_normalized_br_phone(n) and not _phone_norm_collides_with_cpf(n, cpf):
            return n, line
    # 3. Número solto no meio do texto (10-11 dígitos, possivelmente com espaços/hífens)
    for m in re.finditer(r"(?<!\d)([\d\s().\-]{10,16})(?!\d)", scrubbed):
        raw = m.group(1).strip()
        n = _normalize_br_phone(raw)
        if _is_valid_normalized_br_phone(n) and not _phone_norm_collides_with_cpf(n, cpf):
            return n, raw
    return "", ""


def _resolve_identity_phone(phone_raw: str, user_message: str, cpf: str) -> tuple[str, str]:
    """
    Define telefone normalizado (55...) e valor amigável para manual_phone.
    Nunca usa a concatenação de todos os dígitos da mensagem inteira.
    """
    pr = (phone_raw or "").strip()
    if pr:
        n = _normalize_br_phone(pr)
        if (
            _is_valid_normalized_br_phone(n)
            and not _phone_norm_collides_with_cpf(n, cpf)
        ):
            return n, pr
    n2, raw2 = _extract_phone_from_message(user_message, cpf)
    if n2:
        return n2, raw2.strip() if raw2.strip() else n2
    return "", ""


def _consent_classify(msg: str) -> str | None:
    t = (msg or "").strip().lower()
    if any(m in t for m in REFUSE_MARKERS):
        return "refuse"
    if t in ("não", "nao", "n"):
        return "refuse"
    accept_starts = (
        "sim",
        "claro",
        "pode",
        "vamos",
        "quero",
        "beleza",
        "ok",
        "isso",
        "bora",
        "ajuda",
        "com certeza",
        "pode ser",
    )
    for a in accept_starts:
        if t == a or t.startswith(a + " ") or t.startswith(a + ","):
            return "accept"
    if "sim" in t and len(t) < 50:
        return "accept"
    return None


def _in_service_message(msg: str) -> bool:
    t = (msg or "").strip().lower()
    return any(m in t for m in IN_SERVICE_MARKERS)


def _run_escalate(company_id: int, client_id: str, summary: str, last_message: str) -> None:
    tools = build_escalation_tools(company_id, str(client_id))
    if not tools:
        return
    fn = tools[0]
    out = fn(summary=summary, last_message=last_message)
    logger.info("identity_migration escalate | success=%s", out.get("success"))


def _find_other_client_by_identity(
    company_id: int,
    current_id: str,
    cpf: str,
    phone_norm: str,
) -> str | None:
    has_cpf = bool(cpf)
    has_phone = bool(phone_norm)
    if not has_cpf and not has_phone:
        return None
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id::text AS id
            FROM clients
            WHERE company_id = %s
              AND id <> %s::uuid
              AND (
                (%s AND cpf IS NOT NULL AND TRIM(cpf) <> '' AND cpf = %s)
                OR (
                  %s
                  AND regexp_replace(COALESCE(manual_phone, ''), '[^0-9]', '', 'g') = %s
                )
                OR (
                  %s
                  AND phone ~ '^[0-9]+$'
                  AND regexp_replace(phone, '[^0-9]', '', 'g') = %s
                )
              )
            LIMIT 1
            """,
            (
                company_id,
                current_id,
                has_cpf,
                cpf,
                has_phone,
                phone_norm,
                has_phone,
                phone_norm,
            ),
        )
        row = cur.fetchone()
        return row["id"] if row else None


def _merge_clients(company_id: int, keep_id: str, remove_id: str) -> None:
    updates: list[tuple[str, str]] = [
        ("petshop_pets", "client_id"),
        ("petshop_appointments", "client_id"),
        ("petshop_lodgings", "client_id"),
        ("petshop_lodging_reservations", "client_id"),
        ("agent_conversations", "client_id"),
        ("whatsapp_contacts", "client_id"),
    ]
    with get_connection() as conn:
        cur = conn.cursor()
        for table, col in updates:
            cur.execute(
                f"UPDATE {table} SET {col} = %s WHERE {col} = %s::uuid AND company_id = %s",
                (keep_id, remove_id, company_id),
            )
        cur.execute(
            "DELETE FROM clients WHERE id = %s::uuid AND company_id = %s",
            (remove_id, company_id),
        )


def _update_client_identity(
    company_id: int,
    client_id: str,
    *,
    name: str | None,
    email: str | None,
    cpf: str,
    manual_phone: str,
) -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE clients
            SET name = COALESCE(%s, name),
                email = COALESCE(%s, email),
                cpf = %s,
                manual_phone = %s,
                updated_at = NOW()
            WHERE id = %s::uuid AND company_id = %s
            """,
            (name, email, cpf, manual_phone, client_id, company_id),
        )


def _fetch_pets_and_upcoming(company_id: int, client_id: str) -> tuple[list[dict], list[dict]]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT name, species, breed
            FROM petshop_pets
            WHERE company_id = %s AND client_id = %s::uuid AND is_active = TRUE
            ORDER BY name
            """,
            (company_id, client_id),
        )
        pets = [dict(r) for r in cur.fetchall()]
        cur.execute(
            """
            SELECT a.scheduled_date, a.status, s.name AS service_name
            FROM petshop_appointments a
            JOIN petshop_services s ON s.id = a.service_id
            WHERE a.client_id = %s::uuid
              AND a.cancelled_at IS NULL
              AND a.scheduled_date >= CURRENT_DATE
            ORDER BY a.scheduled_date ASC
            LIMIT 8
            """,
            (client_id,),
        )
        appts = [dict(r) for r in cur.fetchall()]
    return pets, appts


def _format_found_reply(pets: list[dict], appts: list[dict]) -> str:
    lines = [
        "Encontramos seu cadastro na nossa base! 🎉",
        "",
    ]
    if pets:
        lines.append("Seus pets:")
        for p in pets:
            sp = (p.get("species") or "").strip()
            lines.append(f"• {p.get('name') or 'Pet'}" + (f" ({sp})" if sp else ""))
        lines.append("")
    else:
        lines.append("Ainda não há pets cadastrados para esse cadastro.")
        lines.append("")
    if appts:
        lines.append("Próximos agendamentos:")
        for a in appts:
            d = a.get("scheduled_date")
            ds = d.isoformat() if hasattr(d, "isoformat") else str(d)
            lines.append(
                f"• {ds} — {(a.get('service_name') or 'Serviço').strip()} ({(a.get('status') or '').strip()})"
            )
    else:
        lines.append("Não há agendamentos futuros registrados.")
    lines.append("")
    lines.append("Se quiser marcar banho, tosa ou outro serviço, é só dizer!")
    return "\n".join(lines)


def _supplement_identity_from_text(raw: str, data: dict[str, Any]) -> dict[str, Any]:
    """Completa campos se o modelo falhou mas o texto tem padrões óbvios."""
    out = dict(data)
    text = raw or ""
    if not (out.get("email") or "").strip():
        m = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text)
        if m:
            out["email"] = m.group(0).strip()
    if not (out.get("cpf_digits") or "").strip():
        m = re.search(r"(?:cpf|CPF)\s*[:.]?\s*([\d.\-\s]{11,18})", text)
        if m:
            out["cpf_digits"] = _digits_only(m.group(1))
    if not (out.get("phone_raw") or "").strip():
        m = re.search(
            r"(?:telefone|celular|whatsapp|fone)\s*[:.]?\s*([\d\s().\-+]{10,22})",
            text,
            re.I,
        )
        if m:
            out["phone_raw"] = m.group(1).strip()
    if not (out.get("full_name") or "").strip():
        label_only = re.compile(
            r"^(?:nome\s*completo|e-?mail|telefone|cpf)\s*:?\s*$", re.I
        )
        for raw_line in (text or "").strip().splitlines():
            line = raw_line.strip()
            if not line or label_only.match(line):
                continue
            m = re.match(r"^nome\s*completo\s*:\s*(.+)$", line, re.I)
            if m and m.group(1).strip():
                out["full_name"] = m.group(1).strip()
                break
            if "@" in line:
                continue
            if len(line) < 120 and not re.match(
                r"^(?:cpf|telefone|email|e-mail)\b", line, re.I
            ):
                if len(_digits_only(line)) == 11 and _digits_only(line).isdigit():
                    continue
                out["full_name"] = line
                break
    return out


async def _extract_identity_llm(text: str, company_id: int | None = None) -> dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return _supplement_identity_from_text(text, {})
    base_model = os.getenv("OPENAI_IDENTITY_EXTRACT_MODEL", "gpt-4o-mini")
    model = resolve_model_for_company(base_model, company_id)
    client = AsyncOpenAI(api_key=api_key)
    prompt = (
        "Extraia dados pessoais do cliente para cadastro em petshop. Não peça nem invente dados de pet. "
        "Retorne apenas o que estiver EXPLICITAMENTE no texto do cliente — se algo não aparecer, deixe o campo vazio. "
        "NUNCA use palavras deste enunciado (como 'cliente', 'pessoa', 'texto', 'cpf', 'telefone') como valor de full_name. "
        "Responda só JSON com chaves: full_name (só se houver nome próprio claro), cpf_digits (11 dígitos ou vazio), "
        "email, phone_raw (apenas o trecho do TELEFONE com DDD, nunca o CPF; vazio se não houver telefone).\n"
        f"Texto do cliente:\n{text}"
    )
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            max_completion_tokens=400,
        )
        raw = (resp.choices[0].message.content or "").strip()
        data = json.loads(raw)
        base = data if isinstance(data, dict) else {}
        return _supplement_identity_from_text(text, base)
    except Exception:
        logger.exception("identity_migration LLM extract falhou")
        return _supplement_identity_from_text(text, {})


def _router_ctx_onboarding_pet(pet_name: str | None) -> dict:
    return {
        "agent": "onboarding_agent",
        "stage": "PET_REGISTRATION",
        "active_pet": (pet_name or "").strip() or None,
        "service": None,
        "date_mentioned": None,
        "selected_time": None,
        "checkin_mentioned": None,
        "checkout_mentioned": None,
        "awaiting_confirmation": False,
        "required_tools": ["pets"],
    }


def _router_ctx_after_merge(*, has_pets: bool) -> dict:
    """Cliente já existia na base: com pets segue vida normal; sem pets vai ao cadastro de pet."""
    if has_pets:
        return {
            "agent": "onboarding_agent",
            "stage": "COMPLETED",
            "active_pet": None,
            "service": None,
            "date_mentioned": None,
            "selected_time": None,
            "checkin_mentioned": None,
            "checkout_mentioned": None,
            "awaiting_confirmation": False,
            "required_tools": ["none"],
        }
    return _router_ctx_onboarding_pet(None)


async def try_handle_identity_migration(
    *,
    company_id: int,
    client_phone: str,
    user_message: str,
    context: dict,
) -> dict[str, Any] | None:
    """
    Retorna {"reply": str, "router_ctx": dict|None, "agent_used": str, "stage": str|None}
    para atalho (sem run_router), ou None para seguir o router normal.
    """
    if context.get("identity_flow_required") is not True:
        await _redis_clear_best_effort(company_id, client_phone)
        return None

    client = context.get("client") or {}
    if client.get("ai_paused"):
        return None

    client_id = client.get("id")
    if not client_id:
        return None

    try:
        phase = await get_identity_migration_phase(company_id, client_phone)
    except Exception:
        logger.exception(
            "identity_migration | Redis indisponível ao ler fase — fluxo recadastro ignorado"
        )
        return None

    # Primeiro contato do fluxo: sempre boas-vindas (ignora conteúdo da 1ª msg curta).
    if phase is None:
        if not await _redis_set_or_abort(
            company_id, client_phone, "awaiting_consent"
        ):
            return None
        return {
            "reply": WELCOME_MESSAGE,
            "router_ctx": None,
            "agent_used": "identity_migration",
            "stage": "IDENTITY_WELCOME",
        }

    if phase == "completed":
        await _redis_clear_best_effort(company_id, client_phone)
        return None

    if phase == "awaiting_consent":
        cls = _consent_classify(user_message)
        if cls == "refuse":
            _run_escalate(
                company_id,
                str(client_id),
                "Cliente recusou o recadastro na migração de plataforma.",
                user_message,
            )
            await _redis_clear_best_effort(company_id, client_phone)
            return {
                "reply": "Sem problema! Vou pedir para alguém da equipe te atender por aqui em breve.",
                "router_ctx": {
                    "agent": "escalation_agent",
                    "stage": "WELCOME",
                    "required_tools": ["none"],
                },
                "agent_used": "identity_migration",
                "stage": "IDENTITY_REFUSED",
            }
        if cls == "accept":
            if not await _redis_set_or_abort(
                company_id, client_phone, "awaiting_details"
            ):
                return None
            return {
                "reply": ASK_DETAILS_MESSAGE,
                "router_ctx": None,
                "agent_used": "identity_migration",
                "stage": "IDENTITY_ASK_DETAILS",
            }
        return {
            "reply": "Para eu continuar, pode responder se podemos fazer seu cadastro? (sim ou não)",
            "router_ctx": None,
            "agent_used": "identity_migration",
            "stage": "IDENTITY_CONSENT_CLARIFY",
        }

    if phase == "awaiting_details":
        if _in_service_message(user_message):
            _run_escalate(
                company_id,
                str(client_id),
                "Cliente em recadastro mencionou serviço em andamento (ex.: hotel/buscar pet).",
                user_message,
            )
            await _redis_clear_best_effort(company_id, client_phone)
            return {
                "reply": "Entendi! Nesse caso vou pedir para a equipe te responder com o status certinho, tá bem?",
                "router_ctx": {
                    "agent": "escalation_agent",
                    "stage": "WELCOME",
                    "required_tools": ["none"],
                },
                "agent_used": "identity_migration",
                "stage": "IDENTITY_IN_SERVICE",
            }

        # Carrega dados parciais acumulados de mensagens anteriores
        prev_partial = await get_identity_migration_data(company_id, client_phone)

        extracted = await _extract_identity_llm(user_message, company_id=company_id)
        new_name = (extracted.get("full_name") or "").strip()
        new_cpf = _digits_only(str(extracted.get("cpf_digits") or ""))
        new_email = (extracted.get("email") or "").strip() or None
        new_phone_raw = str(extracted.get("phone_raw") or "")

        # Marca tentativa de CPF inválido ANTES do reroute. Se o usuário mandou 11
        # dígitos que o LLM classificou como CPF mas os dígitos verificadores não
        # batem, queremos avisar especificamente em vez de só dizer "falta CPF".
        cpf_invalid_this_turn = bool(new_cpf) and not _valid_cpf(new_cpf)

        # Reroute ⬇️: só reclassifica CPF inválido como telefone se o número bater
        # com padrão real de celular BR (DDD válido + 9 inicial após DDD). Antes
        # qualquer 11 dígitos passava, o que silenciosamente transformava CPFs
        # digitados errado em phone_raw — o usuário ficava preso sem feedback.
        if new_cpf and not _valid_cpf(new_cpf) and _looks_like_br_mobile(new_cpf):
            if not new_phone_raw:
                new_phone_raw = new_cpf
            new_cpf = ""
            cpf_invalid_this_turn = False  # o número era telefone, não CPF errado

        # Guard anti-placeholder: rejeita "nomes" que são palavras do prompt ou lixo genérico
        _NAME_BLOCKLIST = {
            "tutor", "cliente", "pessoa", "texto", "cpf", "telefone",
            "email", "nome", "usuario", "usuário",
        }
        if new_name:
            low = new_name.lower().strip()
            # Rejeita palavras únicas do blocklist OU nome com menos de 2 palavras
            # (nome completo geralmente tem pelo menos 2 palavras)
            if low in _NAME_BLOCKLIST:
                new_name = ""
            elif len(new_name.split()) < 2 and prev_partial.get("full_name"):
                # Só substitui se prev_partial estiver vazio
                new_name = ""

        # Mescla: dados novos sobrescrevem apenas campos que vieram preenchidos
        full_name = new_name or prev_partial.get("full_name", "")
        cpf = new_cpf if (new_cpf and _valid_cpf(new_cpf)) else prev_partial.get("cpf", "")
        email = new_email or prev_partial.get("email") or None
        phone_raw = new_phone_raw or prev_partial.get("phone_raw", "")

        phone_norm, manual_display = _resolve_identity_phone(
            phone_raw, user_message, cpf
        )
        # Se não extraiu telefone desta msg, usa o acumulado
        if not phone_norm and prev_partial.get("phone_norm"):
            phone_norm = prev_partial["phone_norm"]
            manual_display = prev_partial.get("manual_display", "")

        # CPF inválido ≠ CPF faltando. Quando o usuário tentou mandar CPF mas os
        # dígitos não batem, a mensagem de "CPF" entra como aviso dedicado; nos
        # outros campos, só listamos o que realmente está faltando pra evitar
        # pedir tudo de novo.
        cpf_ok = bool(cpf) and _valid_cpf(cpf)
        missing = []
        if not full_name:
            missing.append("nome completo")
        if not email:
            missing.append("e-mail")
        if not phone_norm:
            missing.append("telefone com DDD")
        if not cpf_ok and not cpf_invalid_this_turn:
            missing.append("CPF")

        if missing or not cpf_ok:
            # Salva dados parciais no Redis para acumular entre mensagens
            partial = {
                "full_name": full_name,
                "cpf": cpf if cpf_ok else "",
                "email": email or "",
                "phone_raw": phone_raw,
                "phone_norm": phone_norm,
                "manual_display": manual_display,
            }
            await _redis_set_or_abort(company_id, client_phone, "awaiting_details", partial)

            if cpf_invalid_this_turn and not missing:
                reply = (
                    "O CPF que você enviou não parece válido (os dígitos verificadores não batem). "
                    "Pode conferir e me mandar só o CPF corrigido?"
                )
            elif cpf_invalid_this_turn:
                missing_str = ", ".join(missing)
                reply = (
                    f"O CPF que você enviou não parece válido (dígitos verificadores não batem) "
                    f"e ainda falta: {missing_str}. Me manda só esses dados, não precisa repetir o resto."
                )
            else:
                missing_str = ", ".join(missing)
                incomplete_replies = [
                    f"Só falta {missing_str}. Pode me enviar só isso?",
                    f"Ainda preciso de {missing_str}. Manda só esse dado, não precisa repetir o resto.",
                    f"Falta só {missing_str}. Pode completar?",
                    f"Recebi o resto! Agora só preciso de {missing_str}.",
                    f"Quase pronto! Me envia só {missing_str}.",
                ]
                reply = random.choice(incomplete_replies)

            return {
                "reply": reply,
                "router_ctx": None,
                "agent_used": "identity_migration",
                "stage": "IDENTITY_INCOMPLETE",
            }

        other_id = _find_other_client_by_identity(
            company_id, str(client_id), cpf, phone_norm
        )

        if other_id:
            _merge_clients(company_id, str(client_id), other_id)
            _update_client_identity(
                company_id,
                str(client_id),
                name=full_name,
                email=email,
                cpf=cpf,
                manual_phone=manual_display,
            )
            pets, appts = _fetch_pets_and_upcoming(company_id, str(client_id))
            await _redis_set_completed_best_effort(company_id, client_phone)
            if pets:
                return {
                    "reply": _format_found_reply(pets, appts),
                    "router_ctx": _router_ctx_after_merge(has_pets=True),
                    "agent_used": "identity_migration",
                    "stage": "IDENTITY_MATCHED",
                }
            # Merge sem pets — pedir cadastro de pet
            intro = (
                "Encontramos seu cadastro na nossa base! 🎉\n"
                "Cadastro atualizado com sucesso!\n\n"
                "Agora vamos cadastrar seu(s) pet(s). Me passa os dados:\n\n"
                "Nome:\n"
                "Espécie: (cachorro ou gato)\n"
                "Raça:\n"
                "Porte: P (até 7kg) | M (7-15kg) | G (15-25kg) | GG (acima de 25kg)\n\n"
                "Se tiver mais de um pet, envie os dados de cada um separadamente 😉"
            )
            return {
                "reply": intro,
                "router_ctx": _router_ctx_onboarding_pet(None),
                "agent_used": "identity_migration",
                "stage": "IDENTITY_MATCHED",
            }

        _update_client_identity(
            company_id,
            str(client_id),
            name=full_name,
            email=email,
            cpf=cpf,
            manual_phone=manual_display,
        )
        await _redis_set_completed_best_effort(company_id, client_phone)
        pets, appts = _fetch_pets_and_upcoming(company_id, str(client_id))
        if pets:
            return {
                "reply": _format_found_reply(pets, appts),
                "router_ctx": _router_ctx_after_merge(has_pets=True),
                "agent_used": "identity_migration",
                "stage": "IDENTITY_MATCHED",
            }
        intro = (
            "Perfeito, cadastro atualizado! 🐾 Agora vamos cadastrar seu pet.\n\n"
            "Me passa os dados dele(a):\n\n"
            "Nome:\n"
            "Espécie: (cachorro ou gato)\n"
            "Raça:\n"
            "Porte: P (até 7kg) | M (7-15kg) | G (15-25kg) | GG (acima de 25kg)\n\n"
            "Se tiver mais de um pet, envie os dados de cada um separadamente 😉"
        )
        return {
            "reply": intro,
            "router_ctx": _router_ctx_onboarding_pet(None),
            "agent_used": "identity_migration",
            "stage": "IDENTITY_NEW",
        }

    return None
