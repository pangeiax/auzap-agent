from agno.agent import Agent
from utils.openai_chat import openai_chat_for_agents
from agents.router_tool_plan import router_says_conversation_only
from config import OPENAI_MODEL
from prompts.shared_blocks import append_global_agent_max_rules
from prompts.specialists.faq import build_faq_prompt
from tools.faq_tools import search_knowledge_base
from tools.booking_tools import build_booking_tools


def build_faq_agent(context: dict, router_ctx: dict) -> Agent:
    company_id = context["company_id"]
    client_id = (context.get("client") or {}).get("id", "")

    if router_says_conversation_only(router_ctx):
        tools = []
    else:
        get_services = build_booking_tools(company_id, client_id)[1]
        tools = [search_knowledge_base, get_services]

    return Agent(
        name="FAQ Agent",
        model=openai_chat_for_agents(OPENAI_MODEL),
        instructions=append_global_agent_max_rules(build_faq_prompt(context, router_ctx)),
        tools=tools,
        tool_call_limit=2,
    )
