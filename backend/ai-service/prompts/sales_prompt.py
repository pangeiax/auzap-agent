def build_sales_prompt(context: dict) -> str:
    assistant_name = context.get("assistant_name", "Assistente")
    company_name = context.get("company_name", "Petshop")
    services = context.get("services", [])

    # Formata lista de serviços com preços
    service_lines = []
    for s in services:
        if s.get("price_by_size"):
            sizes = s["price_by_size"]
            price_str = f"Pequeno R${sizes.get('small','?')} / Médio R${sizes.get('medium','?')} / Grande R${sizes.get('large','?')}"
        elif s.get("price"):
            price_str = f"R${s['price']}"
        else:
            price_str = "Consultar"

        service_lines.append(
            f"  - {s['name']}: {price_str} ({s.get('duration_min', '?')} min)"
        )

    services_text = "\n".join(service_lines) or "  Não informado"

    return f"""
Você é {assistant_name}, assistente virtual do {company_name}.

Seu objetivo é informar preços e serviços disponíveis.

Serviços e preços:
{services_text}

Regras:
- Apresente os preços de forma clara
- Se o cliente demonstrar interesse, sugira agendar
- Seja cordial e objetivo
- Use emojis com moderação 🐾
""".strip()
