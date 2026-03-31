from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agents.router_tool_plan import router_says_conversation_only
from config import OPENAI_MODEL, OPENAI_MODEL_ADVANCED
from prompts.booking_prompt import build_booking_prompt
from tools.booking_tools import build_booking_tools
from tools.client_tools import build_client_tools
from utils.model_utils import get_max_tokens_param


def build_booking_agent(context: dict, router_ctx: dict) -> Agent:
    company_id = context["company_id"]
    client_id = (context.get("client") or {}).get("id", "")

    stage_upper = (router_ctx.get("stage") or "").strip().upper()
    if router_says_conversation_only(router_ctx) and stage_upper == "COMPLETED":
        tools = []
    else:
        tools = build_booking_tools(company_id, client_id) + build_client_tools(
            company_id, client_id
        )

    return Agent(
        name="Booking Agent",
        model=OpenAIChat(id=OPENAI_MODEL_ADVANCED, **get_max_tokens_param(OPENAI_MODEL_ADVANCED, 2000)),
        instructions=build_booking_prompt(context, router_ctx),
        tools=tools,
    )
