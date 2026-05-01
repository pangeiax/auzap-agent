from agno.agent import Agent

from config import OPENAI_MODEL, resolve_model
from prompts.shared_blocks import append_global_agent_max_rules
from prompts.specialists.identity import build_identity_prompt
from tools.identity_agent_tools import build_identity_agent_tools
from utils.openai_chat import openai_chat_for_agents


def build_identity_agent(context: dict, router_ctx: dict) -> Agent:
    company_id = context["company_id"]
    client = context.get("client") or {}
    client_id = client.get("id", "")
    # Phone do request (sempre presente) tem prioridade sobre client.phone do
    # banco — garante chave Redis estável mesmo quando o cliente não existe ainda.
    client_phone = (
        context.get("request_client_phone")
        or client.get("phone", "")
    )

    # Snapshot do que já está no banco — vai pro prompt e pras tools.
    known_identity = {
        "name": client.get("name") or "",
        "email": client.get("email") or "",
        "manual_phone": client.get("manual_phone") or "",
        "cpf": client.get("cpf") or "",
    }

    return Agent(
        name="Identity Agent",
        model=openai_chat_for_agents(resolve_model(OPENAI_MODEL, context)),
        instructions=append_global_agent_max_rules(
            build_identity_prompt(context, router_ctx)
        ),
        tools=build_identity_agent_tools(
            company_id=company_id,
            client_id=str(client_id) if client_id else "",
            client_phone=str(client_phone) if client_phone else "",
            known_identity=known_identity,
        ),
        # parse → save → 1 escalate de segurança
        tool_call_limit=4,
    )
