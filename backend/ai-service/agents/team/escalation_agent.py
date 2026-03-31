from agno.agent import Agent
from agno.models.openai import OpenAIChat
from config import OPENAI_MODEL
from prompts.sales_prompt import build_escalation_prompt
from tools.escalation_tools import build_escalation_tools
from utils.model_utils import get_max_tokens_param


def build_escalation_agent(context: dict, router_ctx: dict) -> Agent:
    company_id = context["company_id"]
    client_id = (context.get("client") or {}).get("id", "")

    return Agent(
        name="Escalation Agent",
        model=OpenAIChat(id=OPENAI_MODEL, **get_max_tokens_param(OPENAI_MODEL, 500)),
        instructions=build_escalation_prompt(context, router_ctx),
        tools=build_escalation_tools(company_id, client_id),
    )
