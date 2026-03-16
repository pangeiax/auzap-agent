from agno.agent import Agent
from agno.models.openai import OpenAIChat
from config import OPENAI_MODEL
from prompts.booking_prompt import build_booking_prompt
from tools.booking_tools import build_booking_tools
from tools.client_tools import build_client_tools


def build_booking_agent(context: dict, router_ctx: dict) -> Agent:
    company_id = context["company_id"]
    client_id = (context.get("client") or {}).get("id", "")

    tools = build_booking_tools(company_id, client_id) + build_client_tools(company_id, client_id)

    return Agent(
        name="Booking Agent",
        model=OpenAIChat(id=OPENAI_MODEL),
        instructions=build_booking_prompt(context, router_ctx),
        tools=tools,
    )
