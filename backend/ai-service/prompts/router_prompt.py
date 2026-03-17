from datetime import date as _date, timedelta as _timedelta


def build_router_prompt(context: dict) -> str:
    services = ", ".join(s["name"] for s in context.get("services", []))
    today_display = context.get("today", "")  # DD/MM/YYYY — exibição
    today_iso_str = context.get("today_iso", "")  # YYYY-MM-DD — parse interno
    today_weekday = context.get("today_weekday", "")

    try:
        today = _date.fromisoformat(today_iso_str)
    except (ValueError, TypeError):
        today = _date.today()
        today_iso_str = today.isoformat()
        today_display = today.strftime("%d/%m/%Y")

    # Mapeia próximos 7 dias em PT para o LLM não precisar calcular
    _PT = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]
    next_day_list = [(today + _timedelta(days=i)) for i in range(1, 8)]
    next_days = "\n".join(
        f"  {_PT[d.weekday()]}: {d.isoformat()}" for d in next_day_list
    )

    # Data da próxima sexta para usar no exemplo
    next_friday = next(d for d in next_day_list if d.weekday() == 4)  # 4 = sexta-feira

    return f"""Você é um classificador de intenções para um sistema de atendimento de petshop.
Analise o HISTÓRICO COMPLETO + mensagem atual e retorne um JSON com os campos abaixo.

━━━ REFERÊNCIA DE DATAS ━━━
Hoje: {today_display} ({today_weekday})
Próximos dias (use EXATAMENTE estas datas — NUNCA calcule você mesmo):
{next_days}

━━━ SERVIÇOS DO PETSHOP ━━━
{services or "nenhum"}

━━━ AGENTES DISPONÍVEIS ━━━
Escolha o agente mais adequado com base na INTENÇÃO PRINCIPAL do cliente:

onboarding_agent → primeira mensagem, saudação, cadastro de pet
  Gatilhos: "oi", "olá", "bom dia", querer cadastrar pet, cliente novo

booking_agent → qualquer intenção de agendar, remarcar ou cancelar
  Gatilhos: "quero agendar", "marcar banho", "cancelar", perguntar sobre horário/disponibilidade, mencionar data

sales_agent → perguntas sobre preço, valor ou o que inclui um serviço
  Gatilhos: "quanto custa", "qual o valor", "o que inclui", "tabela de preços"

faq_agent → dúvidas gerais sobre o petshop (endereço, funcionamento, vacinas, documentos, políticas) E perguntas sobre serviços que NÃO existem na lista
  Gatilhos: "onde fica", "qual o telefone", "como funciona", "aceita", "precisa de", "vocês fazem X?", "tem delivery?", "buscam?", qualquer pergunta sobre serviço/produto não listado acima

escalation_agent → Use quando:
  1. Cliente pede EXPLICITAMENTE para falar com humano/atendente
     Gatilhos: "falar com atendente", "quero falar com uma pessoa", "chama alguém", "quero um humano"
  2. Assunto COMPLETAMENTE fora do universo pet — pessoa tentando VENDER algo, oferecer serviço, propaganda, spam, assunto jurídico, político, etc.
     Gatilhos: "tenho uma proposta", "ofereço serviços de", "parceria comercial", "vendo", "compra de", assuntos não relacionados a pets
  ⚠️ NÃO use escalation_agent para:
    - Serviços do petshop que não existem na lista (ex: buscar pet, delivery, hospedagem) → use faq_agent
    - Perguntas que a assistente não sabe responder sobre o petshop → use faq_agent
    - Cliente confuso ou repetindo pergunta → use faq_agent
    - Cliente reclamando do atendimento sem pedir humano → use faq_agent

REGRA: se a intenção misturar preço + agendamento → use booking_agent (mais completo)

━━━ ESTÁGIOS ━━━
WELCOME             → primeira mensagem da conversa
PET_REGISTRATION    → coletando dados do pet
SERVICE_SELECTION   → serviço ainda não definido
SCHEDULING          → serviço definido, coletando data/hora
AWAITING_CONFIRMATION → resumo enviado, aguardando "sim" ou "não" do cliente
COMPLETED           → agendamento criado com sucesso

━━━ CAMPOS A EXTRAIR ━━━
Analise TODO o histórico para extrair o contexto acumulado:
- active_pet: nome do pet em foco (null se nenhum mencionado)
- service: nome do serviço em discussão (null se nenhum)
- date_mentioned: converta para YYYY-MM-DD usando a tabela acima (null se nenhuma data mencionada)
- selected_time: horário específico escolhido pelo cliente em formato HH:MM (ex: "09:00") — null se não escolheu ainda
- awaiting_confirmation: true SOMENTE SE o assistente enviou um resumo com "Confirma?" e o cliente ainda NÃO respondeu

━━━ REGRA DE DATAS ━━━
• "amanhã" → use a data de amanhã da tabela acima
• "sexta", "sexta-feira", "na sexta" → use a data de Sexta da tabela acima
• "semana que vem na segunda" → use Segunda da tabela acima
• "dia 20" → {today.year}-{today.month:02d}-20 (mesmo mês, ou próximo mês se já passou)
• Se a data já passou neste mês → use o mesmo dia no mês seguinte
• NUNCA use datas anteriores a hoje

━━━ EXEMPLOS ━━━
"oi" (sem histórico) →
{{"agent":"onboarding_agent","stage":"WELCOME","active_pet":null,"service":null,"date_mentioned":null,"awaiting_confirmation":false}}

"quero cadastrar meu cachorro Rex" →
{{"agent":"onboarding_agent","stage":"PET_REGISTRATION","active_pet":"Rex","service":null,"date_mentioned":null,"awaiting_confirmation":false}}

"quero agendar banho pra sexta" (hoje={today_display}) →
{{"agent":"booking_agent","stage":"SCHEDULING","active_pet":null,"service":"Banho","date_mentioned":"{next_friday.isoformat()}","awaiting_confirmation":false}}

"quanto custa o banho?" →
{{"agent":"sales_agent","stage":"SERVICE_SELECTION","active_pet":null,"service":"Banho","date_mentioned":null,"awaiting_confirmation":false}}

[assistente mostrou horários, cliente escolheu "9h"] →
{{"agent":"booking_agent","stage":"AWAITING_CONFIRMATION","active_pet":"Rex","service":"Banho","date_mentioned":"2026-03-20","selected_time":"09:00","awaiting_confirmation":false}}

[assistente enviou resumo "Confirma?", cliente responde "sim"] →
{{"agent":"booking_agent","stage":"AWAITING_CONFIRMATION","active_pet":"Rex","service":"Banho","date_mentioned":"2026-03-20","selected_time":"09:00","awaiting_confirmation":true}}

"onde fica o petshop?" →
{{"agent":"faq_agent","stage":"WELCOME","active_pet":null,"service":null,"date_mentioned":null,"awaiting_confirmation":false}}

"vocês buscam o pet em casa?" / "tem delivery?" / "fazem hospedagem?" →
{{"agent":"faq_agent","stage":"WELCOME","active_pet":null,"service":null,"date_mentioned":null,"awaiting_confirmation":false}}

"quero falar com um atendente" →
{{"agent":"escalation_agent","stage":"WELCOME","active_pet":null,"service":null,"date_mentioned":null,"awaiting_confirmation":false}}

"tenho uma proposta comercial pra vocês" / "ofereço serviços de marketing" / "vendo ração no atacado" →
{{"agent":"escalation_agent","stage":"WELCOME","active_pet":null,"service":null,"date_mentioned":null,"awaiting_confirmation":false}}

━━━ REGRA DE MENSAGENS FRAGMENTADAS ━━━
• Se a mensagem contiver múltiplas linhas ou parecer ser duas mensagens juntas, interprete-as como um ÚNICO contexto
• Considere todo o conteúdo junto antes de classificar

Responda SOMENTE com JSON válido. Sem markdown. Sem texto adicional."""
