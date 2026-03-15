from agno.agent import Agent
from agno.models.openai import OpenAIChat
from config import OPENAI_MODEL
from prompts.sales_prompt import build_sales_prompt
from tools.booking_tools import get_services


def build_sales_agent(context: dict, router_ctx: dict) -> Agent:
    return Agent(
        name="Sales Agent",
        model=OpenAIChat(id=OPENAI_MODEL),
        instructions=build_sales_prompt(context, router_ctx),
        tools=[get_services],
    )
