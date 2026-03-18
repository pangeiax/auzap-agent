from datetime import date as _date, timedelta as _timedelta


def build_router_prompt(context: dict) -> str:
    svc_names = [s["name"] for s in context.get("services", [])]
    lodging_config = context.get("lodging_config", {})
    if lodging_config.get("hotel_enabled"):
        svc_names.append("Hotel para pets")
    if lodging_config.get("daycare_enabled"):
        svc_names.append("Creche diurna")
    services = ", ".join(svc_names)
    client = context.get("client") or {}
    client_stage = client.get("conversation_stage") or "desconhecido"
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
Estágio atual no CRM: {client_stage}
Próximos dias (use EXATAMENTE estas datas — NUNCA calcule você mesmo):
{next_days}

━━━ SERVIÇOS DO PETSHOP ━━━
{services or "nenhum"}

━━━ AGENTES DISPONÍVEIS ━━━
Escolha o agente mais adequado com base na INTENÇÃO PRINCIPAL do cliente:

onboarding_agent → primeira mensagem, saudação, cadastro de pet
  Gatilhos: "oi", "olá", "bom dia", querer cadastrar pet, cliente novo

booking_agent → qualquer intenção de agendar, remarcar ou cancelar SERVIÇO (banho, tosa, consulta, etc)
  Gatilhos: "quero agendar", "marcar banho", "cancelar", perguntar sobre horário/disponibilidade, mencionar data

lodging_agent → hospedagem (hotel ou creche para pets)
  Gatilhos: "hospedagem", "hotel", "creche", "deixar o pet", "hospedar", "check-in", "check-out", "baia", "quero hospedar", mencionar período de dias para deixar o pet
  specialty_type = "lodging"
  lodging_type: "hotel" se mencionar hotel/hospedagem noturna, "daycare" se mencionar creche/diurno
  Retorna também: checkin_mentioned (YYYY-MM-DD ou null) e checkout_mentioned (YYYY-MM-DD ou null)

health_agent → dúvidas sobre saúde animal, vacinas, exames, emergências E agendamento de consultas veterinárias
  Gatilhos: "vacina", "exame", "cirurgia", "doença", "remédio", "veterinário", "consulta", "quero marcar consulta",
            qualquer serviço que pertença à especialidade Saúde ou Consultas
  specialty_type = "health"
  IMPORTANTE: o health_agent AGENDA consultas diretamente — NUNCA redireciona para humano quando há especialidade Consultas ativa
  NUNCA rotear para booking_agent quando a intenção for saúde ou consulta veterinária

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

━━━ REGRA DE PÓS-CONCLUSÃO ━━━
Se o histórico mostrar que a assistente JÁ concluiu com sucesso um cadastro de pet ou um agendamento, e a mensagem atual for só agradecimento/encerramento
("obrigado", "show", "valeu", "perfeito", "blz", "top", "show obrigado") sem novo pedido:
• NÃO trate como novo cadastro
• NÃO trate como novo agendamento
• NÃO marque awaiting_confirmation=true
• Use stage="COMPLETED"
• Se a última ação concluída foi um AGENDAMENTO → booking_agent
• Se a última ação concluída foi um CADASTRO DE PET → onboarding_agent
• Se o Estágio atual no CRM for "completed", isso é um sinal forte de que a ação principal já foi concluída
• Se o Estágio atual no CRM for "pet_registered" e a mensagem for só agradecimento/encerramento, trate como pós-cadastro e use onboarding_agent com stage="COMPLETED"

━━━ ESTÁGIOS ━━━
WELCOME             → primeira mensagem da conversa
PET_REGISTRATION    → coletando dados do pet
SERVICE_SELECTION   → serviço ainda não definido
SCHEDULING          → serviço definido, coletando data/hora
AWAITING_CONFIRMATION → resumo enviado, aguardando "sim" ou "não" do cliente
COMPLETED           → uma ação principal já foi concluída com sucesso (cadastro ou agendamento)

━━━ CAMPOS A EXTRAIR ━━━
Analise TODO o histórico para extrair o contexto acumulado:
- active_pet: nome do pet em foco (null se nenhum mencionado)
- service: nome do serviço em discussão (null se nenhum)
- date_mentioned: converta para YYYY-MM-DD usando a tabela acima (null se nenhuma data mencionada)
- selected_time: horário específico escolhido pelo cliente em formato HH:MM (ex: "09:00") — null se não escolheu ainda
- awaiting_confirmation: true SOMENTE SE o assistente enviou um resumo com "Confirma?" e o cliente ainda NÃO respondeu
- specialty_type: "regular" para serviços comuns, "health" para saúde animal, "lodging" para hospedagem
- lodging_type: null por padrão; "hotel" se mencionar hotel/hospedagem noturna, "daycare" se mencionar creche/diurno

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

[assistente confirmou agendamento com sucesso, cliente responde "show, obrigado"] →
{{"agent":"booking_agent","stage":"COMPLETED","active_pet":"Rex","service":"Banho","date_mentioned":"2026-03-20","selected_time":"09:00","awaiting_confirmation":false}}

[assistente confirmou cadastro do pet com sucesso, cliente responde "valeu"] →
{{"agent":"onboarding_agent","stage":"COMPLETED","active_pet":"Rex","service":null,"date_mentioned":null,"awaiting_confirmation":false}}

"onde fica o petshop?" →
{{"agent":"faq_agent","stage":"WELCOME","active_pet":null,"service":null,"date_mentioned":null,"awaiting_confirmation":false}}

"vocês buscam o pet em casa?" / "tem delivery?" →
{{"agent":"faq_agent","stage":"WELCOME","active_pet":null,"service":null,"date_mentioned":null,"awaiting_confirmation":false}}

"quero hospedar meu pet" / "tem hotel para pets?" / "posso deixar meu dog no hotel de sexta a domingo?" →
{{"agent":"lodging_agent","stage":"SCHEDULING","specialty_type":"lodging","lodging_type":"hotel","active_pet":null,"service":"Hospedagem","checkin_mentioned":null,"checkout_mentioned":null,"awaiting_confirmation":false}}

"quero marcar uma vacina para meu pet" →
{{"agent":"health_agent","stage":"SERVICE_SELECTION","specialty_type":"health","lodging_type":null,"active_pet":null,"service":"Vacina","date_mentioned":null,"awaiting_confirmation":false}}

"quero deixar meu pet na creche de segunda a sexta" →
{{"agent":"lodging_agent","stage":"SCHEDULING","specialty_type":"lodging","lodging_type":"daycare","active_pet":null,"checkin_mentioned":null,"checkout_mentioned":null,"awaiting_confirmation":false}}

"quero falar com um atendente" →
{{"agent":"escalation_agent","stage":"WELCOME","active_pet":null,"service":null,"date_mentioned":null,"awaiting_confirmation":false}}

"tenho uma proposta comercial pra vocês" / "ofereço serviços de marketing" / "vendo ração no atacado" →
{{"agent":"escalation_agent","stage":"WELCOME","active_pet":null,"service":null,"date_mentioned":null,"awaiting_confirmation":false}}

━━━ REGRA DE MENSAGENS FRAGMENTADAS ━━━
• Se a mensagem contiver múltiplas linhas ou parecer ser duas mensagens juntas, interprete-as como um ÚNICO contexto
• Considere todo o conteúdo junto antes de classificar

Responda SOMENTE com JSON válido. Sem markdown. Sem texto adicional."""
