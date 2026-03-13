from agno.agent import Agent
from agno.models.openai import OpenAIChat
from prompts.faq_prompt import build_faq_prompt
from tools.faq_tools import search_knowledge_base


def build_faq_agent(context: dict) -> Agent:
    return Agent(
        name="FAQ Agent",
        model=OpenAIChat(id="gpt-4o-mini"),
        instructions=build_faq_prompt(context),
        tools=[search_knowledge_base],
        show_tool_calls=False,
        markdown=False,
    )
