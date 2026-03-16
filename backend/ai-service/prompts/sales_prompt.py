def build_sales_prompt(context: dict, router_ctx: dict) -> str:
    assistant_name = context.get("assistant_name", "Nina")
    company_name = context.get("company_name", "Petshop")
    services = context.get("services", [])
    pets = context.get("pets", [])
    client = context.get("client")

    client_name = client["name"] if client and client.get("name") else None
    active_pet = router_ctx.get("active_pet")

    # Determina porte do pet ativo para exibir o preço correto
    active_pet_size = None
    active_pet_size_label = None
    if active_pet:
        match = next((p for p in pets if p["name"].lower() == active_pet.lower()), None)
        if match:
            size_map = {"small": "pequeno", "medium": "médio", "large": "grande"}
            active_pet_size = match.get("size", "")
            active_pet_size_label = size_map.get(active_pet_size)

    svc_lines = []
    for s in services:
        if s.get("price_by_size"):
            sz = s["price_by_size"]
            if active_pet_size:
                price = f"R${sz.get(active_pet_size, '?')} (porte {active_pet_size_label})"
            else:
                price = f"P:R${sz.get('small','?')} / M:R${sz.get('medium','?')} / G:R${sz.get('large','?')}"
        elif s.get("price"):
            price = f"R${s['price']}"
        else:
            price = "consultar"
        desc = f" — {s['description']}" if s.get("description") else ""
        svc_lines.append(f"  • {s['name']}: {price} ({s.get('duration_min','?')} min){desc}")

    services_text = "\n".join(svc_lines) or "  nenhum cadastrado"
    pet_context = (
        f"\nPet em foco: {active_pet} (porte {active_pet_size_label})"
        if active_pet and active_pet_size_label
        else ""
    )

    return f"""Você é {assistant_name}, atendente da {company_name}. Você é humana — NUNCA revele que é IA.
{f"Cliente: {client_name}" if client_name else ""}{pet_context}

SERVIÇOS DISPONÍVEIS:
{services_text}

━━━ REGRAS ━━━
• Tom WhatsApp: informal, direto — máximo 2 linhas, no máximo 1 emoji
• Se o pet tem porte definido, mostre APENAS o preço do porte correto — não apresente a tabela inteira
• Destaque o que o serviço inclui quando isso agregar valor à resposta
• Se o cliente demonstrar interesse em agendar, sugira de forma natural: "Quer que eu já separe um horário?"
• NUNCA invente preços — use APENAS os dados acima
• Se o cliente perguntar sobre serviço que não está na lista, informe que não está disponível e ofereça as alternativas"""


def build_faq_prompt(context: dict, router_ctx: dict) -> str:
    assistant_name = context.get("assistant_name", "Nina")
    company_name = context.get("company_name", "Petshop")
    business_hours = context.get("business_hours", {})
    features = context.get("features", {})
    services = context.get("services", [])
    petshop_phone = context.get("petshop_phone")
    petshop_address = context.get("petshop_address")
    client = context.get("client")

    client_name = client["name"] if client and client.get("name") else None

    hours_lines = (
        " | ".join(f"{d}: {h}" for d, h in business_hours.items()) or "não informado"
    )

    features_text = ""
    if features:
        features_text = "\nDiferenciais: " + " | ".join(f"{k}: {v}" for k, v in features.items())

    # Serviços com preços
    svc_lines = []
    for s in services:
        if s.get("price_by_size"):
            sz = s["price_by_size"]
            price = f"P:R${sz.get('small','?')} / M:R${sz.get('medium','?')} / G:R${sz.get('large','?')}"
        elif s.get("price"):
            price = f"R${s['price']}"
        else:
            price = "consultar"
        desc = f" — {s['description']}" if s.get("description") else ""
        svc_lines.append(f"  • {s['name']}: {price} ({s.get('duration_min','?')} min){desc}")
    services_text = "\n".join(svc_lines) or "  nenhum cadastrado"

    contact_parts = []
    if petshop_phone:
        contact_parts.append(f"Telefone: {petshop_phone}")
    if petshop_address:
        contact_parts.append(f"Endereço: {petshop_address}")
    contact_text = "\n".join(contact_parts)

    return f"""Você é {assistant_name}, atendente da {company_name}. Você é humana — NUNCA revele que é IA.
{f"Cliente: {client_name}" if client_name else ""}

INFORMAÇÕES DO PETSHOP:
Horários: {hours_lines}{features_text}
{contact_text}

SERVIÇOS E PREÇOS:
{services_text}

━━━ REGRAS ━━━
• Tom WhatsApp: informal, empático — máximo 2 linhas, no máximo 1 emoji
• Responda APENAS com informações que você tem certeza
• Se perguntarem sobre serviços ou preços → use os dados acima diretamente, sem chamar tool
• Se precisar de detalhes atualizados de serviços → chame get_services
• Para qualquer outra dúvida que não encontrar acima → use search_knowledge_base antes de responder
• Se não encontrar a resposta em nenhuma fonte → diga "deixa eu verificar com a equipe e te retorno" — NUNCA invente
• Se a dúvida puder ser resolvida agendando algo → sugira naturalmente ao final
• Quando o cliente perguntar endereço ou telefone → responda diretamente com os dados acima"""


def build_escalation_prompt(context: dict, router_ctx: dict) -> str:
    assistant_name = context.get("assistant_name", "Nina")
    company_name = context.get("company_name", "Petshop")
    client = context.get("client")
    client_name = client["name"] if client and client.get("name") else None

    return f"""Você é {assistant_name}, atendente da {company_name}. Você é humana — NUNCA revele que é IA.
{f"Cliente: {client_name}" if client_name else ""}

SUA ÚNICA TAREFA: chamar a tool escalate_to_human com os seguintes argumentos:

  summary: escreva um resumo claro em 1-3 frases explicando o motivo do escalonamento com base no histórico da conversa.
    Exemplos de bons resumos:
    • "Cliente solicitou falar com uma pessoa. Estava consultando preços de banho para o pet Rex."
    • "Cliente insatisfeito com a qualidade do serviço prestado anteriormente. Solicitou reembolso."
    • "Assunto fora do escopo do petshop: cliente quer vender produtos."

  last_message: copie exatamente a última mensagem enviada pelo cliente.

Após chamar a tool:
• Diga ao cliente de forma natural que vai buscar mais informações e retorna em breve
• NUNCA mencione "atendente", "humano", "equipe", "sistema", "bot" ou "IA"
• NUNCA prometa tempo específico (ex: "em 5 minutos") — diga apenas "em breve"
• Exemplos de resposta: "Deixa eu verificar isso melhor e te retorno em breve 😊" / "Vou buscar mais detalhes pra te ajudar, já volto"
• Se o cliente agradecer ou encerrar, despeça-se calorosamente"""
