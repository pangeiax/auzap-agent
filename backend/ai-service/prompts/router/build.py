from datetime import date as _date, timedelta as _timedelta

from timezone_br import today_sao_paulo

from prompts.router.segments import (
    ROUTER_CONTEXT_TEMPLATE,
    ROUTER_STATIC_A,
    ROUTER_STATIC_B_TEMPLATE,
)
from prompts.shared.service_cadastro import (
    build_lodging_room_types_cadastro_block,
    build_petshop_services_cadastro_block,
)


def _router_fill_static_b(
    today: _date,
    today_display: str,
    tomorrow_iso: str,
    next_monday_in_week: str,
    next_friday: _date,
) -> str:
    return (
        ROUTER_STATIC_B_TEMPLATE.replace("__TOMORROW_ISO__", tomorrow_iso)
        .replace("__NEXT_MONDAY_IN_WEEK__", next_monday_in_week)
        .replace("__YEAR__", str(today.year))
        .replace("__MONTH02__", f"{today.month:02d}")
        .replace("__TODAY_DISPLAY__", today_display)
        .replace("__NEXT_FRIDAY_ISO__", next_friday.isoformat())
    )


def _router_fill_context(
    today_display: str,
    today_weekday: str,
    client_stage: str,
    next_days: str,
    cal_extra: str,
    cal_weekday_rule: str,
    services: str,
    cadastro_servicos: str,
    cadastro_lodging: str,
) -> str:
    cal_block = f"{cal_extra}{cal_weekday_rule}"
    return (
        ROUTER_CONTEXT_TEMPLATE.replace("__TODAY_DISPLAY__", today_display)
        .replace("__TODAY_WEEKDAY__", today_weekday)
        .replace("__CLIENT_STAGE__", client_stage)
        .replace("__NEXT_DAYS__", next_days)
        .replace("__CAL_BLOCK__", cal_block)
        .replace("__SERVICES_LINE__", services or "nenhum")
        .replace("__CADASTRO_SERVICOS__", cadastro_servicos)
        .replace("__CADASTRO_LODGING__", cadastro_lodging)
    )


def build_router_prompt(context: dict) -> str:
    svc_names = [s["name"] for s in context.get("services", [])]
    lodging_config = context.get("lodging_config", {})
    room_types = context.get("lodging_room_types", [])
    hotel_types = [r["name"] for r in room_types if r.get("lodging_type") == "hotel"]
    daycare_types = [r["name"] for r in room_types if r.get("lodging_type") == "daycare"]
    if lodging_config.get("hotel_enabled"):
        hotel_line = (
            f"Hotel para pets (modalidades: {', '.join(hotel_types)})"
            if hotel_types
            else "Hotel para pets"
        )
        svc_names.append(hotel_line)
    if lodging_config.get("daycare_enabled"):
        daycare_line = (
            f"Creche diurna (modalidades: {', '.join(daycare_types)})"
            if daycare_types
            else "Creche diurna"
        )
        svc_names.append(daycare_line)
    services = ", ".join(svc_names)
    client = context.get("client") or {}
    client_stage = client.get("conversation_stage") or "desconhecido"
    today_display = context.get("today", "")
    today_iso_str = context.get("today_iso", "")
    today_weekday = context.get("today_weekday", "")

    try:
        today = _date.fromisoformat(today_iso_str)
    except (ValueError, TypeError):
        today = today_sao_paulo()
        today_iso_str = today.isoformat()
        today_display = today.strftime("%d/%m/%Y")

    weekdays_pt = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]
    next_day_list = [(today + _timedelta(days=i)) for i in range(1, 8)]
    next_days = "\n".join(
        f"  {weekdays_pt[d.weekday()]}: {d.isoformat()}" for d in next_day_list
    )

    cal_ref = (
        (context.get("calendar_router_reference") or "").strip()
        or (context.get("calendar_dates_reference") or "").strip()
    )
    cal_extra = ""
    cal_weekday_rule = ""
    if cal_ref:
        cal_extra = f"\n{cal_ref}\n"
        cal_weekday_rule = (
            "\n• **Dia da semana:** para qualquer data **YYYY-MM-DD** ou **DD/MM/AAAA** na tabela **CALENDÁRIO** acima, "
            "use **somente** o dia indicado lá (ou deixe só a data, sem nome do dia). **Proibido** deduzir sexta/sábado/etc. "
            "de cabeça — modelos erram com frequência."
        )

    next_friday = next(d for d in next_day_list if d.weekday() == 4)
    tomorrow_iso = (today + _timedelta(days=1)).isoformat()
    next_monday_in_week = next(
        (d for d in next_day_list if d.weekday() == 0), next_day_list[0]
    ).isoformat()

    cadastro_servicos = build_petshop_services_cadastro_block(
        context.get("services"),
        include_descriptions=False,
    )
    cadastro_lodging = build_lodging_room_types_cadastro_block(
        context.get("lodging_room_types"),
        include_descriptions=False,
    )

    static_b = _router_fill_static_b(
        today,
        today_display,
        tomorrow_iso,
        next_monday_in_week,
        next_friday,
    )
    context_tail = _router_fill_context(
        today_display,
        today_weekday,
        client_stage,
        next_days,
        cal_extra,
        cal_weekday_rule,
        services,
        cadastro_servicos,
        cadastro_lodging,
    )

    out = (
        ROUTER_STATIC_A
        + static_b
        + "\n\n━━━ CONTEXTO DESTE TURNO (datas, CRM, serviços desta loja) ━━━\n"
        + "Use a referência abaixo para «hoje», próximos dias, calendário, estágio no CRM e nomes/cadastro "
        "deste petshop ao montar o JSON.\n\n"
        + context_tail
    )
    if context.get("identity_flow_required"):
        out += (
            "\n\n━━━ RECADASTRO (cadastro incompleto) ━━━\n"
            "Este cliente ainda não tem CPF nem telefone manual na base (migração/recadastro). "
            "Um fluxo automático pode estar conduzindo isso. Recusa clara de cadastro ou mensagem sobre "
            "pet já em serviço (hotel, buscar pet, como está o pet) → `escalation_agent`.\n"
        )
    return out

