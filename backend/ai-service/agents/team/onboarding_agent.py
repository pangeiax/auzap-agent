from agno.agent import Agent
from agno.models.openai import OpenAIChat
from config import OPENAI_MODEL
from prompts.onboarding_prompt import build_onboarding_prompt
from tools.client_tools import build_client_tools


def build_onboarding_agent(context: dict, router_ctx: dict) -> Agent:
    company_id = context["company_id"]
    client_id = (context.get("client") or {}).get("id", "")

    return Agent(
        name="Onboarding Agent",
        model=OpenAIChat(id=OPENAI_MODEL),
        instructions=build_onboarding_prompt(context, router_ctx),
        tools=build_client_tools(company_id, client_id),
    )
