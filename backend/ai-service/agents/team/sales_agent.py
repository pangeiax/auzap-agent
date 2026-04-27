from agno.agent import Agent
from agents.router_tool_plan import router_says_conversation_only
from utils.openai_chat import openai_chat_for_agents
from config import OPENAI_MODEL_ADVANCED, resolve_model
from prompts.shared_blocks import append_global_agent_max_rules
from prompts.specialists.sales import build_sales_prompt
from tools.booking_tools import build_booking_tools
from tools.client_tools import build_client_tools


def build_sales_agent(context: dict, router_ctx: dict) -> Agent:
    company_id = context["company_id"]
    client_id = (context.get("client") or {}).get("id", "")

    if router_says_conversation_only(router_ctx):
        tools = []
    else:
        # Sales needs get_services (catalog) + get_client_pets (resolve pet size for pricing)
        get_services = build_booking_tools(company_id, client_id)[1]
        client_tools = build_client_tools(company_id, client_id)
        get_client_pets = client_tools[0]
        tools = [get_services, get_client_pets]

    return Agent(
        name="Sales Agent",
        model=openai_chat_for_agents(resolve_model(OPENAI_MODEL_ADVANCED, context), advanced=True),
        instructions=append_global_agent_max_rules(build_sales_prompt(context, router_ctx)),
        tools=tools,
        tool_call_limit=2,
    )
