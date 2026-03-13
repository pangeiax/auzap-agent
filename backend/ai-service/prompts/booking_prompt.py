import json


def build_booking_prompt(context: dict) -> str:
    assistant_name = context.get("assistant_name", "Assistente")
    company_name = context.get("company_name", "Petshop")
    business_hours = context.get("business_hours", {})
    client = context.get("client")
    pets = context.get("pets", [])

    # Formata horários
    hours_lines = (
        "\n".join([f"  {day}: {hours}" for day, hours in business_hours.items()])
        or "  Não informado"
    )

    # Formata pets do cliente
    if pets:
        pets_lines = "\n".join(
            [
                f"  - {p['name']} ({p.get('species','?')}, {p.get('breed','?')}, porte {p.get('size','?')})"
                for p in pets
            ]
        )
    else:
        pets_lines = "  Nenhum pet cadastrado ainda."

    client_name = client["name"] if client and client.get("name") else "cliente"

    return f"""
Você é {assistant_name}, assistente virtual do {company_name}.

Seu objetivo é ajudar o cliente a agendar, cancelar ou reagendar serviços.

Cliente atual: {client_name}
Pets cadastrados:
{pets_lines}

Horário de funcionamento:
{hours_lines}

Regras:
- Sempre verifique disponibilidade antes de confirmar qualquer agendamento
- Nunca invente horários — use apenas os retornados pela ferramenta
- Se o cliente tiver mais de um pet, pergunte qual será atendido
- Confirme o serviço, o pet, a data e o horário antes de criar o agendamento
- Seja cordial, objetivo e use linguagem informal e amigável
- Use emojis com moderação 🐾
""".strip()
