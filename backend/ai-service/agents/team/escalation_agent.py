from agno.agent import Agent
from utils.openai_chat import openai_chat_for_agents
from config import OPENAI_MODEL
from prompts.shared_blocks import append_global_agent_max_rules
from prompts.specialists.escalation import build_escalation_prompt
from tools.escalation_tools import build_escalation_tools


def build_escalation_agent(context: dict, router_ctx: dict) -> Agent:
    company_id = context["company_id"]
    client_id = (context.get("client") or {}).get("id", "")

    return Agent(
        name="Escalation Agent",
        model=openai_chat_for_agents(OPENAI_MODEL),
        instructions=append_global_agent_max_rules(build_escalation_prompt(context, router_ctx)),
        tools=build_escalation_tools(company_id, client_id),
        # Tool + mensagem curta ao cliente após success
        tool_call_limit=2,
    )
