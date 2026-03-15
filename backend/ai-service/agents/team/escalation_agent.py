from agno.agent import Agent
from agno.models.openai import OpenAIChat
from config import OPENAI_MODEL
from prompts.sales_prompt import build_escalation_prompt
from tools.escalation_tools import escalate_to_human


def build_escalation_agent(context: dict, router_ctx: dict) -> Agent:
    return Agent(
        name="Escalation Agent",
        model=OpenAIChat(id=OPENAI_MODEL),
        instructions=build_escalation_prompt(context, router_ctx),
        tools=[escalate_to_human],
    )
