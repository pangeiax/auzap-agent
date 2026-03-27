import json
import logging
import re
from datetime import date as date_cls
from agno.agent import Agent
from agno.models.openai import OpenAIChat
from config import OPENAI_MODEL
from prompts.router_prompt import build_router_prompt
from agents.team.onboarding_agent import build_onboarding_agent
from agents.team.booking_agent import build_booking_agent
from agents.team.faq_agent import build_faq_agent
from agents.team.sales_agent import build_sales_agent
from agents.team.escalation_agent import build_escalation_agent
from agents.team.lodging_agent import build_lodging_agent
from agents.team.health_agent import build_health_agent
from tools.booking_tools import fetch_available_times_snapshot

logger = logging.getLogger("ai-service.router")

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
_VERIFICAR_REPROCESS_MAX = 3
_REPROCESS_VERIFICAR_SUFFIX = """
━━━ REPROCESSAMENTO OBRIGATÓRIO (sistema) ━━━
A resposta anterior foi rejeitada: usou frase(s) do tipo "vou verificar" / "retorno em breve" / "deixa eu ver"
fora do fluxo de escalonamento humano (tool escalate_to_human).
Gere UMA nova resposta ao cliente, em português, curta (WhatsApp):
• PROIBIDO: "vou verificar", "deixa eu verificar", "estou verificando", "retorno em breve", "já volto",
  "só um instante", "aguarde", ou qualquer promessa de checagem futura sem entregar o conteúdo agora.
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


def _must_reprocess_verificar(agent_name: str, run_output, reply: str) -> bool:
    """Reprocessa se a resposta usa 'vou verificar' / 'retorno em breve' fora do escalonamento com tool."""
    if not _reply_triggers_verificar_reprocess(reply):
        return False
    if agent_name == "escalation_agent" and _escalation_tool_succeeded(run_output):
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
    Pré-executa get_available_times e injeta JSON na entrada do especialista (booking_agent e health_agent).
    Evita respostas sem tool e negações inventadas sobre horários.
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


async def run_router(message: str, context: dict, history: list) -> dict:
    """
    1. Router classifica intenção e extrai contexto acumulado (JSON)
    2. Especialista responde com contexto completo
    """

    # ── 1. Router ────────────────────────────────
    router = Agent(
        name="Router",
        model=OpenAIChat(id=OPENAI_MODEL),
        instructions=build_router_prompt(context),
    )

    history_text = _format_history(history)
    router_input = f"{history_text}\nCliente: {message}" if history_text else message

    router_response = router.run(router_input)
    router_ctx = _parse_router_response(router_response.content)

    agent_name = router_ctx.get("agent", "onboarding_agent")
    logger.info(
        "Router decidiu → agent=%s | stage=%s | active_pet=%s | service=%s | date=%s | awaiting_confirmation=%s",
        agent_name,
        router_ctx.get("stage"),
        router_ctx.get("active_pet"),
        router_ctx.get("service"),
        router_ctx.get("date_mentioned"),
        router_ctx.get("awaiting_confirmation"),
    )

    # ── 2. Especialista ───────────────────────────
    logger.info("Invocando especialista → %s", agent_name)
    specialist = _build_specialist(agent_name, context, router_ctx)
    base_input = _build_specialist_input(message, history, router_ctx)
    # Mesma pré-carga de get_available_times do booking — health_agent também agenda e
    # antes só recebia lista “na cabeça” do modelo ou dependia 100% da tool na hora.
    if agent_name in ("booking_agent", "health_agent"):
        snap = _booking_availability_snapshot_block(context, router_ctx)
        if snap:
            base_input = base_input + snap
    specialist_input = base_input
    specialist_response = None
    reply = ""

    for attempt in range(_VERIFICAR_REPROCESS_MAX):
        specialist_response = specialist.run(specialist_input)
        reply = (specialist_response.content or "").strip()
        if agent_name == "booking_agent" and reply:
            cleaned = _BOOKING_LEADING_NOISE.sub("", reply).strip()
            if cleaned:
                reply = cleaned

        if not _must_reprocess_verificar(agent_name, specialist_response, reply):
            break
        logger.warning(
            "Reprocessando especialista por 'verificar/retorno em breve' fora de escalonamento | agent=%s attempt=%s/%s",
            agent_name,
            attempt + 1,
            _VERIFICAR_REPROCESS_MAX,
        )
        specialist_input = base_input + _REPROCESS_VERIFICAR_SUFFIX

    if (
        specialist_response
        and _must_reprocess_verificar(agent_name, specialist_response, reply)
    ):
        logger.error(
            "Resposta ainda contém 'verificar/retorno em breve' após %s reprocessamentos — removendo trechos",
            _VERIFICAR_REPROCESS_MAX,
        )
        reply = _emergency_strip_verificar(reply)

    logger.info("Especialista %s concluiu", agent_name)

    return {
        "reply": reply,
        "agent_used": agent_name,
        "router_ctx": router_ctx,
    }


def _parse_router_response(content: str) -> dict:
    """Parseia JSON do router com fallback seguro."""
    try:
        clean = content.strip().strip("```json").strip("```").strip()
        parsed = json.loads(clean)
        if parsed.get("agent") not in VALID_AGENTS:
            logger.warning("Router retornou agente inválido=%r — usando faq_agent", parsed.get("agent"))
            parsed["agent"] = "faq_agent"
        return {**DEFAULT_ROUTER_CTX, **parsed}
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
    }
    builder = builders.get(agent_name, build_faq_agent)
    return builder(context, router_ctx)


def _format_history(history: list) -> str:
    if not history:
        return ""
    lines = []
    for msg in history:
        role = "Cliente" if msg["role"] == "user" else "Assistente"
        lines.append(f"{role}: {msg['content']}")
    return "\n".join(lines)


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
