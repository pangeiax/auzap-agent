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
    get_history,
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

_WELCOME_CONTEXTUAL_PROMPT = (
    "Você é atendente humana de petshop no WhatsApp. Gere UMA mensagem curta (máx 3 linhas) que:\n"
    "1) Reconheça o que o cliente acabou de pedir/perguntar (use o HISTÓRICO e a mensagem atual).\n"
    "2) Explique de forma educada e natural que para avançar (agendar, consultar histórico, etc.) "
    "precisamos fazer um cadastro rápido — se for cliente antigo, avise que é por causa da migração de plataforma.\n"
    "3) Convide a iniciar o cadastro agora (sem ainda pedir os campos — só o convite).\n"
    "Regras: nunca diga que é IA/bot; não invente preços, horários nem detalhes de serviço; sem markdown; "
    "no máximo 1 emoji; tom caloroso e informal brasileiro; sem repetir exatamente a resposta anterior da atendente."
)


async def _build_contextual_welcome(
    company_id: int, client_phone: str, user_message: str
) -> str | None:
    """
    Gera welcome contextual via LLM quando já existe histórico (ex.: cliente fez FAQ
    antes). Retorna None se não houver histórico suficiente ou se ocorrer erro — caller
    deve cair de volta no WELCOME_MESSAGE estático.
    """
    try:
        history = await get_history(company_id, client_phone)
    except Exception:
        logger.exception("identity_migration | falha ao ler histórico para welcome contextual")
        return None

    # Considera apenas turnos anteriores à mensagem atual (get_history já inclui a
    # mensagem recém-salva). Sem trocas prévias = primeiro contato real → estático.
    prior = [m for m in history if (m.get("content") or "").strip() != (user_message or "").strip()]
    has_prior_assistant = any(m.get("role") == "assistant" for m in prior)
    if not has_prior_assistant:
        return None

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None

    base_model = os.getenv("OPENAI_IDENTITY_WELCOME_MODEL", "gpt-4o-mini")
    model = resolve_model_for_company(base_model, company_id)
    client_llm = AsyncOpenAI(api_key=api_key)

    tail = prior[-8:]
    history_text = "\n".join(
        f"{('Cliente' if m.get('role') == 'user' else 'Atendente')}: {(m.get('content') or '').strip()}"
        for m in tail
        if (m.get("content") or "").strip()
    )
    user_prompt = (
        f"HISTÓRICO RECENTE:\n{history_text}\n\n"
        f"MENSAGEM ATUAL DO CLIENTE:\n{user_message.strip()}\n\n"
        "Gere a mensagem de convite ao cadastro seguindo as regras."
    )
    try:
        resp = await client_llm.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _WELCOME_CONTEXTUAL_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            max_completion_tokens=220,
        )
        reply = (resp.choices[0].message.content or "").strip()
        if not reply:
            return None
        return reply
    except Exception:
        logger.exception("identity_migration | welcome contextual LLM falhou")
        return None

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

_REGISTRATION_LABEL_RE = re.compile(
    r"(?:^|\n)\s*(?:nome\s*completo|e-?mail|telefone|cpf)\s*:",
    re.IGNORECASE,
)


def _looks_like_registration_block(msg: str) -> bool:
    """True se a mensagem parece um bloco preenchido do cadastro (labels, email, CPF)."""
    if not msg:
        return False
    if _REGISTRATION_LABEL_RE.search(msg):
        return True
    if "@" in msg and re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", msg):
        return True
    # 11 dígitos seguidos (CPF corrido) — não é padrão de pergunta de FAQ.
    if re.search(r"(?<!\d)\d{11}(?!\d)", _digits_only(msg) or msg):
        return True
    return False


_FIRST_INTENT_PROMPT = (
    "Você classifica a mensagem de um possível cliente de petshop no WhatsApp em UMA das categorias:\n"
    "\n"
    "- \"faq\": pergunta sobre INFORMAÇÃO PÚBLICA da loja (preço/valor, endereço, localização, CEP, como "
    "chegar, horário de funcionamento, telefone/contato, catálogo de serviços, quais espécies atendem, "
    "formas de pagamento, se tem hotel/creche/banho/tosa, políticas gerais). IMPORTANTE: continua sendo "
    "FAQ mesmo quando o cliente menciona espécie/raça/idade/porte do pet apenas como CONTEXTO da pergunta "
    "(\"quanto é o banho pro meu shih tzu?\", \"atende gato?\", \"tem hotel pra porte grande?\", "
    "\"quanto custa a tosa de um poodle médio?\"). Se a pergunta pode ser respondida sem consultar dados "
    "do cliente no sistema, é FAQ.\n"
    "\n"
    "- \"cadastro\": pedido de AÇÃO que exige identificar o cliente OU conversar sobre o próprio pet de "
    "forma específica, SEM contexto de FAQ em andamento. Inclui:\n"
    "  • pedir para AGENDAR, REMARCAR, CANCELAR, confirmar horário;\n"
    "  • consultar histórico/agendamentos existentes;\n"
    "  • falar sobre saúde/comportamento/problema do próprio pet (\"meu pet está passando mal\", "
    "\"ele não come\");\n"
    "  • enviar dados pessoais (nome, CPF, e-mail, telefone);\n"
    "  • reclamar sobre atendimento anterior;\n"
    "  • pedir falar com humano sobre assunto de petshop;\n"
    "  • saudação simples (\"oi\", \"bom dia\") sem pergunta pública E sem contexto prévio;\n"
    "  • mensagens ambíguas ou vazias de alguém que pode ser cliente, SEM contexto prévio.\n"
    "\n"
    "- \"escalate\": use SOMENTE com ALTA CONFIANÇA quando a mensagem é INEQUIVOCAMENTE fora do escopo do "
    "petshop. Restrito a:\n"
    "  (a) propaganda/oferta B2B para o petshop (venda de software, marketing digital, SEO, parceria "
    "comercial, fornecedor de produto/serviço, representante comercial se apresentando);\n"
    "  (b) cobrança de aluguel/IPTU/boleto que não é de produto/serviço do petshop;\n"
    "  (c) prestador de serviço contratado pelo petshop falando do próprio trabalho (pintor, encanador, "
    "eletricista, pedreiro, técnico, dedetização, entregador de material de obra);\n"
    "  (d) golpe/spam/link malicioso explícito, roleplay ofensivo, assunto religioso/político, assunto "
    "pessoal sem nenhuma relação com pets/petshop.\n"
    "\n"
    "REGRAS DE DESEMPATE (OBRIGATÓRIO — nessa ordem):\n"
    "1. Se há \"CONTEXTO — ÚLTIMA MENSAGEM DA ATENDENTE\" no input e a atendente estava em tópico de FAQ "
    "(informando/pedindo detalhes sobre preço, horário, endereço, catálogo de serviços, porte do pet para "
    "cotação), a resposta curta do cliente (porte P/M/G/GG, pequeno/médio/grande, sim/não, nome do serviço, "
    "números, idade, raça, um emoji) é CONTINUAÇÃO do FAQ → classifique como \"faq\".\n"
    "2. Se há CONTEXTO e a atendente estava em tópico de cadastro/agendamento específico (pediu nome, CPF, "
    "confirmação de horário), a resposta continua como \"cadastro\".\n"
    "3. Sem CONTEXTO: Se a mensagem contém uma pergunta sobre PREÇO, HORÁRIO, ENDEREÇO, SERVIÇOS → SEMPRE "
    "\"faq\", mesmo que mencione dados do pet ou do cliente no meio.\n"
    "4. Mensagens CURTAS (1-3 palavras, emojis, saudação, sim/não, porte, números) NUNCA são \"escalate\".\n"
    "5. Em qualquer dúvida, prefira \"cadastro\" a \"escalate\".\n"
    "\n"
    "Responda APENAS JSON: {\"intent\":\"faq\"} ou {\"intent\":\"cadastro\"} ou {\"intent\":\"escalate\"}."
)


async def _recent_assistant_context(
    company_id: int, client_phone: str, current_msg: str
) -> str | None:
    """Última mensagem da atendente no histórico (exclui a atual do cliente). None se não houver."""
    try:
        history = await get_history(company_id, client_phone)
    except Exception:
        return None
    cur = (current_msg or "").strip()
    for m in reversed(history or []):
        if m.get("role") != "assistant":
            continue
        content = (m.get("content") or "").strip()
        if not content or content == cur:
            continue
        return content[:400]
    return None




async def _classify_first_intent(
    msg: str,
    company_id: int | None,
    client_phone: str | None = None,
) -> str:
    """Retorna 'faq', 'cadastro' ou 'escalate'. Em erro/dúvida, fallback='cadastro'."""
    t = (msg or "").strip()
    if not t or len(t) > 400:
        return "cadastro"
    # Mensagens muito curtas (≤3 palavras) nunca escalam — são respostas curtas a
    # perguntas do atendente, ambíguas demais para disparar escalonamento humano.
    # Ainda podem ir pro LLM para decidir faq vs cadastro, mas escalate vira cadastro.
    too_short_for_escalate = len(t.split()) <= 3
    # Bloco de cadastro preenchido deve seguir o fluxo de cadastro, não ir para FAQ/escalate.
    if _looks_like_registration_block(t):
        return "cadastro"
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return "cadastro"
    base_model = os.getenv("OPENAI_INTENT_CLASSIFY_MODEL", "gpt-4o-mini")
    model = resolve_model_for_company(base_model, company_id)
    client = AsyncOpenAI(api_key=api_key)

    last_assistant: str | None = None
    if company_id is not None and client_phone:
        last_assistant = await _recent_assistant_context(company_id, client_phone, t)

    user_blocks: list[str] = []
    if last_assistant:
        user_blocks.append(
            "CONTEXTO — ÚLTIMA MENSAGEM DA ATENDENTE (conversa em andamento):\n"
            + last_assistant
        )
    user_blocks.append("MENSAGEM ATUAL DO CLIENTE:\n" + t)
    user_content = "\n\n".join(user_blocks)

    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _FIRST_INTENT_PROMPT},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
            max_completion_tokens=20,
        )
        raw = (resp.choices[0].message.content or "").strip()
        data = json.loads(raw)
        intent = str(data.get("intent", "")).strip().lower()
        if intent == "escalate" and too_short_for_escalate:
            # Rede de segurança: mensagem curta nunca escala, mesmo que o LLM erre.
            return "cadastro"
        if intent in ("faq", "escalate"):
            return intent
        return "cadastro"
    except Exception:
        logger.exception(
            "identity_migration | classificador de intent falhou — fallback=cadastro"
        )
        return "cadastro"


async def _is_faq_only(msg: str, company_id: int | None) -> bool:
    """Wrapper de compat — True quando o classificador responde 'faq'."""
    return (await _classify_first_intent(msg, company_id)) == "faq"


_CONSENT_CLASSIFIER_PROMPT = (
    "O atendente acabou de pedir ao cliente se ele concorda em fazer um cadastro rápido (nome, e-mail, "
    "telefone, CPF). Classifique a RESPOSTA do cliente em UMA categoria:\n"
    "- \"accept\": aceita claramente o cadastro (sim, ok, pode, vamos, quero, claro, beleza, bora, "
    "com certeza, combinado, manda aí, pode mandar, perfeito).\n"
    "- \"refuse\": recusa claramente (não, não quero, prefiro não, dispenso, não preciso, cancela, desisto, "
    "sem cadastro, não vou, de jeito nenhum).\n"
    "- \"reluctant\": demonstra RELUTÂNCIA, objeção, desconfiança ou desconforto em fazer o cadastro, "
    "sem ser uma recusa direta. Exemplos: \"tenho que me cadastrar mesmo?\", \"por que vocês precisam do "
    "meu CPF?\", \"pra que tantos dados?\", \"não tem outro jeito?\", \"é seguro?\", \"acho invasivo\", "
    "\"não gosto de passar esses dados\", \"já sou cliente, por que preciso cadastrar de novo?\" expressando "
    "incômodo, questionamentos sobre a necessidade do cadastro, exigência de falar com humano por causa "
    "do cadastro.\n"
    "- \"clarify\": mensagem ambígua, off-topic, saudação, pergunta sobre a loja (preço/horário/endereço), "
    "pedido de serviço sem responder ao consentimento, ou qualquer coisa que não se encaixe acima.\n"
    "Responda APENAS JSON: {\"intent\":\"accept\"|\"refuse\"|\"reluctant\"|\"clarify\"}."
)


async def _classify_consent_llm(msg: str, company_id: int | None) -> str:
    """Retorna 'accept', 'refuse', 'reluctant' ou 'clarify'. Erro → fallback='clarify' (reask)."""
    t = (msg or "").strip()
    if not t:
        return "clarify"
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return "clarify"
    base_model = os.getenv("OPENAI_CONSENT_CLASSIFY_MODEL", "gpt-4o-mini")
    model = resolve_model_for_company(base_model, company_id)
    client = AsyncOpenAI(api_key=api_key)
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _CONSENT_CLASSIFIER_PROMPT},
                {"role": "user", "content": t},
            ],
            response_format={"type": "json_object"},
            max_completion_tokens=20,
        )
        raw = (resp.choices[0].message.content or "").strip()
        data = json.loads(raw)
        intent = str(data.get("intent", "")).strip().lower()
        if intent in ("accept", "refuse", "reluctant", "clarify"):
            return intent
        return "clarify"
    except Exception:
        logger.exception(
            "identity_migration | classificador de consent falhou — fallback=clarify"
        )
        return "clarify"


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

    # Antes de qualquer resposta fixa, classifica a intenção da mensagem em
    # {faq, cadastro, escalate}. Isso permite:
    #   • FAQ → bypass para o router (FAQ agent responde preço/endereço/horário).
    #   • escalate → mensagens completamente fora do escopo (B2B, oferta de serviço,
    #     cobrança de aluguel, prestador contratado tipo pintor/encanador, spam)
    #     vão direto para humano, antes mesmo da boas-vindas de recadastro.
    if phase in (None, "awaiting_consent"):
        intent = await _classify_first_intent(
            user_message, company_id, client_phone
        )
        if intent == "escalate":
            _run_escalate(
                company_id,
                str(client_id),
                "Mensagem fora do escopo do petshop (B2B, oferta/cobrança, prestador de serviços contratado ou assunto não relacionado).",
                user_message,
            )
            await _redis_clear_best_effort(company_id, client_phone)
            logger.info(
                "identity_migration | escalate pré-cadastro | company_id=%s | phone=%s",
                company_id,
                client_phone,
            )
            return {
                "reply": "Obrigada pelo contato! Vou encaminhar para alguém da equipe te responder por aqui.",
                "router_ctx": {
                    "agent": "escalation_agent",
                    "stage": "WELCOME",
                    "required_tools": ["none"],
                },
                "agent_used": "identity_migration",
                "stage": "IDENTITY_ESCALATED_PRE_WELCOME",
            }
        if intent == "faq":
            logger.info(
                "identity_migration | FAQ detectado — bypass do recadastro | company_id=%s | phone=%s",
                company_id,
                client_phone,
            )
            return None

    # Primeiro contato do fluxo: sempre boas-vindas (ignora conteúdo da 1ª msg curta).
    if phase is None:
        if not await _redis_set_or_abort(
            company_id, client_phone, "awaiting_consent"
        ):
            return None
        contextual = await _build_contextual_welcome(company_id, client_phone, user_message)
        reply = contextual or WELCOME_MESSAGE
        if contextual:
            logger.info(
                "identity_migration | welcome contextual gerado | company_id=%s | phone=%s",
                company_id,
                client_phone,
            )
        return {
            "reply": reply,
            "router_ctx": None,
            "agent_used": "identity_migration",
            "stage": "IDENTITY_WELCOME",
        }

    if phase == "completed":
        await _redis_clear_best_effort(company_id, client_phone)
        return None

    if phase == "awaiting_consent":
        cls = await _classify_consent_llm(user_message, company_id)
        if cls in ("refuse", "reluctant"):
            summary = (
                "Cliente recusou o recadastro na migração de plataforma."
                if cls == "refuse"
                else "Cliente demonstrou relutância/objeção ao recadastro (questionou necessidade ou desconforto com os dados)."
            )
            _run_escalate(company_id, str(client_id), summary, user_message)
            await _redis_clear_best_effort(company_id, client_phone)
            return {
                "reply": "Sem problema! Vou pedir para alguém da equipe te atender por aqui em breve.",
                "router_ctx": {
                    "agent": "escalation_agent",
                    "stage": "WELCOME",
                    "required_tools": ["none"],
                },
                "agent_used": "identity_migration",
                "stage": "IDENTITY_REFUSED" if cls == "refuse" else "IDENTITY_RELUCTANT",
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
