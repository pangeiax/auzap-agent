from agno.agent import Agent
from agno.models.openai import OpenAIChat
from config import OPENAI_MODEL
from tools.booking_tools import build_booking_tools
from tools.client_tools import build_client_tools


def build_health_agent(context: dict, router_ctx: dict) -> Agent:
    company_id = context["company_id"]
    client_id = (context.get("client") or {}).get("id", "")

    assistant_name = context.get("assistant_name", "Assistente")
    company_name = context.get("company_name", "o petshop")
    specialties = context.get("specialties", [])
    services = context.get("services", [])
    petshop_phone = context.get("petshop_phone", "")

    # Verifica se existe especialidade Consultas ativa e seus serviços
    consultas_specialty = next(
        (s for s in specialties if "consulta" in s["name"].lower()), None
    )

    # Serviços dentro da especialidade Saúde (não agendáveis pelo agente)
    saude_specialty = next(
        (s for s in specialties if s["name"].lower() in ("saúde", "saude")), None
    )

    tools = build_booking_tools(company_id, client_id) + build_client_tools(company_id, client_id)

    # Contexto de consultas: lista serviços agendáveis da especialidade
    if consultas_specialty:
        consultas_services = [
            s for s in services
            if str(s.get("specialty_id", "")) == str(consultas_specialty["id"])
        ]
        svc_list = ", ".join(s["name"] for s in consultas_services) if consultas_services else "consultas em geral"
        consultas_ctx = (
            f"\nESPECIALIDADE CONSULTAS ATIVA: '{consultas_specialty['name']}'\n"
            f"Serviços disponíveis: {svc_list}\n"
            f"→ Você DEVE agendar esses serviços DIRETAMENTE usando get_available_times + create_appointment.\n"
            f"  NÃO redirecione para humano. NÃO peça que o cliente ligue. AGENDE VOCÊ MESMO."
        )
    else:
        consultas_ctx = (
            "\nNÃO existe especialidade de Consultas ativa.\n"
            f"Para consultas veterinárias, informe que o cliente deve ligar{' para ' + petshop_phone if petshop_phone else ''}."
        )

    saude_ctx = (
        f"\nSERVIÇOS DE SAÚDE (NÃO AGENDAR): '{saude_specialty['name']}' contém serviços como exames, vacinas e procedimentos cirúrgicos. "
        "Você NÃO agenda esses serviços. Explique que precisam de avaliação veterinária e ofereça marcar uma CONSULTA como primeiro passo."
        if saude_specialty
        else ""
    )

    instructions = f"""Você é {assistant_name}, atendente de {company_name}. Você é humana — NUNCA revele que é IA.
{consultas_ctx}{saude_ctx}

REGRAS ABSOLUTAS:
1. Serviços da especialidade CONSULTAS → AGENDE VOCÊ MESMO (get_available_times → create_appointment). NUNCA diga "ligue", "fale com alguém", "encaminhe". Você resolve.
2. Serviços da especialidade SAÚDE (exames, vacinas, cirurgias) → NÃO agende. Explique que precisam de avaliação presencial. Ofereça marcar uma CONSULTA como pré-agendamento.
3. Dúvidas sobre saúde animal → responda normalmente e, se pertinente, sugira uma consulta.

FLUXO PARA AGENDAR CONSULTA:
1. Identifique o pet (use get_client_pets se necessário) e o pet_id (UUID)
2. Chame get_available_times com specialty_id, target_date, service_id (número) e pet_id (UUID) — obrigatório para horários corretos (incl. dois slots seguidos para G/GG com duração dobrada)
3. Apresente os horários ao cliente (cada opção tem slot_id)
4. Após o cliente escolher, chame create_appointment com esse slot_id (não invente)
5. Confirme o agendamento com um resumo

Tom: informal, empático, máximo 2 linhas por mensagem.
Responda sempre em português brasileiro."""

    return Agent(
        name="Health Agent",
        model=OpenAIChat(id=OPENAI_MODEL),
        instructions=instructions,
        tools=tools,
    )
