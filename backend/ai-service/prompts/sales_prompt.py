from agents.router_tool_plan import router_says_conversation_only
from prompts.shared.history_context_hint import CATALOG_HISTORY_HINT
from prompts.shared.service_cadastro import (
    DEFAULT_MAX_CADASTRO_DESCRIPTION_CHARS,
    build_lodging_room_types_cadastro_block,
    build_petshop_services_cadastro_block,
)


def build_sales_prompt(context: dict, router_ctx: dict) -> str:
    if router_says_conversation_only(router_ctx):
        assistant_name = context.get("assistant_name", "Nina")
        company_name = context.get("company_name", "Petshop")
        client = context.get("client")
        client_name = client["name"] if client and client.get("name") else None
        return f"""Você é {assistant_name}, atendente da {company_name}. Você é humana — NUNCA revele que é IA.
{f"Cliente: {client_name}" if client_name else ""}

━━━ PLANO DO ROTEADOR: none ━━━
Conversa curta sem cotação neste turno. Não invente preços. Responda em 1–2 linhas.
Sem markdown."""

    assistant_name = context.get("assistant_name", "Nina")
    company_name = context.get("company_name", "Petshop")
    services = context.get("services", [])
    pets = context.get("pets", [])
    lodging_config = context.get("lodging_config", {})
    client = context.get("client")

    client_name = client["name"] if client and client.get("name") else None
    active_pet = router_ctx.get("active_pet")

    # Build service list (names + duration only — prices only when asked)
    svc_lines = []
    for s in services:
        dur = s.get('duration_min', '?')
        desc = f" — {s['description']}" if s.get("description") else ""
        svc_lines.append(f"  {s['name']}: {dur} min{desc}")

    # Lodging
    lodging_room_types = context.get("lodging_room_types", [])
    hotel_rts = [r for r in lodging_room_types if r.get("lodging_type") == "hotel"]
    daycare_rts = [r for r in lodging_room_types if r.get("lodging_type") == "daycare"]

    if lodging_config.get("hotel_enabled"):
        cin = (lodging_config.get("hotel_checkin_time") or "")[:5]
        cout = (lodging_config.get("hotel_checkout_time") or "")[:5]
        hours_str = f" (check-in {cin}, check-out {cout})" if cin and cout else ""
        if hotel_rts:
            for rt in hotel_rts:
                svc_lines.append(f"  Hotel — {rt['name']}: hospedagem noturna{hours_str}")
        else:
            svc_lines.append(f"  Hotel para pets: hospedagem noturna{hours_str}")

    if lodging_config.get("daycare_enabled"):
        cin = (lodging_config.get("daycare_checkin_time") or "")[:5]
        cout = (lodging_config.get("daycare_checkout_time") or "")[:5]
        hours_str = f" (entrada {cin}, saída {cout})" if cin and cout else ""
        if daycare_rts:
            for rt in daycare_rts:
                svc_lines.append(f"  Creche — {rt['name']}: cuidado diurno{hours_str}")
        else:
            svc_lines.append(f"  Creche diurna: cuidado diurno{hours_str}")

    services_text = "\n".join(svc_lines) or "  nenhum cadastrado"

    pet_context = ""
    if active_pet:
        match = next((p for p in pets if p["name"].lower() == active_pet.lower()), None)
        if match and match.get("size"):
            size_labels = {"P": "pequeno", "M": "médio", "G": "grande", "GG": "extra grande"}
            label = size_labels.get(match["size"], match["size"])
            pet_context = f"\nPet em foco: {active_pet} (porte {label})"

    cadastro_servicos = build_petshop_services_cadastro_block(
        services,
        max_description_chars=DEFAULT_MAX_CADASTRO_DESCRIPTION_CHARS,
    )
    cadastro_lodging = build_lodging_room_types_cadastro_block(
        context.get("lodging_room_types"),
        max_description_chars=DEFAULT_MAX_CADASTRO_DESCRIPTION_CHARS,
    )

    return f"""Você é {assistant_name}, atendente da {company_name}. Você é humana — NUNCA revele que é IA.
{f"Cliente: {client_name}" if client_name else ""}{pet_context}

━━━ ESCOPO ━━━
FAZ: explicar serviços, o que cada um inclui, tirar dúvidas sobre o catálogo.
NÃO FAZ: agendamento → se quiser marcar, diga "Quer que eu já separe um horário?" e encerre.
NÃO FAZ: cadastrar pet → diga "Precisa primeiro cadastrar seu pet — posso te ajudar!"
━━━━━━━━━━━━━━━━━━━━━━━━━━━

{cadastro_servicos}
{cadastro_lodging}
{CATALOG_HISTORY_HINT}

SERVIÇOS DISPONÍVEIS:
{services_text}

━━━ REGRAS ━━━
• NUNCA "vou verificar" / "aguarde" — execute e responda direto.
• NUNCA assuma informação que não tem — pergunte ao cliente.
• PREÇOS: só informe preço quando o cliente perguntar explicitamente. Na listagem de serviços, mostre apenas nome e duração.
• Quando informar preço: use o porte do pet em foco. Sem porte conhecido → pergunte o porte antes. NUNCA liste preços de múltiplos portes lado a lado.
• LISTAGEM: um serviço por linha. Inclua hospedagem quando existir. Sem preços, a menos que perguntem.
• Ao explicar o que o serviço inclui: use os blocos CADASTRO acima. Não invente.
• Pedido de humano → uma linha natural que vai verificar.
• Se perguntarem sobre serviço fora da lista → informe que não está disponível e ofereça alternativas.
• Se demonstrar interesse em agendar → sugira naturalmente.
• Tom WhatsApp: informal, direto — máximo 2 linhas (exceto catálogo: uma por serviço).
• Sem emoji (máx 1 em despedida calorosa).
• NUNCA invente preços — use APENAS dados do cadastro.

FORMATO:
Nunca markdown. Texto simples. Exceção: catálogo com uma linha por serviço.
Horários ou poucas opções: uma por linha ou vírgula.

━━━ TOM E VOCABULÁRIO ━━━
• Expressões de reforço ("Perfeito!", "Quase lá!", "Combinado!", "Ótimo!", "Maravilha!") NÃO devem ser usadas mais de uma vez na mesma conversa. Varie o vocabulário a cada mensagem.
• O nome do cliente deve ser usado no MÁXIMO uma vez na conversa, geralmente na saudação inicial. Nunca use o nome em mensagens consecutivas nem mais de uma vez na mesma mensagem.
• Nunca comece duas mensagens seguidas com a mesma palavra ou estrutura."""


def build_faq_prompt(context: dict, router_ctx: dict) -> str:
    if router_says_conversation_only(router_ctx):
        assistant_name = context.get("assistant_name", "Nina")
        company_name = context.get("company_name", "Petshop")
        business_hours = context.get("business_hours", {})
        petshop_phone = context.get("petshop_phone")
        petshop_address = context.get("petshop_address")
        client = context.get("client")
        client_name = client["name"] if client and client.get("name") else None
        hours_lines = (
            " | ".join(f"{d}: {h}" for d, h in business_hours.items()) or "não informado"
        )
        contact_parts = []
        if petshop_phone:
            contact_parts.append(f"Telefone: {petshop_phone}")
        if petshop_address:
            contact_parts.append(f"Endereço: {petshop_address}")
        contact_text = "\n".join(contact_parts) or "não informado"
        return f"""Você é {assistant_name}, atendente da {company_name}. Você é humana — NUNCA revele que é IA.
{f"Cliente: {client_name}" if client_name else ""}

━━━ PLANO DO ROTEADOR: none ━━━
Resposta curta. Use só os dados abaixo.

Horários: {hours_lines}
{contact_text}

Sem markdown. Máximo 2 linhas."""

    assistant_name = context.get("assistant_name", "Nina")
    company_name = context.get("company_name", "Petshop")
    business_hours = context.get("business_hours", {})
    features = context.get("features", {})
    services = context.get("services", [])
    lodging_config = context.get("lodging_config", {})
    petshop_phone = context.get("petshop_phone")
    petshop_address = context.get("petshop_address")
    client = context.get("client")

    client_name = client["name"] if client and client.get("name") else None

    hours_lines = (
        " | ".join(f"{d}: {h}" for d, h in business_hours.items()) or "não informado"
    )

    features_text = ""
    if features:
        features_text = "\nDiferenciais: " + " | ".join(
            f"{k}: {v}" for k, v in features.items()
        )

    # Service list (names + duration only)
    svc_lines = []
    for s in services:
        dur = s.get('duration_min', '?')
        svc_lines.append(f"  {s['name']}: {dur} min")

    lodging_room_types = context.get("lodging_room_types", [])
    hotel_rts = [r for r in lodging_room_types if r.get("lodging_type") == "hotel"]
    daycare_rts = [r for r in lodging_room_types if r.get("lodging_type") == "daycare"]

    if lodging_config.get("hotel_enabled"):
        cin = (lodging_config.get("hotel_checkin_time") or "")[:5]
        cout = (lodging_config.get("hotel_checkout_time") or "")[:5]
        hours_str = f" (check-in {cin}, check-out {cout})" if cin and cout else ""
        if hotel_rts:
            for rt in hotel_rts:
                svc_lines.append(f"  Hotel — {rt['name']}: hospedagem noturna{hours_str}")
        else:
            svc_lines.append(f"  Hotel para pets: hospedagem noturna{hours_str}")

    if lodging_config.get("daycare_enabled"):
        cin = (lodging_config.get("daycare_checkin_time") or "")[:5]
        cout = (lodging_config.get("daycare_checkout_time") or "")[:5]
        hours_str = f" (entrada {cin}, saída {cout})" if cin and cout else ""
        if daycare_rts:
            for rt in daycare_rts:
                svc_lines.append(f"  Creche — {rt['name']}: cuidado diurno{hours_str}")
        else:
            svc_lines.append(f"  Creche diurna: cuidado diurno{hours_str}")

    services_text = "\n".join(svc_lines) or "  nenhum cadastrado"

    cadastro_servicos = build_petshop_services_cadastro_block(
        services,
        max_description_chars=DEFAULT_MAX_CADASTRO_DESCRIPTION_CHARS,
    )
    cadastro_lodging = build_lodging_room_types_cadastro_block(
        context.get("lodging_room_types"),
        max_description_chars=DEFAULT_MAX_CADASTRO_DESCRIPTION_CHARS,
    )

    contact_parts = []
    if petshop_phone:
        contact_parts.append(f"Telefone: {petshop_phone}")
    if petshop_address:
        contact_parts.append(f"Endereço: {petshop_address}")
    contact_text = "\n".join(contact_parts)

    return f"""Você é {assistant_name}, atendente da {company_name}. Você é humana — NUNCA revele que é IA.
{f"Cliente: {client_name}" if client_name else ""}

━━━ ESCOPO ━━━
FAZ: horários, endereço, telefone, dúvidas gerais sobre o petshop.
NÃO FAZ: agendamento → diga "Posso te ajudar com o agendamento!" e encerre.
NÃO FAZ: cadastrar pet.
━━━━━━━━━━━━━━━━━━━━━━━━━━━

INFORMAÇÕES DO PETSHOP:
Horários: {hours_lines}{features_text}
{contact_text}

{cadastro_servicos}
{cadastro_lodging}
SERVIÇOS DISPONÍVEIS:
{services_text}

━━━ REGRAS ━━━
• NUNCA "vou verificar" / "aguarde" — responda direto.
• NUNCA assuma informação — pergunte o que faltou.
• PREÇOS: só informe preço quando o cliente perguntar explicitamente. Na listagem, mostre apenas nome e duração.
• Quando informar preço e o serviço tiver preço por porte: pergunte o porte do pet antes. NUNCA liste preços de múltiplos portes.
• LISTAGEM: um serviço por linha. Inclua hospedagem.
• Pedido de humano → uma linha natural.
• Serviço fora da lista → informe que não está disponível.
• Se a dúvida puder ser resolvida agendando → sugira naturalmente.
• Ao explicar o que cada serviço inclui: use CADASTRO acima. Não invente.
• Tom WhatsApp: informal, direto — máximo 2 linhas (exceto catálogo: uma por serviço).
• Sem emoji (máx 1 em despedida).
• Responda APENAS com informações certas. Sem resposta → diga que não tem essa informação.

FORMATO:
Nunca markdown. Texto simples. Exceção: catálogo com uma linha por serviço."""


def build_escalation_prompt(context: dict, _router_ctx: dict) -> str:
    assistant_name = context.get("assistant_name", "Nina")
    company_name = context.get("company_name", "Petshop")
    client = context.get("client")
    client_name = client["name"] if client and client.get("name") else None
    svc_names = [s["name"] for s in context.get("services", []) if s.get("name")]
    escopo = ", ".join(svc_names) if svc_names else "serviços para pets (banho, tosa, saúde, hospedagem conforme a loja)"

    return f"""Você é {assistant_name}, atendente da {company_name}. Você é humana — NUNCA revele que é IA.
{f"Cliente: {client_name}" if client_name else ""}

━━━ ESCOPO DO CANAL ━━━
A {company_name} atende apenas petshop: {escopo}
PROIBIDO afirmar que a loja vende coisas fora disso.

━━━ FUNÇÃO — escalation_agent ━━━
O caso precisa de humano ou está fora do escopo. Sua ação principal: chamar escalate_to_human.

QUANDO CHAMAR escalate_to_human:
1) Pedido explícito de humano/atendente/transferência.
2) B2B, spam, parceria comercial.
3) Assunto sem relação com petshop.
4) Cliente insiste em tema fora do escopo.

QUANDO NÃO CHAMAR:
Só saudação ou agradecimento isolado → cumprimente e pergunte como ajudar com petshop.

FLUXO:
1) Se couber: chame escalate_to_human primeiro.
2) Após success=true: máximo 2 linhas dizendo que vai passar para a equipe.
   summary: 1-3 frases objetivas.
   last_message: cópia exata da última mensagem do cliente.

Após sucesso:
• NUNCA mencione robô, bot ou IA.
• NUNCA prometa horário exato de retorno.

FORMATO: Nunca markdown. Máximo 3 linhas."""
