from agno.agent import Agent
from agno.models.openai import OpenAIChat
from config import OPENAI_MODEL
from tools.lodging_tools import build_lodging_tools
from tools.client_tools import build_client_tools


def build_lodging_agent(context: dict, router_ctx: dict) -> Agent:
    company_id = context["company_id"]
    client_id = (context.get("client") or {}).get("id", "")

    company_name = context.get("company_name") or "o petshop"
    assistant_name = context.get("assistant_name") or "Assistente"

    lodging_type = router_ctx.get("lodging_type") or "hotel"
    tools = build_lodging_tools(company_id, client_id, lodging_type) + build_client_tools(company_id, client_id)

    checkin_mentioned = router_ctx.get("checkin_mentioned")
    checkout_mentioned = router_ctx.get("checkout_mentioned")
    active_pet = router_ctx.get("active_pet")

    type_label = "Hotel" if lodging_type == "hotel" else "Creche"
    type_ctx = f"\nTipo de hospedagem: {type_label}"

    date_ctx = ""
    if checkin_mentioned:
        date_ctx += f"\nCheck-in mencionado: {checkin_mentioned}"
    if checkout_mentioned:
        date_ctx += f"\nCheck-out mencionado: {checkout_mentioned}"
    if active_pet:
        date_ctx += f"\nPet em foco: {active_pet}"

    instructions = f"""Você é {assistant_name}, assistente de hospedagem de {company_name}.

Sua responsabilidade: gerenciar hospedagens (hotel e creche para pets).
{type_ctx}{date_ctx}

FLUXO DE HOSPEDAGEM:
1. Confirme o pet (use get_client_pets — verifique se está cadastrado)
2. Pergunte datas de check-in e check-out (se não informadas)
3. Chame get_kennel_availability — a resposta já traz o valor diário (daily_rate), total e vagas disponíveis
4. Apresente o resumo com valor diário e total ao cliente
5. Pergunte sobre cuidados especiais (medicação, alimentação especial)
6. Envie resumo completo e peça confirmação explícita ("sim", "pode confirmar", "confirma")
7. Chame create_lodging com confirmed=True — NÃO passe daily_rate, o sistema busca automaticamente

REGRAS:
- NUNCA peça o valor da diária ao cliente — ele vem da configuração do petshop via get_kennel_availability
- NUNCA crie hospedagem sem confirmação explícita do cliente
- Se o cliente perguntar o valor, use o daily_rate retornado por get_kennel_availability
- Quando get_kennel_availability retornar "available: false" E incluir "nearest_available", você DEVE imediatamente oferecer esse período ao cliente — nunca peça novas datas sem antes apresentar a alternativa encontrada automaticamente
- Exemplo correto: "Infelizmente não temos vaga de 19/03 a 26/03, mas encontrei disponibilidade de 23/03 a 26/03! Quer confirmar?"

Responda sempre em português brasileiro, de forma amigável e profissional."""

    return Agent(
        name="Lodging Agent",
        model=OpenAIChat(id=OPENAI_MODEL),
        instructions=instructions,
        tools=tools,
    )
