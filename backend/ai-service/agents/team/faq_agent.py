from agno.agent import Agent
from agno.models.openai import OpenAIChat
from config import OPENAI_MODEL
from prompts.sales_prompt import build_faq_prompt
from tools.faq_tools import search_knowledge_base


def build_faq_agent(context: dict, router_ctx: dict) -> Agent:
    return Agent(
        name="FAQ Agent",
        model=OpenAIChat(id=OPENAI_MODEL),
        instructions=build_faq_prompt(context, router_ctx),
        tools=[search_knowledge_base],
    )
