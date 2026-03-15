from agno.agent import Agent
from agno.models.openai import OpenAIChat
from config import OPENAI_MODEL
from prompts.onboarding_prompt import build_onboarding_prompt
from tools.client_tools import get_client_pets, create_pet


def build_onboarding_agent(context: dict, router_ctx: dict) -> Agent:
    return Agent(
        name="Onboarding Agent",
        model=OpenAIChat(id=OPENAI_MODEL),
        instructions=build_onboarding_prompt(context, router_ctx),
        tools=[get_client_pets, create_pet],
    )
