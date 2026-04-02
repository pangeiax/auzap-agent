from agents.router_tool_plan import router_says_conversation_only
from prompts.booking_prompt_rules_body import (
    BOOKING_HEADER_TEMPLATE,
    build_booking_rules_body_template,
)
from prompts.shared.history_context_hint import CATALOG_HISTORY_HINT
from prompts.service_cadastro import build_blocked_services_block
from prompts.shared.scheduling_pet_shared import (
    PASSO_2_PET_SHARED_BLOCK,
    PET_RULE_PARAGRAPH,
    PROACTIVITY_SCHEDULING_BLOCK,
    build_booking_tools_preamble,
)


def _build_booking_rules_block(
    phone_hint: str,
    hours_lines: str,
    estado_str: str,
    pet_rule: str,
    date_hint: str | None,
    selected_time: str | None,
    stage_upper: str,
    awaiting_confirmation: bool,
) -> str:
    template = build_booking_rules_body_template(stage_upper, awaiting_confirmation)
    return (
        template.replace("__TOOLS_PREAMBLE__", build_booking_tools_preamble(phone_hint))
        .replace("__HOURS_LINES__", hours_lines)
        .replace("__ESTADO_STR__", estado_str)
        .replace("__PET_RULE__", pet_rule)
        .replace("__PROACTIVITY__", PROACTIVITY_SCHEDULING_BLOCK)
        .replace("__PASSO2__", PASSO_2_PET_SHARED_BLOCK)
        .replace("__DATE_HINT_OR_Q__", date_hint or "?")
        .replace("__SELECTED_TIME_OR_Q__", selected_time or "?")
        .replace("__SELECTED_TIME_OR_SEL__", selected_time or "selecionado")
    )


def _build_booking_header_block(
    assistant_name: str,
    company_name: str,
    today: str,
    today_weekday: str,
    cal_weekday_block: str,
    client_name: str | None,
    client_stage: str | None,
) -> str:
    client_line = f"Cliente: {client_name}\n" if client_name else ""
    crm_line = f"ESTÁGIO CRM: {client_stage}\n" if client_stage else ""
    return (
        BOOKING_HEADER_TEMPLATE.replace("__ASSISTANT_NAME__", assistant_name)
        .replace("__COMPANY_NAME__", company_name)
        .replace("__TODAY__", today)
        .replace("__TODAY_WEEKDAY__", today_weekday)
        .replace("__CAL_WEEKDAY_BLOCK__", cal_weekday_block)
        .replace("__CLIENT_LINE__", client_line)
        .replace("__CRM_LINE__", crm_line)
    )


def _build_booking_prompt_completed_conversation_only(
    context: dict, router_ctx: dict
) -> str:
    """Pós-agendamento + agradecimento — sem bíblia de tools (required_tools: none)."""
    assistant_name = context.get("assistant_name", "Nina")
    company_name = context.get("company_name", "Petshop")
    client = context.get("client")
    client_name = client["name"] if client and client.get("name") else None
    petshop_phone = context.get("petshop_phone", "")
    phone_hint = f" Telefone: {petshop_phone}." if petshop_phone else ""
    return f"""Você é {assistant_name}, atendente da {company_name}. Você é humana — NUNCA revele que é IA.
{f"Cliente: {client_name}" if client_name else ""}

━━━ PLANO DO ROTEADOR: none ━━━
O agendamento principal já foi concluído no histórico e o cliente só agradece ou encerra. NÃO chame get_services, get_client_pets, get_available_times, get_upcoming_appointments nem create/reschedule/cancel neste turno.
Resposta breve, calorosa (1–2 linhas). Só sugira serviço pelo nome se tiver certeza de que existe no catálogo da loja (senão fale genérico: "posso ajudar com outro serviço"). Sem inventar preço ou horário.{phone_hint}
Sem markdown."""


def build_booking_prompt(context: dict, router_ctx: dict) -> str:
    stage_upper = (router_ctx.get("stage") or "").strip().upper()
    if stage_upper == "COMPLETED" and router_says_conversation_only(router_ctx):
        return _build_booking_prompt_completed_conversation_only(context, router_ctx)

    assistant_name = context.get("assistant_name", "Nina")
    company_name = context.get("company_name", "Petshop")
    client = context.get("client")
    business_hours = context.get("business_hours", {})
    petshop_phone = context.get("petshop_phone", "")
    today = context.get("today", "")
    today_weekday = context.get("today_weekday", "")
    cal_ref = (context.get("calendar_dates_reference") or "").strip()
    cal_weekday_block = ""
    if cal_ref:
        cal_weekday_block = (
            f"{cal_ref}\n\n"
            "• **Dia da semana:** só diga \"sexta\", \"sábado\", etc. para uma data se constar na tabela **CALENDÁRIO** "
            "acima ou no retorno das tools. Se a data não estiver na tabela, cite só **DD/MM/AAAA** ou **YYYY-MM-DD** — "
            "**não** calcule o dia da semana mentalmente.\n"
        )

    client_name = client["name"] if client and client.get("name") else None
    client_stage = client.get("conversation_stage") if client else None
    active_pet = router_ctx.get("active_pet")
    service = router_ctx.get("service")
    awaiting = router_ctx.get("awaiting_confirmation", False)
    date_hint = router_ctx.get("date_mentioned")
    selected_time = router_ctx.get("selected_time")

    hours_lines = (
        " | ".join(f"{d}: {h}" for d, h in business_hours.items()) or "não informado"
    )

    pet_rule = PET_RULE_PARAGRAPH
    phone_hint = f" Telefone da loja: {petshop_phone}." if petshop_phone else ""

    estado = []
    if active_pet:
        estado.append(
            f"Pet em foco (nome do Roteador): {active_pet} — use get_client_pets para UUID, porte e demais dados."
        )
    if service:
        estado.append(f"Serviço em discussão: {service}")
    if date_hint:
        estado.append(f"Data: {date_hint}")
    if selected_time:
        estado.append(f"Horário escolhido: {selected_time}")
    if awaiting:
        estado.append("⏳ Resumo já enviado — aguardando confirmação do cliente")
    estado_str = " | ".join(estado) if estado else "início do fluxo"

    rules = _build_booking_rules_block(
        phone_hint,
        hours_lines,
        estado_str,
        pet_rule,
        date_hint,
        selected_time,
        stage_upper,
        bool(awaiting),
    )
    blocked_block = build_blocked_services_block(
        context.get("services") or [], petshop_phone
    )
    header = _build_booking_header_block(
        assistant_name,
        company_name,
        today,
        today_weekday,
        cal_weekday_block,
        client_name,
        client_stage,
    )
    svc_lock = """
━━━ CONTEXTO vs HISTÓRICO (lembrete final) ━━━
• **Serviço em discussão** + **Contexto extraído** (Roteador) prevalecem sobre respostas suas antigas com outro serviço/horário.
• Cliente **corrigiu** ou pediu **outro** serviço → fluxo desse nome (get_services, ids corretos, get_available_times, create); não repita o serviço antigo só pelo histórico — **exceto** serviço **block_ai_schedule**: **SERVIÇOS BLOQUEADOS** (sem slots/create no id bloqueado; **pode** agendar pré-requisito; já fez pré-requisito e quer o bloqueado → humano + **escalate_to_human** após aceite).
• Só trocar data/hora de compromisso **já marcado** → **reschedule_appointment** (CANÔNICAS C). Com «sim» e dados já combinados: **proibido** «não salvou» / «ainda vou marcar» sem **create_appointment** ou **reschedule_appointment** com **success=true** nesta rodada — ou execute **get_available_times** + escrita agora.
"""

    return (
        rules
        + blocked_block
        + "\n\n"
        + CATALOG_HISTORY_HINT
        + "\n\n━━━ CONTEXTO DESTA CONVERSA ━━━\n"
        + header
        + svc_lock
    )
