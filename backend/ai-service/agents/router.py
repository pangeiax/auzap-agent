import json
import logging
import re
from datetime import date as date_cls, datetime, timedelta, timezone
from agno.agent import Agent
from utils.openai_chat import openai_chat_for_agents
from config import OPENAI_MODEL_ROUTER, resolve_model
from prompts.router import build_router_prompt
from prompts.shared_blocks import append_global_agent_max_rules
from agents.team.onboarding_agent import build_onboarding_agent
from agents.team.booking_agent import build_booking_agent
from agents.team.faq_agent import build_faq_agent
from agents.team.sales_agent import build_sales_agent
from agents.team.escalation_agent import build_escalation_agent
from agents.team.lodging_agent import build_lodging_agent
from agents.team.health_agent import build_health_agent
from agents.team.identity_agent import build_identity_agent
from agents.router_tool_plan import (
    build_router_tools_instruction_block,
    format_required_tools_for_log,
    normalize_required_tools,
    router_says_conversation_only,
    router_wants_category,
)
from memory.tool_result_cache import (
    build_booking_tool_cache_hint,
    build_pets_cache_hint,
    build_upcoming_appointments_hint,
)
from tools.booking_tools import fetch_available_times_snapshot
from agents.context_guard import (
    _message_looks_like_time_selection,
    apply_guardrails,
    check_post_guardrails,
    parse_tool_result_dict,
    trim_specialist_input,
)

logger = logging.getLogger("ai-service.router")
ROUTER_HISTORY_MESSAGES = 10


def _agent_configured_model_id(agent: Agent) -> str:
    """ID do modelo configurado no Agno (pode diferir do snapshot resolvido pela API)."""
    model = getattr(agent, "model", None)
    mid = getattr(model, "id", None) if model is not None else None
    return str(mid) if mid else "unknown"


# JSON de argumentos de tool que o modelo às vezes cola antes do texto ao cliente
_TOOL_JSON_SIGNATURE_KEYS = frozenset(
    {
        "pet_id",
        "slot_id",
        "service_id",
        "specialty_id",
        "target_date",
        "appointment_id",
        "new_slot_id",
        "confirmed",
        "company_id",
        "client_id",
        "lodging_type",
        "check_in_date",
        "check_out_date",
    }
)


def _strip_leading_tool_json_blob(text: str) -> str:
    """Remove um objeto JSON inicial se parecer payload de tool (não mensagem ao usuário)."""
    s = text.lstrip()
    if not s.startswith("{"):
        return text
    depth = 0
    for i, c in enumerate(s):
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                blob = s[: i + 1]
                try:
                    obj = json.loads(blob)
                    if isinstance(obj, dict) and set(obj.keys()) & _TOOL_JSON_SIGNATURE_KEYS:
                        rest = s[i + 1 :].lstrip()
                        logger.warning(
                            "Sanitize reply | removido JSON de tool no início da resposta | keys=%s",
                            list(obj.keys())[:12],
                        )
                        return rest
                except json.JSONDecodeError:
                    pass
                return text
    return text


def _sanitize_specialist_reply(reply: str) -> str:
    """
    O modelo mini às vezes deixa vazar argumentos de tool / nomes de função no `content`
    em vez de só texto natural — isso vai direto pro WhatsApp.
    """
    if not (reply or "").strip():
        return reply
    out = reply.strip()
    for _ in range(4):
        nxt = _strip_leading_tool_json_blob(out)
        if nxt == out:
            break
        out = nxt
    # Vazamentos estilo Responses API / Agno
    out = re.sub(
        r"(?im)^\s*to=functions\.[a-z_0-9]+\s*$",
        "",
        out,
    )
    out = re.sub(r"(?im)^\s*to=functions\.[a-z_0-9]+\s*\n", "", out)
    # Trechos degenerados (chinês/tailandês solto entre tokens) — comum com contexto longo + mini
    out = re.sub(r"[\u4e00-\u9fff\u0e00-\u0e7f]{4,}", " ", out)
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out


def _coerce_onboarding_awaiting_without_pet(router_ctx: dict) -> dict:
    """
    O router costuma usar AWAITING_CONFIRMATION para resumo de *agenda*.
    Em onboarding, um «sim» curto após pergunta de cadastro (raça, porte…) não deve
    cair nesse estágio com active_pet vazio — o especialista pede nome de novo em loop.
    """
    if router_ctx.get("agent") != "onboarding_agent":
        return router_ctx
    if (router_ctx.get("stage") or "").upper() != "AWAITING_CONFIRMATION":
        return router_ctx
    if (router_ctx.get("active_pet") or "").strip():
        return router_ctx
    out = dict(router_ctx)
    out["stage"] = "PET_REGISTRATION"
    out["awaiting_confirmation"] = False
    if not out.get("required_tools"):
        out["required_tools"] = ["pets"]
    else:
        rt = list(normalize_required_tools(out.get("required_tools")) or [])
        if "pets" not in rt:
            rt.insert(0, "pets")
        out["required_tools"] = rt
    logger.info(
        "Coerção router: onboarding AWAITING_CONFIRMATION sem active_pet → PET_REGISTRATION"
    )
    return out


# Remove falas de "processamento" que ainda vazam do modelo (booking)
_BOOKING_LEADING_NOISE = re.compile(
    r"(?is)"
    r"^(?:\s*"
    r"(?:deixa eu (?:confirmar|ver)|estou verificando|vou verificar|só um instante|"
    r"aguarde (?:um instante|só um momento)|deixa eu ver se)[^.?!\n]*[.?!\n]\s*)+"
)

# Frases de "vou verificar / retorno em breve" — só permitidas após escalate_to_human (escalation_agent)
_VERIFICAR_FAMILY = re.compile(
    r"(?is)"
    r"\b(?:"
    r"vou\s+verificar|"
    r"deixa(?:\s+eu)?\s+verificar|"
    r"estou\s+verificando|"
    r"vou\s+ver\s+isso|"
    r"deixa\s+eu\s+ver\s+isso"
    r")\b"
)
_RETORNO_BREVE = re.compile(
    r"(?is)\b(?:te\s+)?retorno\s+em\s+breve\b"
)
# Promessa de acionar equipe/humano sem tool escalate_to_human (ex.: lodging recusou encaminhamento)
_ALINHAR_EQUIPE = re.compile(
    r"(?is)\b(?:vou|vamos)\s+alinhar\s+com\s+(?:a\s+)?equipe\b"
)
_JA_PASSEI_EQUIPE = re.compile(
    r"(?is)\bjá\s+(?:passei|encaminhei)\s+(?:para\s+|pra\s+)?(?:a\s+)?equipe\b"
)
_VERIFICAR_REPROCESS_MAX = 3
_REPROCESS_VERIFICAR_SUFFIX = """
━━━ REPROCESSAMENTO OBRIGATÓRIO (sistema) ━━━
A resposta anterior foi rejeitada: usou frase(s) do tipo "vou verificar" / "retorno em breve" / "deixa eu ver"
fora do fluxo de escalonamento humano (tool escalate_to_human).
Gere UMA nova resposta ao cliente, em português, curta (WhatsApp):
• PROIBIDO: "vou verificar", "deixa eu verificar", "estou verificando", "retorno em breve", "já volto",
  "só um instante", "aguarde", "vou alinhar com a equipe", "já passei pra equipe", ou promessa de checagem/handoff
  futuro **sem** ter chamado escalate_to_human com sucesso nesta rodada.
• Se precisar de dados (horários, vagas, etc.), chame as tools do seu fluxo AGORA e responda com o resultado.
• Seja direto: só a informação ou a pergunta final, sem narrar processo.
"""


def _reply_triggers_verificar_reprocess(reply: str) -> bool:
    if not (reply or "").strip():
        return False
    if _VERIFICAR_FAMILY.search(reply):
        return True
    if _RETORNO_BREVE.search(reply):
        return True
    if _ALINHAR_EQUIPE.search(reply):
        return True
    if _JA_PASSEI_EQUIPE.search(reply):
        return True
    return False


def _escalation_tool_succeeded(run_output) -> bool:
    """True se escalate_to_human rodou com sucesso — aí 'vou verificar' na resposta é permitido."""
    for t in (getattr(run_output, "tools", None) or []):
        if getattr(t, "tool_name", None) != "escalate_to_human":
            continue
        if getattr(t, "tool_call_error", False):
            return False
        res = getattr(t, "result", None)
        if res is None:
            return True
        text = res if isinstance(res, str) else json.dumps(res)
        try:
            data = json.loads(text)
            return data.get("success") is True
        except Exception:
            return True
    return False


def _normalize_booking_false_reschedule_wording(agent_name: str, run_output, reply: str) -> str:
    """
    O modelo às vezes diz «remarcado» após create_appointment (novo agendamento).
    Só reschedule_appointment deve usar esse vocabulário.
    """
    if agent_name != "booking_agent" or not reply or not run_output:
        return reply
    created_ok = False
    rescheduled_ok = False
    for t in getattr(run_output, "tools", None) or []:
        if getattr(t, "tool_call_error", False):
            continue
        name = getattr(t, "tool_name", None)
        data = parse_tool_result_dict(getattr(t, "result", None))
        if data.get("success") is not True:
            continue
        if name == "create_appointment":
            created_ok = True
        elif name == "reschedule_appointment":
            rescheduled_ok = True
    if not created_ok or rescheduled_ok:
        return reply
    if not re.search(r"remarcad", reply, re.IGNORECASE):
        return reply
    out = reply
    out = re.sub(r"\bfoi\s+remarcad[oa]\b", "ficou marcado", out, flags=re.IGNORECASE)
    out = re.sub(r"\bficou\s+remarcad[oa]\b", "ficou marcado", out, flags=re.IGNORECASE)
    out = re.sub(r"\bremarcad[oa]\b", "marcado", out, flags=re.IGNORECASE)
    out = re.sub(r"\bremarcamos\b", "marcamos", out, flags=re.IGNORECASE)
    if out != reply:
        logger.warning(
            "Normalize reply | substituído vocabulário de remarcação após create_appointment | preview=%.120r",
            out,
        )
    return out


def _must_reprocess_verificar(agent_name: str, run_output, reply: str) -> bool:
    """Reprocessa se a resposta promete verificação/handoff vago sem escalate_to_human bem-sucedido."""
    if not _reply_triggers_verificar_reprocess(reply):
        return False
    if _escalation_tool_succeeded(run_output):
        return False
    return True


def _resolve_service_and_pet_ids(context: dict, router_ctx: dict) -> tuple:
    """Resolve service_id, specialty_id e pet_id a partir do contexto carregado + JSON do router."""
    services = context.get("services") or []
    pets = context.get("pets") or []
    svc_name = (router_ctx.get("service") or "").strip().lower()
    service_id = None
    specialty_id = None
    if svc_name:
        for s in services:
            if (s.get("name") or "").strip().lower() == svc_name:
                service_id = s.get("id")
                specialty_id = s.get("specialty_id")
                break
    pet_id = None
    active = (router_ctx.get("active_pet") or "").strip()
    if active:
        al = active.lower()
        for p in pets:
            if (p.get("name") or "").strip().lower() == al:
                pid = p.get("id")
                pet_id = str(pid) if pid else None
                break
    return service_id, specialty_id, pet_id


def _booking_availability_snapshot_block(context: dict, router_ctx: dict) -> str:
    """
    Pré-executa get_available_times e injeta JSON na entrada do especialista.
    Usado em booking_agent e health_agent quando há data + slots no plano — evita negações inventadas.
    """
    stage = router_ctx.get("stage") or ""
    if stage == "COMPLETED":
        return ""
    date_iso = router_ctx.get("date_mentioned")
    if not date_iso:
        return ""
    try:
        date_cls.fromisoformat(str(date_iso).strip()[:10])
    except Exception:
        return ""

    company_id = context.get("company_id")
    client = context.get("client") or {}
    client_id = client.get("id")
    if not company_id or not client_id:
        return ""

    service_id, specialty_id, pet_id = _resolve_service_and_pet_ids(context, router_ctx)
    if not specialty_id and not service_id:
        return ""

    try:
        snap = fetch_available_times_snapshot(
            company_id=int(company_id),
            client_id=str(client_id),
            specialty_id=str(specialty_id) if specialty_id else "",
            target_date=str(date_iso).strip()[:10],
            service_id=service_id,
            pet_id=pet_id,
        )
    except Exception as exc:
        logger.warning("Pré-carga get_available_times falhou: %s", exc)
        return ""

    logger.info(
        "Pré-carga disponibilidade | date=%s service_id=%s pet_id=%s available=%s",
        date_iso,
        service_id,
        pet_id,
        snap.get("available"),
    )
    return (
        "\n\n━━━ DADOS DE DISPONIBILIDADE (obrigatório: baseie horários NESTE JSON; não invente) ━━━\n"
        + json.dumps(snap, ensure_ascii=False, default=str)
    )


def _emergency_strip_verificar(reply: str) -> str:
    """Último recurso se o modelo insistir após todas as tentativas."""
    if not reply:
        return reply
    out = _VERIFICAR_FAMILY.sub("", reply)
    out = _RETORNO_BREVE.sub("", out)
    out = re.sub(r"\s{2,}", " ", out).strip(" \t\n,;:-")
    if out:
        return out
    return "Me conta de novo o que você precisa? Consigo te ajudar agora."


VALID_AGENTS = {
    "onboarding_agent",
    "booking_agent",
    "lodging_agent",
    "health_agent",
    "faq_agent",
    "sales_agent",
    "escalation_agent",
    "identity_agent",
}

DEFAULT_ROUTER_CTX = {
    "agent": "onboarding_agent",
    "stage": "WELCOME",
    "active_pet": None,
    "service": None,
    "date_mentioned": None,
    "selected_time": None,
    "checkin_mentioned": None,
    "checkout_mentioned": None,
    "awaiting_confirmation": False,
}

DEFAULT_REQUIRED_TOOLS_BY_AGENT_STAGE = {
    ("onboarding_agent", "WELCOME"): ["none"],
    ("onboarding_agent", "PET_REGISTRATION"): ["pets"],
    ("onboarding_agent", "COMPLETED"): ["none"],
    ("booking_agent", "SERVICE_SELECTION"): ["pets", "services"],
    ("booking_agent", "SCHEDULING"): ["pets", "services", "slots"],
    ("booking_agent", "AWAITING_CONFIRMATION"): ["pets", "services", "slots", "appointments"],
    ("booking_agent", "COMPLETED"): ["none"],
    ("sales_agent", "WELCOME"): ["services"],
    ("sales_agent", "SERVICE_SELECTION"): ["services"],
    ("faq_agent", "WELCOME"): ["none"],
    ("lodging_agent", "SCHEDULING"): ["lodging"],
    ("health_agent", "SERVICE_SELECTION"): ["pets", "services"],
    ("health_agent", "SCHEDULING"): ["pets", "services", "slots"],
    ("health_agent", "AWAITING_CONFIRMATION"): ["pets", "services", "slots", "appointments"],
    ("escalation_agent", "WELCOME"): ["none"],
    ("identity_agent", "COLLECT_IDENTITY"): ["none"],
}


def _default_required_tools(agent: str, stage: str) -> list[str] | None:
    return DEFAULT_REQUIRED_TOOLS_BY_AGENT_STAGE.get((agent, stage))


def _message_looks_like_time_or_schedule_confirm(message: str) -> bool:
    """Heurística para follow-ups de agendamento (horário, amanhã, confirmação)."""
    ml = (message or "").strip().lower()
    if not ml:
        return False
    if re.search(r"\b\d{1,2}\s*h\b", ml):
        return True
    if re.search(r"às\s*\d", ml) or re.search(r"\bas\s+\d", ml):
        return True
    if any(
        x in ml
        for x in (
            "amanhã",
            "amanha",
            "pode ser",
            "confirm",
            "prefiro",
        )
    ):
        return True
    if re.fullmatch(r"(sim|ok|beleza|isso|pode)\.?[\s!]*", ml):
        return True
    return False


def _coerce_onboarding_to_booking_when_service_schedule(
    message: str, router_ctx: dict, history: list | None
) -> dict:
    """
    onboarding_agent não expõe create_appointment/get_available_times.
    O router às vezes mantém onboarding após create_pet ou por confundir «cadastrar banho» com cadastro de pet —
    o modelo então «confirma» agendamento sem gravar. Corrige para booking_agent quando a intenção é claramente agenda.
    """
    if router_ctx.get("agent") != "onboarding_agent":
        return router_ctx

    # PET_REGISTRATION + "sim"/"isso"/etc. é confirmação de cadastro, não de horário de banho.
    # O histórico costuma citar "Banho" no catálogo — has_grooming_hist ficaria true e a
    # heurística abaixo mandava para booking sem create_pet (quebra adestramento e qualquer
    # cadastro seguido de confirmação curta).
    if (router_ctx.get("stage") or "").upper() == "PET_REGISTRATION" and _message_looks_like_time_or_schedule_confirm(
        message
    ):
        return router_ctx

    m = (message or "").strip().lower()
    hist = (_format_history(history or []) or "").lower()

    if re.search(
        r"\b(cadastrar|cadastra)\b.*\b(outro|novo|um)\s+pet\b|\b(outro|novo)\s+pet\b",
        m,
    ) and not re.search(r"\b(banho|tosa|hidrata)\b", m):
        return router_ctx
    if re.search(
        r"\b(cadastrar|cadastra)\b.*\b(me\s+u\s+)?(cachorro|gato|pet|cãozinho|gatinho|cao)\b",
        m,
    ) and not re.search(r"\b(banho|tosa|hidrata)\b", m):
        return router_ctx

    grooming = ("banho", "tosa", "hidrata")
    has_grooming_msg = any(g in m for g in grooming)
    has_grooming_hist = any(g in hist for g in grooming)
    schedule_cue = any(
        b in m
        for b in (
            "agendar",
            "marcar",
            "marca ",
            "marque",
            "quero ",
            "preciso ",
            "cadastrar",
            "cadastra",
            "horário",
            "horario",
        )
    ) or re.search(r"\b\d{1,2}\s*h\b", m)
    schedule_context = has_grooming_hist and (
        re.search(r"\d{1,2}:\d{2}", hist)
        or "horário" in hist
        or "horario" in hist
        or "horários" in hist
        or "horarios" in hist
    )

    force = False
    if has_grooming_msg and schedule_cue:
        force = True
    elif (has_grooming_msg or has_grooming_hist) and schedule_context and _message_looks_like_time_or_schedule_confirm(
        message
    ):
        force = True

    if not force:
        return router_ctx

    logger.warning(
        "Correção de roteamento: onboarding_agent → booking_agent (agenda de banho/tosa sem tools de booking) | msg=%.100r",
        message,
    )
    out = dict(router_ctx)
    out["agent"] = "booking_agent"
    if (out.get("specialty_type") or "regular") not in ("health", "lodging"):
        out["specialty_type"] = "regular"

    raw_rt = router_ctx.get("required_tools")
    rt = list(normalize_required_tools(raw_rt) or [])
    if rt == ["none"]:
        rt = []
    for token in ("pets", "services"):
        if token not in rt:
            rt.append(token)
    slots_hint = any(
        x in m
        for x in (
            "amanhã",
            "amanha",
            "hoje",
            "às",
            "horário",
            "horario",
            "sext",
            "segund",
            "terç",
            "quart",
            "quint",
        )
    ) or bool(re.search(r"\b\d{1,2}\s*h\b", m))
    if slots_hint and "slots" not in rt:
        rt.append("slots")
    if (
        router_ctx.get("awaiting_confirmation")
        or "confirm" in m
        or re.fullmatch(r"(sim|ok|beleza|isso|pode)\.?[\s!]*", m.strip().lower())
    ) and "appointments" not in rt:
        rt.append("appointments")

    out["required_tools"] = rt if rt else None

    st = (router_ctx.get("stage") or "").upper()
    if st == "PET_REGISTRATION" and (has_grooming_msg or has_grooming_hist):
        out["stage"] = "SCHEDULING" if router_ctx.get("date_mentioned") else "SERVICE_SELECTION"

    return out


def _pet_created_at_utc(ct) -> datetime | None:
    if ct is None:
        return None
    if isinstance(ct, datetime):
        if ct.tzinfo is None:
            return ct.replace(tzinfo=timezone.utc)
        return ct.astimezone(timezone.utc)
    if isinstance(ct, str):
        try:
            s = ct.replace("Z", "+00:00")
            d = datetime.fromisoformat(s)
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone.utc)
            return d.astimezone(timezone.utc)
        except ValueError:
            return None
    return None


def _message_mentions_pet_name(message: str, name: str) -> bool:
    n = (name or "").strip()
    if len(n) < 2:
        return False
    return (
        re.search(rf"(?<!\w){re.escape(n)}(?!\w)", message or "", re.IGNORECASE)
        is not None
    )


def _ensure_active_pet_when_booking(
    router_ctx: dict, context: dict, message: str
) -> dict:
    """
    booking_agent e health_agent usam `active_pet` no prompt e em `_resolve_service_and_pet_ids`
    (pré-carga de horários). Se o Roteador deixar active_pet vazio (ex.: «novo ciclo» após create_pet),
    infere: nome citado na mensagem, pet único do cliente, ou o mais recentemente cadastrado
    (created_at nos últimos 7 dias).
    """
    if router_ctx.get("agent") not in ("booking_agent", "health_agent"):
        return router_ctx
    if router_says_conversation_only(router_ctx):
        return router_ctx
    if (router_ctx.get("active_pet") or "").strip():
        return router_ctx

    pets = context.get("pets") or []
    if not pets:
        return router_ctx

    sorted_by_len = sorted(
        pets,
        key=lambda p: len((p.get("name") or "").strip()),
        reverse=True,
    )
    for p in sorted_by_len:
        name = (p.get("name") or "").strip()
        if name and _message_mentions_pet_name(message, name):
            out = dict(router_ctx)
            out["active_pet"] = name
            logger.info("active_pet inferido (nome na mensagem): %s", name)
            return out

    if len(pets) == 1:
        name = (pets[0].get("name") or "").strip()
        if name:
            out = dict(router_ctx)
            out["active_pet"] = name
            logger.info("active_pet inferido (único pet do cliente): %s", name)
            return out

    now = datetime.now(timezone.utc)
    recent_cutoff = now - timedelta(days=7)
    best = None
    best_ts: datetime | None = None
    for p in pets:
        ts = _pet_created_at_utc(p.get("created_at"))
        if ts is None or ts < recent_cutoff:
            continue
        if best_ts is None or ts > best_ts:
            best_ts = ts
            best = p

    if best:
        name = (best.get("name") or "").strip()
        if name:
            out = dict(router_ctx)
            out["active_pet"] = name
            logger.info(
                "active_pet inferido (cadastro recente ≤7d, mais novo): %s",
                name,
            )
            return out

    return router_ctx


def _longest_catalog_service_name_in_message(message: str, services: list) -> str | None:
    """Nome exato do catálogo (get_services) mais longo contido na mensagem."""
    mlow = (message or "").lower()
    if not mlow or not services:
        return None
    best: str | None = None
    blen = 0
    for s in services:
        name = (s.get("name") or "").strip()
        if not name:
            continue
        nl = name.lower()
        if nl in mlow and len(nl) >= blen:
            best = name
            blen = len(nl)
    return best


def _booking_scheduling_followup_no_new_service(message: str, services: list) -> bool:
    """
    True quando o cliente parece só escolher horário / confirmar, sem citar novo serviço.
    Usado para não deixar o JSON do roteador «pular» de volta ao banho antigo.
    """
    if _longest_catalog_service_name_in_message(message, services):
        return False
    m = (message or "").strip().lower()
    if not m:
        return False
    if re.search(
        r"\b(remarc|reagend|cancel|outro\s+servi[cç]o|mudar\s+o\s+servi[cç]o|"
        r"quero\s+agendar|agendar\s+outro)\b",
        m,
    ):
        return False
    if re.search(
        r"\b(corte\s+de\s+unhas?|escova\w*\s+de\s+dentes?|hidrata\w*|"
        r"banho\s+e\s+tosa|banho|tosa|consulta|vacina|adestram|cirurgia)\b",
        m,
    ):
        return False
    if _message_looks_like_time_selection(m):
        return True
    if re.fullmatch(r"(sim|ok|pode|confirmo?|isso|beleza)\.?[\s!]*", m, re.I):
        return True
    return False


def _stabilize_booking_router_service(
    message: str,
    router_ctx: dict,
    previous_router_ctx: dict | None,
    context: dict,
) -> dict:
    """
    Evita que, após o cliente corrigir o serviço (ex. corte de unha), um follow-up só com
    horário («às 13 na sexta») faça o roteador voltar ao banho do fluxo de remarcação anterior.
    """
    if (router_ctx.get("agent") or "") not in ("booking_agent", "health_agent"):
        return router_ctx
    services = context.get("services") or []
    out = dict(router_ctx)
    named = _longest_catalog_service_name_in_message(message, services)
    if named:
        cur = (out.get("service") or "").strip()
        if not cur or cur.lower() != named.lower():
            logger.info(
                "router | service alinhado ao texto do cliente: %r (antes %r)",
                named,
                cur or None,
            )
        out["service"] = named
        return out

    prev = previous_router_ctx if isinstance(previous_router_ctx, dict) else None
    if not prev or (prev.get("agent") or "") not in ("booking_agent", "health_agent"):
        return out
    prev_svc = (prev.get("service") or "").strip()
    if not prev_svc:
        return out
    if not _booking_scheduling_followup_no_new_service(message, services):
        return out
    cur_svc = (out.get("service") or "").strip()
    if (not cur_svc) or (cur_svc.lower() != prev_svc.lower()):
        logger.info(
            "router | preservando service=%r (follow-up horário/conf.; parser tinha %r)",
            prev_svc,
            cur_svc or None,
        )
        out["service"] = prev_svc
    return out


# Agentes que executam ações de escrita e exigem cadastro completo do cliente.
# Onboarding NÃO está aqui no geral — saudação/WELCOME não exige cadastro.
# O cadastro de pet (onboarding com stage PET_REGISTRATION) é tratado à parte
# em `_router_ctx_demands_identity`.
_WRITE_ACTION_AGENTS = frozenset({
    "booking_agent",
    "lodging_agent",
    "health_agent",
})


# Palavras na mensagem do cliente que indicam INTENÇÃO DE ESCRITA real
# (agendar, cancelar, remarcar, cadastrar pet). Sem alguma dessas, mesmo que
# o router escolha booking/lodging/health, tratamos como leitura — assim o
# cliente pode perguntar "quais meus agendamentos?" sem ser forçado a cadastrar.
_WRITE_INTENT_KEYWORDS = (
    "agendar", "agenda ", "marcar", "marca ",
    "remarcar", "reagendar", "remarca ", "reagenda ",
    "cancelar", "cancela ", "cancele",
    "confirmar", "confirma ", "confirme",
    "cadastrar pet", "cadastra pet", "cadastrar meu pet", "cadastrar o pet",
    "registrar pet", "registra pet",
    "novo pet", "outro pet",
    "fazer hospedagem", "fazer hotel", "deixar o pet", "deixar meu pet",
    "checkin", "check-in", "check in",
)


def _message_has_write_intent(message: str) -> bool:
    if not message:
        return False
    m = message.lower()
    return any(kw in m for kw in _WRITE_INTENT_KEYWORDS)


def _router_ctx_demands_identity(
    router_ctx: dict,
    message: str = "",
    previous_router_ctx: dict | None = None,
) -> bool:
    """
    True quando o agente+stage exigem cadastro completo do cliente.

    Para os agentes de escrita (booking/lodging/health), exige adicionalmente
    que a MENSAGEM do cliente tenha keyword de write — assim consultas read-only
    ("quais meus agendamentos?", "que horas é meu banho?") não disparam o gate
    de cadastro. Quando há `pending_intent` (no turno atual ou no anterior),
    considera-se write automaticamente (continuação de fluxo já iniciado).
    """
    agent = router_ctx.get("agent")
    if agent in _WRITE_ACTION_AGENTS:
        # Continuação de fluxo já gateado em turno anterior.
        if router_ctx.get("pending_intent"):
            return True
        if previous_router_ctx and previous_router_ctx.get("pending_intent"):
            return True
        # Awaiting_confirmation = cliente vai dizer sim/não a um resumo de
        # agendamento — também é write.
        if router_ctx.get("awaiting_confirmation"):
            return True
        # Stage avançado de scheduling/awaiting → write.
        stage = (router_ctx.get("stage") or "").upper()
        if stage in ("SCHEDULING", "AWAITING_CONFIRMATION"):
            return True
        # Por fim, exige write keyword na mensagem.
        return _message_has_write_intent(message)
    # Cadastro de pet também precisa de cliente identificado (FK).
    if agent == "onboarding_agent":
        stage = (router_ctx.get("stage") or "").upper()
        if stage == "PET_REGISTRATION":
            return True
    return False


def _intent_summary_from_router_ctx(router_ctx: dict, message: str) -> str:
    """Resumo curto da intenção pendente, pra mostrar no prompt do identity_agent."""
    parts: list[str] = []
    agent = (router_ctx.get("agent") or "").replace("_agent", "")
    if agent:
        parts.append(agent)
    svc = (router_ctx.get("service") or "").strip()
    if svc:
        parts.append(svc)
    dt = (router_ctx.get("date_mentioned") or "").strip()
    if dt:
        parts.append(dt)
    if parts:
        return " · ".join(parts)
    return (message or "").strip()[:120]


def _gate_write_action_with_identity(
    router_ctx: dict,
    context: dict,
    message: str,
    previous_router_ctx: dict | None,
) -> dict:
    """
    Se o router escolheu um agente de escrita mas o cadastro está incompleto,
    redireciona para identity_agent e salva `pending_intent` no router_ctx.
    Inverso: se o router escolheu identity_agent mas já estamos completos, e
    há pending_intent no estado anterior, restaura a intenção original.
    """
    identity_status = context.get("identity_status") or {}
    incomplete = bool(identity_status.get("missing"))
    agent = router_ctx.get("agent")

    prev_pending = (
        (previous_router_ctx or {}).get("pending_intent")
        if previous_router_ctx
        else None
    )

    demands_identity = _router_ctx_demands_identity(
        router_ctx, message, previous_router_ctx
    )

    # Caso 1: cadastro incompleto e o router escolheu write-action OU já estamos
    # em identity_agent (continuação do fluxo) → mantém em identity_agent e
    # preserva a `pending_intent` existente (sem sobrescrever a intenção
    # original com algo classificado no meio do cadastro).
    if incomplete and (demands_identity or agent == "identity_agent"):
        if prev_pending and prev_pending.get("agent"):
            pending = prev_pending
        elif demands_identity:
            # Primeira vez que o gate dispara — captura a intenção atual.
            pending = {
                "agent": agent,
                "service": router_ctx.get("service"),
                "active_pet": router_ctx.get("active_pet"),
                "date_mentioned": router_ctx.get("date_mentioned"),
                "selected_time": router_ctx.get("selected_time"),
                "checkin_mentioned": router_ctx.get("checkin_mentioned"),
                "checkout_mentioned": router_ctx.get("checkout_mentioned"),
                "specialty_type": router_ctx.get("specialty_type"),
                "summary": _intent_summary_from_router_ctx(router_ctx, message),
                "original_message": (message or "")[:500],
            }
        else:
            # Já estamos em identity_agent sem pending — entrou direto, sem
            # write-action prévio (raro). Sem pending pra restaurar depois.
            pending = None

        out = {
            **router_ctx,
            "agent": "identity_agent",
            "stage": "COLLECT_IDENTITY",
            "required_tools": ["none"],
        }
        if pending:
            out["pending_intent"] = pending
        if agent != "identity_agent":
            logger.warning(
                "router | write-action gated por cadastro incompleto | original=%s missing=%s",
                agent,
                identity_status.get("missing"),
            )
        return out

    # Caso 2: cadastro completo e há pending_intent acumulada → restaura
    # (independente do router ter escolhido identity_agent ou outro).
    if not incomplete and prev_pending and prev_pending.get("agent"):
        restored = {
            **router_ctx,
            "agent": prev_pending["agent"],
            "stage": router_ctx.get("stage") or "WELCOME",
            "service": router_ctx.get("service") or prev_pending.get("service"),
            "active_pet": router_ctx.get("active_pet") or prev_pending.get("active_pet"),
            "date_mentioned": (
                router_ctx.get("date_mentioned") or prev_pending.get("date_mentioned")
            ),
            "selected_time": (
                router_ctx.get("selected_time") or prev_pending.get("selected_time")
            ),
            "checkin_mentioned": (
                router_ctx.get("checkin_mentioned") or prev_pending.get("checkin_mentioned")
            ),
            "checkout_mentioned": (
                router_ctx.get("checkout_mentioned") or prev_pending.get("checkout_mentioned")
            ),
            "specialty_type": (
                router_ctx.get("specialty_type") or prev_pending.get("specialty_type")
            ),
        }
        restored.pop("pending_intent", None)
        logger.info(
            "router | identity completou → restaurando pending_intent agent=%s",
            prev_pending["agent"],
        )
        return restored

    return router_ctx


async def run_router(
    message: str,
    context: dict,
    history: list,
    previous_router_ctx: dict | None = None,
) -> dict:
    """
    1. Router classifica intenção e extrai contexto acumulado (JSON)
    2. Especialista responde com contexto completo
    """

    # ── 1. Router ────────────────────────────────
    router = Agent(
        name="Router",
        model=openai_chat_for_agents(resolve_model(OPENAI_MODEL_ROUTER, context)),
        instructions=append_global_agent_max_rules(build_router_prompt(context)),
    )

    router_history = history[-ROUTER_HISTORY_MESSAGES:] if history else []
    history_text = _format_history(router_history)
    prev_router_summary = _format_router_state(previous_router_ctx)
    router_parts = []
    if prev_router_summary:
        router_parts.append(prev_router_summary)
    if history_text:
        router_parts.append(history_text)
    router_parts.append(f"Cliente: {message}")
    router_input = "\n\n".join(router_parts)

    router_response = router.run(router_input)
    router_ctx = _parse_router_response(router_response.content)
    router_ctx = _coerce_onboarding_to_booking_when_service_schedule(message, router_ctx, history)
    router_ctx = _stabilize_booking_router_service(
        message, router_ctx, previous_router_ctx, context
    )
    router_ctx = _coerce_onboarding_awaiting_without_pet(router_ctx)
    router_ctx = _ensure_active_pet_when_booking(router_ctx, context, message)
    # Gate de identidade: write-actions sem cadastro completo viram identity_agent;
    # identity_agent com cadastro completo restaura a pending_intent original.
    router_ctx = _gate_write_action_with_identity(
        router_ctx, context, message, previous_router_ctx
    )
    router_model = _agent_configured_model_id(router)

    agent_name = router_ctx.get("agent", "onboarding_agent")
    logger.info(
        "Router decidiu → model=%s | agent=%s | stage=%s | active_pet=%s | service=%s | date=%s | awaiting_confirmation=%s | required_tools=%s",
        router_model,
        agent_name,
        router_ctx.get("stage"),
        router_ctx.get("active_pet"),
        router_ctx.get("service"),
        router_ctx.get("date_mentioned"),
        router_ctx.get("awaiting_confirmation"),
        format_required_tools_for_log(router_ctx),
    )

    # ── 1.5 Pré-processamento de identidade ───────────────
    # Quando o agente é identity_agent, executa a extração da mensagem atual
    # ANTES de invocar o LLM e injeta o snapshot consolidado no contexto.
    # Isso garante que a memória entre turnos seja determinística — o agente
    # não precisa lembrar de chamar `parse_personal_data`, ele só decide o que
    # responder com base nos campos `identity_partial_snapshot` já mesclados.
    if agent_name == "identity_agent":
        try:
            from tools.identity_agent_tools import preprocess_identity_message
            # Prefere o phone do request (sempre presente) ao do client_dict
            # (que pode vir vazio se o cliente ainda não existe no banco).
            client_phone_for_partial = (
                context.get("request_client_phone")
                or (context.get("client") or {}).get("phone")
                or ""
            )
            snapshot = preprocess_identity_message(
                company_id=context["company_id"],
                client_phone=client_phone_for_partial,
                client=context.get("client") or {},
                message_text=message,
            )
            context["identity_partial_snapshot"] = snapshot
            logger.info(
                "identity preprocess | missing=%s reroute=%s cpf_invalid=%s",
                snapshot.get("missing"),
                snapshot.get("reroute_cpf_to_phone"),
                snapshot.get("cpf_invalid"),
            )
        except Exception:
            logger.exception("identity preprocess falhou — agente seguirá sem snapshot")

    # ── 2. Especialista ───────────────────────────
    logger.info("Invocando especialista → %s", agent_name)
    specialist = _build_specialist(agent_name, context, router_ctx)
    base_input = (
        _build_specialist_input(message, history, router_ctx)
        + build_router_tools_instruction_block(router_ctx)
    )
    if agent_name in {"booking_agent", "health_agent"} and not router_says_conversation_only(router_ctx):
        cache_hint = build_booking_tool_cache_hint(context, router_ctx)
        if cache_hint:
            base_input = base_input + cache_hint

        pets_hint = build_pets_cache_hint(context)
        if pets_hint:
            base_input = base_input + pets_hint
            logger.info("CACHE | pets hint injetado | agent=%s", agent_name)

        appts_hint = build_upcoming_appointments_hint(context, router_ctx)
        if appts_hint:
            base_input = base_input + appts_hint
            logger.info("CACHE | upcoming appointments hint injetado | agent=%s", agent_name)

        # Mesma pré-carga do health: sem isso o modelo lista ou nega horários sem JSON da tool.
        if router_ctx.get("required_tools") is None or router_wants_category(
            router_ctx, "slots"
        ):
            snap = _booking_availability_snapshot_block(context, router_ctx)
            if snap:
                base_input = base_input + snap
    # Rastrear agente anterior (histórico não contém agent_used — inferir da última msg do assistente)
    previous_agent: str | None = None
    if history:
        last_entry = history[-1] if isinstance(history[-1], dict) else None
        previous_agent = last_entry.get("agent_used") if last_entry else None

    # Guardrails de pré-processamento
    specialist_input = await apply_guardrails(
        specialist_input=base_input,
        context=context,
        router_ctx=router_ctx,
        history=history,
        previous_agent=previous_agent,
        current_user_message=message,
    )

    # Enxugamento de contexto
    specialist_input = trim_specialist_input(specialist_input, router_ctx)

    base_input_with_guardrails = specialist_input
    specialist_response = None
    reply = ""
    _POST_GUARDRAIL_MAX = 1  # Máximo de 1 reprocessamento por guardrail pós-processamento
    post_guardrail_count = 0

    for attempt in range(_VERIFICAR_REPROCESS_MAX):
        specialist_response = specialist.run(specialist_input)
        reply = _sanitize_specialist_reply((specialist_response.content or "").strip())
        if agent_name == "booking_agent" and reply:
            cleaned = _BOOKING_LEADING_NOISE.sub("", reply).strip()
            if cleaned:
                reply = cleaned

        if not _must_reprocess_verificar(agent_name, specialist_response, reply):
            # Guardrails de pós-processamento (com limite próprio para evitar loops)
            if post_guardrail_count < _POST_GUARDRAIL_MAX:
                must_reprocess, reprocess_suffix = check_post_guardrails(
                    reply=reply,
                    run_output=specialist_response,
                    agent_name=agent_name,
                    router_ctx=router_ctx,
                    history=history,
                    current_user_message=message,
                )
                if not must_reprocess:
                    break
                post_guardrail_count += 1
                logger.warning(
                    "GUARDRAIL pós-processamento disparou reprocessamento (%s/%s) | agent=%s | motivo=%.100s",
                    post_guardrail_count, _POST_GUARDRAIL_MAX, agent_name, reprocess_suffix
                )
                specialist_input = base_input_with_guardrails + reprocess_suffix
                continue
            else:
                logger.warning(
                    "GUARDRAIL pós-processamento atingiu limite de %s — aceitando resposta como está | agent=%s",
                    _POST_GUARDRAIL_MAX, agent_name
                )
                break

        logger.warning(
            "Reprocessando especialista por 'verificar/retorno em breve' fora de escalonamento | agent=%s attempt=%s/%s",
            agent_name,
            attempt + 1,
            _VERIFICAR_REPROCESS_MAX,
        )
        specialist_input = base_input_with_guardrails + _REPROCESS_VERIFICAR_SUFFIX

    if (
        specialist_response
        and _must_reprocess_verificar(agent_name, specialist_response, reply)
    ):
        logger.error(
            "Resposta ainda contém 'verificar/retorno em breve' após %s reprocessamentos — removendo trechos",
            _VERIFICAR_REPROCESS_MAX,
        )
        reply = _emergency_strip_verificar(reply)

    reply = _sanitize_specialist_reply(reply)
    if specialist_response is not None:
        reply = _normalize_booking_false_reschedule_wording(
            agent_name, specialist_response, reply
        )

    specialist_model = _agent_configured_model_id(specialist)
    logger.info(
        "Especialista concluído → agent=%s | model=%s",
        agent_name,
        specialist_model,
    )

    return {
        "reply": reply,
        "agent_used": agent_name,
        "router_ctx": router_ctx,
        "llm_models": {
            "router": router_model,
            "specialist": specialist_model,
        },
    }


def _parse_router_response(content: str) -> dict:
    """Parseia JSON do router com fallback seguro."""
    try:
        clean = content.strip().strip("```json").strip("```").strip()
        parsed = json.loads(clean)
        if parsed.get("agent") not in VALID_AGENTS:
            logger.warning("Router retornou agente inválido=%r — usando faq_agent", parsed.get("agent"))
            parsed["agent"] = "faq_agent"
        merged = {**DEFAULT_ROUTER_CTX, **parsed}
        if "required_tools" in parsed:
            merged["required_tools"] = normalize_required_tools(parsed.get("required_tools"))
        else:
            merged["required_tools"] = _default_required_tools(
                merged.get("agent", DEFAULT_ROUTER_CTX["agent"]),
                str(merged.get("stage", DEFAULT_ROUTER_CTX["stage"])).upper(),
            )
        return merged
    except Exception:
        logger.warning("Falha ao parsear JSON do router — usando DEFAULT_ROUTER_CTX. content=%.200r", content)
        return DEFAULT_ROUTER_CTX.copy()


def _build_specialist(agent_name: str, context: dict, router_ctx: dict) -> Agent:
    if router_ctx.get("specialty_type") == "health":
        return build_health_agent(context, router_ctx)

    builders = {
        "onboarding_agent": build_onboarding_agent,
        "booking_agent": build_booking_agent,
        "lodging_agent": build_lodging_agent,
        "health_agent": build_health_agent,
        "faq_agent": build_faq_agent,
        "sales_agent": build_sales_agent,
        "escalation_agent": build_escalation_agent,
        "identity_agent": build_identity_agent,
    }
    builder = builders.get(agent_name, build_faq_agent)
    return builder(context, router_ctx)


def _format_history(history: list) -> str:
    if not history:
        return ""
    lines = []
    for msg in history:
        r = msg.get("role")
        if r == "system":
            lines.append(f"Resumo estruturado (trecho anterior):\n{msg.get('content', '')}")
            continue
        role = "Cliente" if r == "user" else "Assistente"
        lines.append(f"{role}: {msg['content']}")
    return "\n".join(lines)


def _format_router_state(router_ctx: dict | None) -> str:
    if not router_ctx:
        return ""
    parts = [
        f"agent={router_ctx.get('agent') or 'unknown'}",
        f"stage={router_ctx.get('stage') or 'unknown'}",
    ]
    for key in (
        "active_pet",
        "service",
        "date_mentioned",
        "selected_time",
        "checkin_mentioned",
        "checkout_mentioned",
    ):
        value = router_ctx.get(key)
        if value:
            parts.append(f"{key}={value}")
    required_tools = router_ctx.get("required_tools")
    if required_tools:
        parts.append(f"required_tools={required_tools}")
    if router_ctx.get("awaiting_confirmation"):
        parts.append("awaiting_confirmation=true")
    pending = router_ctx.get("pending_intent")
    if pending and pending.get("agent"):
        parts.append(
            f"pending_intent={pending['agent']}"
            + (f"/{pending['summary']}" if pending.get("summary") else "")
        )
    return "Resumo do último estado do roteador: " + " | ".join(parts)


def _build_specialist_input(message: str, history: list, router_ctx: dict) -> str:
    history_text = _format_history(history)
    ctx_summary = []
    if router_ctx.get("active_pet"):
        ctx_summary.append(f"Pet ativo: {router_ctx['active_pet']}")
    if router_ctx.get("service"):
        ctx_summary.append(f"Serviço: {router_ctx['service']}")
    if router_ctx.get("date_mentioned"):
        ctx_summary.append(f"Data mencionada: {router_ctx['date_mentioned']}")
    if router_ctx.get("selected_time"):
        ctx_summary.append(f"Horário selecionado: {router_ctx['selected_time']}")
    if router_ctx.get("awaiting_confirmation"):
        ctx_summary.append("Status: aguardando confirmação do cliente")

    parts = []
    if history_text:
        parts.append(f"Histórico:\n{history_text}")
    if ctx_summary:
        parts.append(f"Contexto extraído: {' | '.join(ctx_summary)}")
    parts.append(f"Mensagem atual: {message}")

    return "\n\n".join(parts)
