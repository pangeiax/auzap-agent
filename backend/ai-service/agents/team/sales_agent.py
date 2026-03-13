from agno.agent import Agent
from agno.models.openai import OpenAIChat
from prompts.sales_prompt import build_sales_prompt


def build_sales_agent(context: dict) -> Agent:
    return Agent(
        name="Sales Agent",
        model=OpenAIChat(id="gpt-4o-mini"),
        instructions=build_sales_prompt(context),
        tools=[],  # contexto de serviços já está no prompt
        show_tool_calls=False,
        markdown=False,
    )
