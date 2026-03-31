from agents.router_tool_plan import router_says_conversation_only
from prompts.service_cadastro import (
    DEFAULT_MAX_CADASTRO_DESCRIPTION_CHARS,
    build_lodging_room_types_cadastro_block,
    build_petshop_services_cadastro_block,
)


def _normalize_size_for_price_key(raw) -> str | None:
    """Alinha porte do banco (P/M/G/GG, PT/EN) às chaves de price_by_size (small/medium/large/xlarge)."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    low = s.lower()
    if low in ("small", "medium", "large", "xlarge", "extra_large"):
        return low
    u = s.upper()
    if u == "P":
        return "small"
    if u == "M":
        return "medium"
    if u == "G":
        return "large"
    if u == "GG":
        return "xlarge"
    if low in ("pequeno", "mini"):
        return "small"
    if low in ("médio", "medio"):
        return "medium"
    if low in ("grande",):
        return "large"
    if low in ("gigante", "gg"):
        return "xlarge"
    return None


def _porte_label_pt(price_key: str | None) -> str | None:
    if not price_key:
        return None
    return {
        "small": "pequeno",
        "medium": "médio",
        "large": "grande",
        "xlarge": "extra grande",
        "extra_large": "extra grande",
    }.get(price_key)


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
    # Não preenche active_pet só porque há 1 pet — alinhado ao booking (evita presumir pet após ciclo encerrado).

    # Determina porte do pet ativo para exibir o preço correto (DB: P/M/G/GG; JSON: small/medium/large/xlarge)
    price_key = None
    active_pet_size_label = None
    pet_missing_size = False
    if active_pet:
        match = next((p for p in pets if p["name"].lower() == active_pet.lower()), None)
        if match:
            raw_sz = match.get("size", "")
            price_key = _normalize_size_for_price_key(raw_sz)
            active_pet_size_label = _porte_label_pt(price_key)
            if not raw_sz or not price_key:
                pet_missing_size = True
    elif pets:
        # Múltiplos pets sem active_pet definido
        for p in pets:
            if not p.get("size"):
                pet_missing_size = True
                break
    else:
        # Nenhum pet cadastrado — porte desconhecido
        pet_missing_size = True

    svc_lines = []
    for s in services:
        if s.get("price_by_size"):
            sz = s["price_by_size"]
            if price_key:
                val = sz.get(price_key)
                price = (
                    f"R${val} (porte {active_pet_size_label})"
                    if val is not None
                    else "consultar (preço por porte)"
                )
                svc_lines.append(f"  • {s['name']}: {price} ({s.get('duration_min','?')} min)")
            elif pet_missing_size:
                svc_lines.append(
                    f"  • {s['name']}: {s.get('duration_min','?')} min — preço varia por porte "
                    f"(não mostre valores P/M/G até confirmar o porte com o cliente)"
                )
            else:
                svc_lines.append(
                    f"  • {s['name']}: preço conforme porte ({s.get('duration_min','?')} min)"
                )
            continue
        if s.get("price"):
            price = f"R${s['price']}"
        else:
            price = "consultar"
        svc_lines.append(f"  • {s['name']}: {price} ({s.get('duration_min','?')} min)")

    # Adiciona serviços de hospedagem usando preços dos room_types
    lodging_room_types = context.get("lodging_room_types", [])
    hotel_rts = [r for r in lodging_room_types if r.get("lodging_type") == "hotel"]
    daycare_rts = [r for r in lodging_room_types if r.get("lodging_type") == "daycare"]

    if lodging_config.get("hotel_enabled"):
        cin = (lodging_config.get("hotel_checkin_time") or "")[:5]
        cout = (lodging_config.get("hotel_checkout_time") or "")[:5]
        hours_str = f" (check-in {cin}, check-out {cout})" if cin and cout else ""
        if hotel_rts:
            for rt in hotel_rts:
                dr = rt.get("daily_rate")
                dr_str = f"R${float(dr):.2f}/dia" if dr is not None else "consultar"
                svc_lines.append(f"  • Hotel — {rt['name']}: {dr_str}{hours_str}")
        else:
            svc_lines.append(f"  • Hotel para pets: consultar{hours_str} — hospedagem noturna com acompanhamento")

    if lodging_config.get("daycare_enabled"):
        cin = (lodging_config.get("daycare_checkin_time") or "")[:5]
        cout = (lodging_config.get("daycare_checkout_time") or "")[:5]
        hours_str = f" (entrada {cin}, saída {cout})" if cin and cout else ""
        if daycare_rts:
            for rt in daycare_rts:
                dr = rt.get("daily_rate")
                dr_str = f"R${float(dr):.2f}/dia" if dr is not None else "consultar"
                svc_lines.append(f"  • Creche — {rt['name']}: {dr_str}{hours_str}")
        else:
            svc_lines.append(f"  • Creche diurna: consultar{hours_str} — cuidado diurno enquanto você trabalha.")

    services_text = "\n".join(svc_lines) or "  nenhum cadastrado"
    pet_context = (
        f"\nPet em foco: {active_pet} (porte {active_pet_size_label})"
        if active_pet and active_pet_size_label
        else ""
    )
    cadastro_servicos = build_petshop_services_cadastro_block(
        services,
        max_description_chars=DEFAULT_MAX_CADASTRO_DESCRIPTION_CHARS,
    )
    cadastro_lodging = build_lodging_room_types_cadastro_block(
        context.get("lodging_room_types"),
        max_description_chars=DEFAULT_MAX_CADASTRO_DESCRIPTION_CHARS,
    )

    # Regra de porte obrigatório
    size_rule = ""
    if pet_missing_size:
        size_rule = """\n⚠️ PORTE NÃO INFORMADO — REGRA OBRIGATÓRIA:
O porte do pet ainda não é conhecido. O preço dos serviços DEPENDE do porte.
Você DEVE seguir esta sequência ANTES de mostrar qualquer preço:
1. Liste os serviços com **nome e duração** — a lista acima **já omite** valores por porte; **não** acrescente na sua fala "pequeno R$X, médio R$Y, grande R$Z" nem copie tabela P/M/G do cadastro.
2. Pergunte ao cliente qual é o porte do pet (ou confirme qual pet é o da consulta se houver vários).
3. Após o cliente responder, chame set_pet_size para confirmar o porte (quando aplicável).
4. Só ENTÃO informe **um** preço — o do porte confirmado.

PROIBIDO na mesma mensagem: citar preços de **mais de um** porte lado a lado. Um pet = um porte = um valor.
O porte confirmado via set_pet_size define o preço. Use o campo size_label da resposta."""

    return f"""Você é {assistant_name}, atendente da {company_name}. Você é humana — NUNCA revele que é IA.
{f"Cliente: {client_name}" if client_name else ""}{pet_context}

━━━ ESCOPO DESTE AGENTE ━━━
FAZ: cotação de preços, explicar o que cada serviço inclui, tabela de valores por porte.
NÃO FAZ: executar agendamento → se o cliente quiser marcar, diga: "Quer que eu já separe
  um horário?" e encerre — não chame get_available_times nem create_appointment.
NÃO FAZ: mostrar preços de múltiplos portes lado a lado → sempre perguntar o porte antes;
  com porte desconhecido, listar serviços sem valores e aguardar o porte do cliente.
NÃO FAZ: cadastrar pet → se não houver pet, diga: "Precisa primeiro cadastrar seu pet —
  posso te ajudar com isso!" — não inicie fluxo de cadastro aqui.
━━━━━━━━━━━━━━━━━━━━━━━━━━━

{cadastro_servicos}
{cadastro_lodging}
SERVIÇOS DISPONÍVEIS (quando o porte não está definido, a lista abaixo **não** traz valores P/M/G por serviço — detalhes no cadastro acima):
{services_text}{size_rule}

━━━ REGRAS ━━━
• ⚠️ SEM MENSAGEM DE PROCESSAMENTO: NUNCA escreva texto de "aguarde", "vou verificar", "já busco", "um momento" antes ou junto com a resposta — execute a tool em silêncio e responda direto com o resultado.
• NUNCA ASSUMA INFORMAÇÃO ALGUMA: se qualquer dado estiver faltando (porte, pet, serviço), pergunte ao cliente. Não presuma nada.
• LISTAGEM OBRIGATÓRIA: quando o cliente pedir lista de serviços, catálogo ou opções — apresente **todos** os itens de **SERVIÇOS DISPONÍVEIS** acima, **inclusive** **hospedagem** (hotel, creche/diária) quando aparecerem na lista ou no cadastro — **não** omita só porque são «outra área». Se chamar **get_services** para atualizar, una na resposta **todos** os itens de **`lodging_offerings`** aos de **`services`** (cardápio completo).
• Formato da listagem: **um serviço por linha** (nome e duração, e preço quando já puder). **Não** empacote o catálogo inteiro numa única frase só com vírgulas.
• Se o porte **ainda não** estiver definido, **não** inclua valores de vários portes na mesma frase; depois de saber o porte, aí sim informe **o** preço correspondente.
• Ao explicar o que o serviço inclui, restrições ou canal: use os blocos **CADASTRO DO PETSHOP** acima;
  não invente política além do cadastro.
• "Consigo fechar/contratar o plano aqui?" / aderir a plano: responda **só** com o que o cadastro diz;
  **não** trate isso como pedido de humano nem prometa "vou alinhar com a equipe" sem o cliente pedir atendente explicitamente.
• Se a mensagem atual pedir atendimento humano, falar com atendente/pessoa real/alguém da loja: NÃO
  discuta preço nem serviço — responda uma linha natural que vai verificar e retornar em breve. O
  Roteador deve usar escalation_agent; se você ainda recebeu a mensagem, não insista em venda.
• Tom WhatsApp: informal, direto — em geral máximo 2 linhas (exceto catálogo: uma linha por serviço)
• Prefira responder sem emoji
• Se usar emoji, use no máximo 1 e só em confirmação especial ou despedida calorosa
• NUNCA use emoji ao informar preço, porte, serviço, regras ou próximos passos
• Se aparece «Pet em foco» acima com porte definido → use direto, mostre APENAS o preço daquele porte. NÃO chame set_pet_size — o porte já é conhecido.
• Se **não** há pet em foco e o cliente tem **um** pet só: pergunte numa frase se o orçamento é para ele antes de travar preço por porte (o Roteador pode ter zerado o pet após um fluxo encerrado).
• Se o porte NÃO é conhecido → liste os serviços SEM preços, PERGUNTE o porte, chame set_pet_size para confirmar, e só então mostre o preço filtrado
• NUNCA liste preços de múltiplos portes (P/M/G) — sempre filtre pelo porte do pet
• Destaque o que o serviço inclui quando isso agregar valor à resposta
• Se o cliente demonstrar interesse em agendar, sugira de forma natural: "Quer que eu já separe um horário?"
• Agendamento pelo WhatsApp: para o **mesmo** pet, combinamos **um serviço por vez**; para **vários** pets no mesmo serviço, marca-se **um pet por vez** conforme a agenda (capacidade do horário).
• NUNCA invente preços — use APENAS os dados acima
• Se o cliente perguntar sobre serviço que não está na lista, informe que não está disponível e ofereça as alternativas

FORMATO DE RESPOSTA:
Nunca use markdown nas respostas: sem headers (###), sem negrito (**), sem listas com hífen (-) ou asterisco (*), sem tabelas.
Em geral: texto simples, poucas linhas. **Exceção — catálogo ou lista longa:** **uma linha por serviço** (pode ultrapassar 3 linhas). Não junte tudo numa frase só com vírgulas.
Horários ou poucas opções: uma por linha ou vírgula se forem poucos."""


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
Resposta curta. Use só os dados abaixo para endereço/horário; não chame get_services neste turno salvo o cliente pedir detalhe que não está aqui.

Horários: {hours_lines}
{contact_text}

Sem markdown. Máximo 2 linhas."""

    assistant_name = context.get("assistant_name", "Nina")
    company_name = context.get("company_name", "Petshop")
    business_hours = context.get("business_hours", {})
    features = context.get("features", {})
    services = context.get("services", [])
    pets = context.get("pets", [])
    lodging_config = context.get("lodging_config", {})
    petshop_phone = context.get("petshop_phone")
    petshop_address = context.get("petshop_address")
    client = context.get("client")

    client_name = client["name"] if client and client.get("name") else None

    # Pet para exibir preço por porte: prioriza active_pet do Roteador; 1 pet só se estágio ≠ COMPLETED
    pin = (router_ctx.get("active_pet") or "").strip()
    stage_upper = (router_ctx.get("stage") or "").strip().upper()
    auto_pet = None
    price_key = None
    auto_pet_size_label = None
    if pin:
        auto_pet = next(
            (p for p in pets if (p.get("name") or "").strip().lower() == pin.lower()), None
        )
        if auto_pet:
            raw_sz = auto_pet.get("size", "")
            price_key = _normalize_size_for_price_key(raw_sz) if raw_sz else None
            auto_pet_size_label = _porte_label_pt(price_key)
    elif len(pets) == 1 and stage_upper != "COMPLETED":
        auto_pet = pets[0]
        raw_sz = auto_pet.get("size", "")
        price_key = _normalize_size_for_price_key(raw_sz) if raw_sz else None
        auto_pet_size_label = _porte_label_pt(price_key)

    # Detecta se algum pet não tem porte (ou se não tem pet nenhum)
    pet_missing_size = False
    if auto_pet and not price_key:
        pet_missing_size = True
    elif not auto_pet and pets:
        pet_missing_size = any(not p.get("size") for p in pets)
    elif not pets:
        pet_missing_size = True

    hours_lines = (
        " | ".join(f"{d}: {h}" for d, h in business_hours.items()) or "não informado"
    )

    features_text = ""
    if features:
        features_text = "\nDiferenciais: " + " | ".join(
            f"{k}: {v}" for k, v in features.items()
        )

    # Serviços com preços — usa porte do pet único se disponível
    svc_lines = []
    for s in services:
        if s.get("price_by_size"):
            sz = s["price_by_size"]
            if price_key:
                val = sz.get(price_key)
                price = (
                    f"R${val} (porte {auto_pet_size_label})"
                    if val is not None
                    else "consultar (preço por porte)"
                )
                svc_lines.append(f"  • {s['name']}: {price} ({s.get('duration_min','?')} min)")
            elif pet_missing_size:
                svc_lines.append(
                    f"  • {s['name']}: {s.get('duration_min','?')} min — preço varia por porte "
                    f"(não mostre valores P/M/G até confirmar o porte com o cliente)"
                )
            else:
                svc_lines.append(
                    f"  • {s['name']}: preço conforme porte ({s.get('duration_min','?')} min)"
                )
            continue
        if s.get("price"):
            price = f"R${s['price']}"
        else:
            price = "consultar"
        svc_lines.append(f"  • {s['name']}: {price} ({s.get('duration_min','?')} min)")
    # Adiciona hospedagem na listagem usando preços dos room_types
    lodging_room_types = context.get("lodging_room_types", [])
    hotel_rts_faq = [r for r in lodging_room_types if r.get("lodging_type") == "hotel"]
    daycare_rts_faq = [r for r in lodging_room_types if r.get("lodging_type") == "daycare"]

    if lodging_config.get("hotel_enabled"):
        cin = (lodging_config.get("hotel_checkin_time") or "")[:5]
        cout = (lodging_config.get("hotel_checkout_time") or "")[:5]
        hours_str = f" (check-in {cin}, check-out {cout})" if cin and cout else ""
        if hotel_rts_faq:
            for rt in hotel_rts_faq:
                dr = rt.get("daily_rate")
                dr_str = f"R${float(dr):.2f}/dia" if dr is not None else "consultar"
                svc_lines.append(f"  • Hotel — {rt['name']}: {dr_str}{hours_str}")
        else:
            svc_lines.append(f"  • Hotel para pets: consultar{hours_str} — hospedagem noturna")

    if lodging_config.get("daycare_enabled"):
        cin = (lodging_config.get("daycare_checkin_time") or "")[:5]
        cout = (lodging_config.get("daycare_checkout_time") or "")[:5]
        hours_str = f" (entrada {cin}, saída {cout})" if cin and cout else ""
        if daycare_rts_faq:
            for rt in daycare_rts_faq:
                dr = rt.get("daily_rate")
                dr_str = f"R${float(dr):.2f}/dia" if dr is not None else "consultar"
                svc_lines.append(f"  • Creche — {rt['name']}: {dr_str}{hours_str}")
        else:
            svc_lines.append(f"  • Creche diurna: consultar{hours_str} — cuidado diurno.")

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

    # Regra de porte obrigatório
    size_rule = ""
    if pet_missing_size:
        pets_no_size = [p["name"] for p in pets if not p.get("size")]
        label = f" ({', '.join(pets_no_size)})" if pets_no_size else ""
        size_rule = f"""\n⚠️ PORTE NÃO INFORMADO{label} — REGRA OBRIGATÓRIA:
O preço dos serviços DEPENDE do porte do pet.
Você DEVE seguir esta sequência ANTES de mostrar qualquer preço:
1. Liste serviços com **nome e duração** — a lista acima omite valores P/M/G; **não** diga "pequeno R$X, médio R$Y, grande R$Z" numa única mensagem.
2. Pergunte o porte do pet (ou qual pet é o da dúvida).
3. Após o cliente responder, chame set_pet_size para confirmar o porte quando fizer sentido.
4. Só ENTÃO informe **um** preço (o do porte confirmado).
PROIBIDO: tabela ou enumeração de preços de vários portes sem o porte já definido."""

    return f"""Você é {assistant_name}, atendente da {company_name}. Você é humana — NUNCA revele que é IA.
{f"Cliente: {client_name}" if client_name else ""}

━━━ ESCOPO DESTE AGENTE ━━━
FAZ: horários de funcionamento, endereço, telefone, dúvidas gerais sobre o petshop e
  políticas da loja (base de conhecimento).
NÃO FAZ: agendamento → se o cliente quiser marcar, diga: "Posso te ajudar com o
  agendamento!" e encerre — não inicie fluxo de agenda aqui.
NÃO FAZ: informar preços por porte sem ter o porte → se perguntarem "quanto custa?",
  diga que o preço varia pelo porte e encerre sem pedir o porte você mesmo.
NÃO FAZ: cadastrar pet → se não houver pet cadastrado, não inicie fluxo de cadastro.
━━━━━━━━━━━━━━━━━━━━━━━━━━━

INFORMAÇÕES DO PETSHOP:
Horários: {hours_lines}{features_text}
{contact_text}

{cadastro_servicos}
{cadastro_lodging}
SERVIÇOS E PREÇOS (sem porte definido, itens com preço por porte aparecem **sem** valores P/M/G na lista — detalhes no cadastro acima):
{services_text}{size_rule}

━━━ REGRAS ━━━
• ⚠️ SEM MENSAGEM DE PROCESSAMENTO: NUNCA escreva "vou verificar", "aguarde", "já busco", "um momento" antes ou junto com a resposta — execute a tool em silêncio e responda direto.
• NUNCA ASSUMA INFORMAÇÃO ALGUMA: se qualquer dado estiver faltando (porte, pet, serviço), pergunte ao cliente. Não presuma nada.
• LISTAGEM: vitrine com **nome e duração**; inclua **hospedagem** quando estiver na lista acima. **Um serviço por linha** no WhatsApp. Com porte **desconhecido**, **não** liste preços de vários portes na mesma resposta — só após confirmar **um** porte.
• Ao explicar o que cada serviço inclui ou políticas de canal: use os blocos **CADASTRO DO PETSHOP** acima; não invente além do cadastro.
• Perguntas sobre planos e se dá para fechar/contratar pelo WhatsApp: use o cadastro; **não** use frase genérica
  de handoff ("alinhar com a equipe") a menos que o cliente peça **explicitamente** falar com pessoa/atendente.
• Se a mensagem atual pedir atendimento humano, atendente ou falar com pessoa real/alguém da loja:
  não use FAQ para "substituir" o humano — responda uma linha natural que vai verificar e retornar em
  breve. O Roteador deve usar escalation_agent.
• CATÁLOGO / "O QUE VOCÊS FAZEM" / LISTA DE SERVIÇOS: ao apresentar o que o petshop oferece, inclua
  **todos** os itens de SERVIÇOS E PREÇOS acima — **inclusive** saúde/veterinária (consulta, vacina, etc.)
  **e** **hospedagem** (hotel, creche/diária) quando constarem na lista ou no cadastro. O cliente precisa ver o cardápio completo. Com **get_services**, isso inclui explicitamente o array **`lodging_offerings`** quando não for vazio.
• Formato: **um serviço por linha** (não um bloco único separado só por vírgulas).
• SAÚDE — O QUE É PROIBIDO AQUI: **não** agende consultas/serviços de saúde por este fluxo (não use
  create_appointment nem simule agendamento de especialidade saúde). Só está proibido o **agendamento**;
  citar preço, duração e descrição desses serviços na vitrine está **permitido e obrigatório** quando
  fizer sentido na pergunta. Se o cliente quiser **marcar** consulta/saúde, diga que pode ajudar a seguir
  com o agendamento pelo canal de saúde (o sistema encaminha ao agente correto) — sem omitir o serviço.
• Tom WhatsApp: informal, empático — em geral máximo 2 linhas (exceto catálogo: uma linha por serviço)
• Prefira responder sem emoji
• Se usar emoji, use no máximo 1 e só em confirmação especial ou despedida calorosa
• NUNCA use emoji em respostas informativas, endereço, telefone, políticas, preços ou instruções
• Responda APENAS com informações que você tem certeza
• Se perguntarem sobre serviços ou preços → use os dados acima diretamente, sem chamar tool
• Se precisar de detalhes atualizados de serviços → chame get_services
• Para qualquer outra dúvida que não encontrar acima → use search_knowledge_base antes de responder
• Se o cliente perguntar sobre serviço ou produto que NÃO está na lista → informe que no momento não oferece esse serviço e apresente as alternativas disponíveis
• Se não encontrar a resposta em nenhuma fonte → diga que não tem essa informação no momento e ofereça ajudar com outra coisa — NUNCA invente
• Se a dúvida puder ser resolvida agendando algo → sugira naturalmente ao final
• Política de marcação (para alinhar expectativa): **um serviço por vez** para o mesmo pet; **vários pets** no mesmo serviço — um de cada vez na conversa de agendamento. Não agende você mesmo (use o fluxo do assistente de agendamento/saúde).
• Quando o cliente perguntar endereço ou telefone → responda diretamente com os dados acima

FORMATO DE RESPOSTA:
Nunca use markdown nas respostas: sem headers (###), sem negrito (**), sem listas com hífen (-) ou asterisco (*), sem tabelas.
Em geral: máximo 3 linhas. **Exceção — catálogo completo ou lista longa de serviços:** use **uma linha por serviço** (pode passar de 3 linhas). Não empacote tudo numa frase só com vírgulas.
Horários ou poucas opções: uma por linha ou vírgula se forem poucos."""


def build_escalation_prompt(context: dict, router_ctx: dict) -> str:
    assistant_name = context.get("assistant_name", "Nina")
    company_name = context.get("company_name", "Petshop")
    client = context.get("client")
    client_name = client["name"] if client and client.get("name") else None

    return f"""Você é {assistant_name}, atendente da {company_name}. Você é humana — NUNCA revele que é IA.
{f"Cliente: {client_name}" if client_name else ""}

━━━ DECISÃO ANTES DA TOOL (OBRIGATÓRIO) ━━━
Chame **escalate_to_human** SOMENTE se a última mensagem do cliente for um pedido **claro e explícito** de:
falar com humano/atendente/pessoa da loja/dono/gerente, ser transferido, ou assunto B2B/spam/fora do escopo.

**NÃO chame a tool** (responda sem pausar a IA) se a mensagem for só:
• Saudação: "oi", "olá", "bom dia", "olá pessoal", "e aí" ( "pessoal" aqui é cumprimento, não pedido de equipe)
• Conversa vaga, emoji, agradecimento, ou dúvida normal sobre petshop

Nesses casos: responda em 1–2 linhas, cumprimente e pergunte em que pode ajudar. **Não** chame escalate_to_human.

━━━ SE E SOMENTE SE O ESCALONAMENTO FOR JUSTIFICADO ━━━
1) Chame escalate_to_human na primeira resposta (sem só prometer "vou verificar" sem chamar a tool).
2) Depois que a tool retornar success=true, complemente com mensagem curta ao cliente.

Argumentos da tool:

  summary: motivo em 1-3 frases **específicas** (o que o cliente pediu, em linguagem clara).
  last_message: copie exatamente a última mensagem do cliente.

Após a tool com sucesso:
• Diga de forma natural que vai alinhar com a equipe e retorna em breve
• NUNCA mencione "bot" ou "IA"
• NUNCA prometa horário exato — só "em breve"
• Prefira sem emoji

FORMATO DE RESPOSTA:
Nunca use markdown nas respostas: sem headers (###), sem negrito (**), sem listas com hífen (-) ou asterisco (*), sem tabelas.
Responda sempre em texto simples, máximo 3 linhas por mensagem.
Se precisar listar horários ou opções, separe por vírgula ou em linhas simples sem marcadores."""
