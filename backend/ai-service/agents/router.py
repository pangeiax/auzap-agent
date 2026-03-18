import json
import logging
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

logger = logging.getLogger("ai-service.router")

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
    specialist_input = _build_specialist_input(message, history, router_ctx)
    specialist_response = specialist.run(specialist_input)
    logger.info("Especialista %s concluiu", agent_name)

    return {
        "reply": specialist_response.content.strip(),
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
