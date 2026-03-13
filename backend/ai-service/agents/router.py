from agno.agent import Agent
from agno.models.openai import OpenAIChat
from prompts.router_prompt import build_router_prompt
from agents.team.booking_agent import build_booking_agent
from agents.team.faq_agent import build_faq_agent
from agents.team.sales_agent import build_sales_agent


async def run_router(message: str, context: dict, history: list) -> dict:
    """
    Executa o router agent para classificar a intenção,
    depois delega para o agente especialista correto.

    Returns:
        dict com "reply" e "agent_used"
    """

    # ── 1. Router: classifica a intenção ─────
    router = Agent(
        name="Router",
        model=OpenAIChat(id="gpt-4o-mini"),
        instructions=build_router_prompt(context),
        markdown=False,
    )

    # Monta histórico formatado para o router
    history_text = _format_history(history)
    router_input = f"{history_text}\nCliente: {message}" if history_text else message

    router_response = router.run(router_input)
    agent_name = router_response.content.strip().lower()

    # Fallback seguro caso o router retorne algo inesperado
    if agent_name not in ("booking_agent", "faq_agent", "sales_agent"):
        agent_name = "faq_agent"

    # ── 2. Constrói e executa o agente especialista ──
    specialist = _build_specialist(agent_name, context)

    # Passa histórico + mensagem atual para o especialista
    specialist_input = _build_specialist_input(message, history)
    specialist_response = specialist.run(specialist_input)

    return {
        "reply": specialist_response.content.strip(),
        "agent_used": agent_name,
    }


def _build_specialist(agent_name: str, context: dict) -> Agent:
    """Instancia o agente especialista pelo nome."""
    if agent_name == "booking_agent":
        return build_booking_agent(context)
    elif agent_name == "sales_agent":
        return build_sales_agent(context)
    else:
        return build_faq_agent(context)


def _format_history(history: list) -> str:
    """Formata histórico como texto para contexto do agente."""
    if not history:
        return ""
    lines = []
    for msg in history:
        role = "Cliente" if msg["role"] == "user" else "Assistente"
        lines.append(f"{role}: {msg['content']}")
    return "\n".join(lines)


def _build_specialist_input(message: str, history: list) -> str:
    """
    Monta o input completo para o especialista:
    histórico recente + mensagem atual.
    """
    history_text = _format_history(history)
    if history_text:
        return f"Histórico da conversa:\n{history_text}\n\nMensagem atual do cliente: {message}"
    return message
