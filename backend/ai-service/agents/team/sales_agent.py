from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agents.router_tool_plan import router_says_conversation_only
from config import OPENAI_MODEL, OPENAI_MODEL_ADVANCED
from prompts.sales_prompt import build_sales_prompt
from tools.booking_tools import build_booking_tools
from tools.client_tools import build_client_tools
from utils.model_utils import get_max_tokens_param


def build_sales_agent(context: dict, router_ctx: dict) -> Agent:
    company_id = context["company_id"]
    client_id = (context.get("client") or {}).get("id", "")

    if router_says_conversation_only(router_ctx):
        tools = []
    else:
        # Sales needs get_services + set_pet_size (to collect porte for pricing)
        get_services = build_booking_tools(company_id, client_id)[1]
        client_tools = build_client_tools(company_id, client_id)
        set_pet_size = client_tools[2]
        tools = [get_services, set_pet_size]

    return Agent(
        name="Sales Agent",
        model=OpenAIChat(id=OPENAI_MODEL_ADVANCED, **get_max_tokens_param(OPENAI_MODEL_ADVANCED, 5000)),
        instructions=build_sales_prompt(context, router_ctx),
        tools=tools,
    )
