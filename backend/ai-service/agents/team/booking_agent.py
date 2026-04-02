from agno.agent import Agent
from agents.router_tool_plan import router_says_conversation_only
from utils.openai_chat import openai_chat_for_agents
from config import OPENAI_MODEL, OPENAI_MODEL_ADVANCED
from prompts.shared_blocks import append_global_agent_max_rules
from prompts.specialists.booking import build_booking_prompt
from tools.booking_tools import build_booking_tools
from tools.client_tools import build_client_tools
from tools.escalation_tools import build_escalation_tools


def build_booking_agent(context: dict, router_ctx: dict) -> Agent:
    company_id = context["company_id"]
    client_id = (context.get("client") or {}).get("id", "")

    stage_upper = (router_ctx.get("stage") or "").strip().upper()
    if router_says_conversation_only(router_ctx) and stage_upper == "COMPLETED":
        tools = []
    else:
        tools = (
            build_booking_tools(company_id, client_id)
            + build_client_tools(company_id, client_id)
            + build_escalation_tools(company_id, client_id)
        )

    return Agent(
        name="Booking Agent",
        model=openai_chat_for_agents(OPENAI_MODEL_ADVANCED, advanced=True),
        instructions=append_global_agent_max_rules(build_booking_prompt(context, router_ctx)),
        tools=tools,
        tool_call_limit=10,
    )
