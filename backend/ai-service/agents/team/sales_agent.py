from agno.agent import Agent
from agno.models.openai import OpenAIChat
from config import OPENAI_MODEL
from prompts.sales_prompt import build_sales_prompt
from tools.booking_tools import build_booking_tools
from tools.client_tools import build_client_tools


def build_sales_agent(context: dict, router_ctx: dict) -> Agent:
    company_id = context["company_id"]
    client_id = (context.get("client") or {}).get("id", "")

    # Sales needs get_services + set_pet_size (to collect porte for pricing)
    get_services = build_booking_tools(company_id, client_id)[0]
    client_tools = build_client_tools(company_id, client_id)
    # set_pet_size is at index 2 in the list
    set_pet_size = client_tools[2]

    return Agent(
        name="Sales Agent",
        model=OpenAIChat(id="gpt-4o"),
        instructions=build_sales_prompt(context, router_ctx),
        tools=[get_services, set_pet_size],
    )
