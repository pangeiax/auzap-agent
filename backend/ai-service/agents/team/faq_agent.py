from agno.agent import Agent
from agno.models.openai import OpenAIChat
from config import OPENAI_MODEL
from prompts.sales_prompt import build_faq_prompt
from tools.faq_tools import search_knowledge_base
from tools.booking_tools import build_booking_tools
from tools.client_tools import build_client_tools


def build_faq_agent(context: dict, router_ctx: dict) -> Agent:
    company_id = context["company_id"]
    client_id = (context.get("client") or {}).get("id", "")

    # build_booking_tools: [0]=get_specialties, [1]=get_services, …
    get_services = build_booking_tools(company_id, client_id)[1]
    client_tools = build_client_tools(company_id, client_id)
    set_pet_size = client_tools[2]

    return Agent(
        name="FAQ Agent",
        model=OpenAIChat(id=OPENAI_MODEL),
        instructions=build_faq_prompt(context, router_ctx),
        tools=[search_knowledge_base, get_services, set_pet_size],
    )
