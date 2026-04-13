import logging
import os
import re
import urllib.request
import json
import uuid
from datetime import date, datetime, timedelta

from config import API_NODE_URL, INTERNAL_API_KEY
from db import get_connection
from memory.tool_result_cache import (
    cache_get_services,
    cache_set_services,
    cache_set_slots,
    cache_get_slot,
)
from timezone_br import now_sao_paulo_naive, today_sao_paulo
from tools.slot_time_utils import hhmm_after_minutes, slot_time_to_hhmm

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _is_uuid(val) -> bool:
    return bool(val and _UUID_RE.match(str(val)))


def _fmt_time_hhmm(t) -> str | None:
    if t is None:
        return None
    return str(t)[:5]


def _lodging_offerings_for_catalog(cur, company_id: int) -> list[dict]:
    """
    Hotel/creche para o catálogo (não são linhas de petshop_services).
    Alinhado à listagem de sales_prompt / faq (room types + fallback).
    """
    cur.execute(
        """
        SELECT hotel_enabled, hotel_daily_rate, hotel_checkin_time, hotel_checkout_time,
               daycare_enabled, daycare_daily_rate, daycare_checkin_time, daycare_checkout_time
        FROM petshop_lodging_config
        WHERE company_id = %s
        """,
        (company_id,),
    )
    row = cur.fetchone()
    if not row:
        return []
    cfg = dict(row)
    for f in (
        "hotel_checkin_time",
        "hotel_checkout_time",
        "daycare_checkin_time",
        "daycare_checkout_time",
    ):
        cfg[f] = _fmt_time_hhmm(cfg.get(f))

    cur.execute(
        """
        SELECT lodging_type, name, description, daily_rate
        FROM petshop_room_types
        WHERE company_id = %s AND is_active = TRUE
        ORDER BY lodging_type, daily_rate ASC NULLS LAST, name
        """,
        (company_id,),
    )
    rt_rows = [dict(r) for r in cur.fetchall()]

    def _rate_label(val) -> str:
        if val is None:
            return "consultar"
        try:
            return f"R${float(val):.2f}/dia"
        except (TypeError, ValueError):
            return "consultar"

    out: list[dict] = []
    if cfg.get("hotel_enabled"):
        cin = cfg.get("hotel_checkin_time") or ""
        cout = cfg.get("hotel_checkout_time") or ""
        hours_hint = f"check-in {cin}, check-out {cout}" if cin and cout else None
        hotel_rts = [r for r in rt_rows if r.get("lodging_type") == "hotel"]
        if hotel_rts:
            for rt in hotel_rts:
                desc = (rt.get("description") or "").strip()
                out.append(
                    {
                        "catalog_kind": "lodging",
                        "lodging_type": "hotel",
                        "name": f"Hotel — {rt['name']}",
                        "description": desc or "Hospedagem noturna",
                        "daily_rate_label": _rate_label(rt.get("daily_rate")),
                        "hours_hint": hours_hint,
                        "note": "Reserva pelo fluxo de hospedagem (não use create_appointment).",
                    }
                )
        else:
            out.append(
                {
                    "catalog_kind": "lodging",
                    "lodging_type": "hotel",
                    "name": "Hotel para pets",
                    "description": "Hospedagem noturna com acompanhamento",
                    "daily_rate_label": _rate_label(cfg.get("hotel_daily_rate")),
                    "hours_hint": hours_hint,
                    "note": "Reserva pelo fluxo de hospedagem (não use create_appointment).",
                }
            )

    if cfg.get("daycare_enabled"):
        cin = cfg.get("daycare_checkin_time") or ""
        cout = cfg.get("daycare_checkout_time") or ""
        hours_hint = f"entrada {cin}, saída {cout}" if cin and cout else None
        daycare_rts = [r for r in rt_rows if r.get("lodging_type") == "daycare"]
        if daycare_rts:
            for rt in daycare_rts:
                desc = (rt.get("description") or "").strip()
                out.append(
                    {
                        "catalog_kind": "lodging",
                        "lodging_type": "daycare",
                        "name": f"Creche — {rt['name']}",
                        "description": desc or "Cuidado diurno",
                        "daily_rate_label": _rate_label(rt.get("daily_rate")),
                        "hours_hint": hours_hint,
                        "note": "Reserva pelo fluxo de creche (não use create_appointment).",
                    }
                )
        else:
            out.append(
                {
                    "catalog_kind": "lodging",
                    "lodging_type": "daycare",
                    "name": "Creche diurna",
                    "description": "Cuidado diurno enquanto o tutor trabalha",
                    "daily_rate_label": _rate_label(cfg.get("daycare_daily_rate")),
                    "hours_hint": hours_hint,
                    "note": "Reserva pelo fluxo de creche (não use create_appointment).",
                }
            )

    return out


def fetch_services_snapshot(company_id: int) -> dict:
    """
    Busca o catálogo diretamente do banco para aquecer o cache do servidor
    sem passar por uma rodada de tool calling do agente.
    """
    with get_connection() as conn:
        cur = conn.cursor()
        lodging_offerings = _lodging_offerings_for_catalog(cur, company_id)
        cur.execute(
            """
            SELECT
                ps.id,
                ps.name,
                ps.description,
                ps.duration_min,
                ps.price,
                ps.price_by_size,
                ps.duration_multiplier_large,
                ps.specialty_id,
                ps.block_ai_schedule,
                ps.dependent_service_id,
                dep.name AS dependent_service_name
            FROM petshop_services ps
            LEFT JOIN petshop_services dep ON dep.id = ps.dependent_service_id
            WHERE ps.company_id = %s AND ps.is_active = TRUE
            ORDER BY ps.name
        """,
            (company_id,),
        )
        services = cur.fetchall()

    svc_list = [dict(s) for s in services]
    return {
        "services": svc_list,
        "count": len(svc_list),
        "lodging_offerings": lodging_offerings,
        "lodging_offerings_count": len(lodging_offerings),
    }


# Deve coincidir com MAX_DAYS_AHEAD no backend Node (geração de slots / agenda).
MAX_AGENDA_DAYS_AHEAD = 90

logger = logging.getLogger("ai-service.tools.booking")

DOUBLE_PAIR_PREFIX = "__DOUBLE_PAIR__:"

# Serviço com block_ai_schedule=true no cadastro — create/get_available_times recusam pela IA.
ERROR_SERVICE_BLOCKED_FOR_AI = "service_blocked_for_ai"


def _fetch_service_ai_block_if_any(company_id: int, service_int: int) -> dict | None:
    """
    Se o serviço existe, está ativo e tem block_ai_schedule, retorna
    {service_name, dependent_service_name}; caso contrário None.
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT ps.name AS service_name, dep.name AS dependent_service_name
            FROM petshop_services ps
            LEFT JOIN petshop_services dep ON dep.id = ps.dependent_service_id
            WHERE ps.id = %s AND ps.company_id = %s AND ps.is_active = TRUE
              AND ps.block_ai_schedule = TRUE
            """,
            (service_int, company_id),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "service_name": row["service_name"],
        "dependent_service_name": row.get("dependent_service_name"),
    }


def _message_blocked_service_for_ai(
    service_name: str, dependent_service_name: str | None
) -> str:
    base = (
        f"O serviço «{service_name}» está bloqueado para agendamento automático pelo assistente. "
        "Não use get_available_times/create_appointment de novo para **este** service_id."
    )
    if dependent_service_name:
        return (
            base
            + f" Pré-requisito no cadastro: «{dependent_service_name}» — você **pode** agendar esse pré-requisito "
            "com o **id** dele (get_services). Se o cliente **já fez** o pré-requisito e quer **este** serviço: "
            "ofereça encaminhamento humano; aceite → escalate_to_human."
        )
    return (
        base
        + " Ofereça encaminhamento humano para marcar; aceite → escalate_to_human."
    )


def _date_iso(d) -> str | None:
    if d is None:
        return None
    if hasattr(d, "isoformat"):
        return d.isoformat()
    return str(d)


def _price_key_for_pet_size(raw: str | None) -> str | None:
    """
    Converte porte do banco (P/M/G/GG ou texto em inglês) para chaves típicas de price_by_size
    (small / medium / large).
    """
    if not raw:
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


def _resolve_price_charged_from_service_and_pet(service_row: dict, pet_row: dict):
    """Prioriza price_by_size alinhado ao porte do pet; fallback para price fixo."""
    price_charged = service_row.get("price")
    price_by_size = service_row.get("price_by_size")
    if not price_by_size or not isinstance(price_by_size, dict):
        return price_charged
    raw = pet_row.get("size")
    if not raw:
        return price_charged
    rs = str(raw).strip()
    if rs in price_by_size:
        return price_by_size[rs]
    pk = _price_key_for_pet_size(rs)
    if pk and pk in price_by_size:
        return price_by_size[pk]
    # GG: alguns catálogos só têm "large"
    u = rs.upper()
    if u == "GG":
        for k in ("xlarge", "extra_large", "large"):
            if k in price_by_size:
                return price_by_size[k]
    logger.warning(
        "Porte '%s' não mapeado em price_by_size=%s — usando price fixo",
        raw,
        price_by_size,
    )
    return price_charged


def _extract_double_pair_id(notes) -> str | None:
    if not notes:
        return None
    idx = notes.find(DOUBLE_PAIR_PREFIX)
    if idx < 0:
        return None
    rest = notes[idx + len(DOUBLE_PAIR_PREFIX) :].strip()
    m = re.match(
        r"^([0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})", rest
    )
    return m.group(1) if m else None


def _merge_notes_with_double_pair(user_notes, partner_appointment_id: str) -> str:
    u = (user_notes or "").strip()
    line = f"{DOUBLE_PAIR_PREFIX}{partner_appointment_id}"
    return f"{u}\n{line}" if u else line


def _strip_internal_appointment_notes(notes) -> str | None:
    """Remove linhas internas __DOUBLE_PAIR__ das observações ao remarcar."""
    if not notes:
        return None
    lines = [
        ln
        for ln in str(notes).split("\n")
        if ln.strip() and not ln.strip().startswith(DOUBLE_PAIR_PREFIX)
    ]
    out = "\n".join(lines).strip()
    return out or None


def _pet_occupied_starts_hhmm_staff(
    cur,
    company_id,
    pet_id,
    target_date,
    exclude_appointment_ids=None,
) -> set[str]:
    """
    Horários de início (HH:MM) em que o pet já tem agendamento ativo neste dia
    (sistema por funcionário, usando start_time diretamente).
    """
    ex = [str(x).strip() for x in (exclude_appointment_ids or []) if _is_uuid(str(x).strip())]
    sql = """
        SELECT start_time
        FROM petshop_appointments
        WHERE company_id = %s AND pet_id = %s
          AND status NOT IN ('completed', 'cancelled')
          AND start_time IS NOT NULL
          AND scheduled_date = %s
    """
    params: list = [company_id, pet_id, target_date]
    if ex:
        sql += " AND id::text NOT IN (" + ", ".join(["%s"] * len(ex)) + ")"
        params.extend(ex)
    cur.execute(sql, params)
    out: set[str] = set()
    for row in cur.fetchall() or []:
        t = row.get("start_time")
        if t is not None:
            out.add(str(t)[:5])
    return out


def _pet_conflict_same_slot_start(
    cur,
    company_id,
    pet_id,
    slot_date,
    slot_time,
    exclude_appointment_ids: set | None = None,
) -> dict | None:
    """
    Outro agendamento ativo do **mesmo pet** começando no **mesmo** slot (data + hora da grade).

    Clientes com vários pets podem usar o mesmo horário se o slot tiver capacidade — o bloqueio
    é por pet, não por cliente. Vagas: `max_capacity` / `used_capacity` no fluxo antes desta checagem.
    """
    if slot_date is None or slot_time is None or not pet_id:
        return None
    ex = exclude_appointment_ids or set()
    cur.execute(
        """
        SELECT a.id::text AS id, s.name AS service_name,
               COALESCE(TRIM(p.name), '') AS pet_name
        FROM petshop_appointments a
        JOIN petshop_services s ON s.id = a.service_id AND s.company_id = a.company_id
        JOIN petshop_slots sl ON sl.id = a.slot_id
        JOIN petshop_pets p ON p.id = a.pet_id AND p.company_id = a.company_id
        WHERE a.company_id = %s AND a.pet_id = %s
          AND a.status NOT IN ('completed', 'cancelled')
          AND a.slot_id IS NOT NULL
          AND sl.slot_date = %s
          AND sl.slot_time = %s
        ORDER BY a.id
        """,
        (company_id, pet_id, slot_date, slot_time),
    )
    for row in cur.fetchall() or []:
        rid = str(row["id"])
        if rid not in ex:
            return {
                "id": rid,
                "service_name": (row.get("service_name") or "Serviço").strip(),
                "pet_name": (row.get("pet_name") or "").strip() or "Este pet",
            }
    return None


def _pet_occupied_slot_starts_hhmm(
    cur,
    company_id,
    pet_id,
    slot_date,
    exclude_appointment_ids: list[str] | None = None,
) -> set[str]:
    """
    Inícios de faixa (HH:MM) em que o pet já tem compromisso ativo neste dia na grade.
    Inclui cada bloco de serviços G/GG (dois appointments, dois slot_time).
    Alinhado a _pet_conflict_same_slot_start (mesmo pet não pode dois serviços no mesmo início).
    exclude_appointment_ids: ao remarcar, ignorar o(s) id(s) do compromisso que será substituído
    (e o paired_appointment_id se uses_double_slot), para não esconder os horários atuais como «ocupados».
    """
    ex = [str(x).strip() for x in (exclude_appointment_ids or []) if _is_uuid(str(x).strip())]
    sql = """
        SELECT sl.slot_time
        FROM petshop_appointments a
        JOIN petshop_slots sl ON sl.id = a.slot_id
        WHERE a.company_id = %s AND a.pet_id = %s
          AND a.status NOT IN ('completed', 'cancelled')
          AND a.slot_id IS NOT NULL
          AND sl.slot_date = %s
    """
    params: list = [company_id, pet_id, slot_date]
    if ex:
        sql += " AND a.id::text NOT IN (" + ", ".join(["%s"] * len(ex)) + ")"
        params.extend(ex)
    cur.execute(sql, params)
    out: set[str] = set()
    for row in cur.fetchall() or []:
        t = row.get("slot_time")
        if t is not None:
            out.add(str(t)[:5])
    return out


def _requires_consecutive_slots(service_row: dict, pet_row: dict) -> bool:
    mult = service_row.get("duration_multiplier_large")
    if mult is None:
        return False
    try:
        m = float(mult)
    except (TypeError, ValueError):
        return False
    if m <= 1:
        return False
    size = (pet_row.get("size") or "").strip().upper()
    return size in ("G", "GG")


def _effective_service_duration_minutes(
    service_row: dict, pet_row: dict | None
) -> int:
    """
    Duração total do serviço para o pet: pets G/GG com duration_multiplier_large > 1
    usam duration_min * multiplicador (ex.: 60 → 120 min). P/M ou sem multiplicador → duration_min.
    """
    base = int(service_row.get("duration_min") or 60)
    if not pet_row:
        return base
    mult = service_row.get("duration_multiplier_large")
    try:
        m = float(mult) if mult is not None else 1.0
    except (TypeError, ValueError):
        m = 1.0
    size = (pet_row.get("size") or "").strip().upper()
    if size in ("G", "GG") and m > 1:
        return max(base, int(round(base * m)))
    return base


# ══════════════════════════════════════════════════════════════
# Lógica de disponibilidade por funcionário
# ══════════════════════════════════════════════════════════════

def _time_to_minutes(t) -> int:
    """'HH:MM' ou objeto time → minutos desde meia-noite."""
    s = str(t)[:5]
    h, m = s.split(':')
    return int(h) * 60 + int(m)


def _minutes_to_time(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _fetch_staff_for_specialty(company_id: int, specialty_id: str) -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, specialty_ids, days_of_week,
                   work_start, work_end, lunch_start, lunch_end,
                   work_hours_by_day
            FROM petshop_staff
            WHERE company_id = %s AND is_active = TRUE
              AND %s = ANY(specialty_ids)
            ORDER BY name
            """,
            (company_id, specialty_id),
        )
        return [dict(r) for r in cur.fetchall()]


def _fetch_business_hours_for_day(company_id: int, db_dow: int) -> dict | None:
    """
    Busca horário de funcionamento do petshop para um dia da semana (db_dow: 0=dom..6=sab).
    Retorna dict com open_minutes/close_minutes ou None se não houver registro.
    Se is_closed=True ou open_time é None, retorna {'is_closed': True}.
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT open_time, close_time, is_closed
            FROM petshop_business_hours
            WHERE company_id = %s AND day_of_week = %s
            """,
            (company_id, db_dow),
        )
        row = cur.fetchone()
    if not row:
        return None
    if row['is_closed'] or not row.get('open_time'):
        return {'is_closed': True}
    ot = str(row['open_time'])[:5]
    ct = str(row['close_time'])[:5] if row.get('close_time') else None
    return {
        'is_closed': False,
        'open_minutes': _time_to_minutes(ot),
        'close_minutes': _time_to_minutes(ct) if ct else None,
    }


def _fetch_staff_blocks(staff_id: str, target_date: str) -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT start_time, end_time
            FROM petshop_staff_schedules
            WHERE staff_id = %s
              AND start_date <= %s
              AND (end_date >= %s OR end_date IS NULL)
            """,
            (staff_id, target_date, target_date),
        )
        return [dict(r) for r in cur.fetchall()]


def _fetch_staff_appointments(staff_id: str, target_date: str, company_id: int) -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT a.start_time, a.service_id, ps.duration_min
            FROM petshop_appointments a
            JOIN petshop_services ps ON ps.id = a.service_id AND ps.company_id = a.company_id
            WHERE a.staff_id = %s
              AND a.scheduled_date = %s
              AND a.company_id = %s
              AND a.status NOT IN ('cancelled')
              AND a.start_time IS NOT NULL
            """,
            (staff_id, target_date, company_id),
        )
        return [dict(r) for r in cur.fetchall()]


def _check_staff_conflict(
    staff_id: str,
    target_date: str,
    start_time: str,
    end_time: str,
    company_id: int,
    exclude_appointment_id: str | None = None,
) -> bool:
    with get_connection() as conn:
        cur = conn.cursor()
        sql = """
            SELECT 1 FROM petshop_appointments
            WHERE staff_id = %s
              AND scheduled_date = %s
              AND company_id = %s
              AND status NOT IN ('cancelled')
              AND start_time < %s::time
              AND end_time > %s::time
        """
        params: list = [staff_id, target_date, company_id, end_time, start_time]
        if exclude_appointment_id:
            sql += " AND id::text != %s"
            params.append(exclude_appointment_id)
        cur.execute(sql, params)
        return cur.fetchone() is not None


def _build_staff_available_slots(
    staff_list: list[dict],
    target_date: str,
    duration_min: int,
    service_duration_base: int,
    company_id: int,
    now_dt: datetime,
    parsed_date: date,
    pet_occupied_starts: set[str],
    shop_open_minutes: int | None = None,
    shop_close_minutes: int | None = None,
) -> dict[str, dict]:
    """
    Gera slots disponíveis por funcionário para a data/duração dados.
    Retorna dict[start_time → slot_entry] com o primeiro staff livre por horário.
    """
    # Python: Monday=0..Sunday=6 mas o banco usa 0=dom, 1=seg...6=sab
    # Converter: datetime.weekday() → 0=seg…6=dom; banco: 0=dom…6=sab
    python_dow = parsed_date.weekday()  # 0=seg, 6=dom
    db_dow = (python_dow + 1) % 7       # seg=1, dom=0

    slots_by_time: dict[str, dict] = {}

    for staff in staff_list:
        staff_days = staff.get('days_of_week') or []
        if db_dow not in staff_days:
            continue

        blocks = _fetch_staff_blocks(str(staff['id']), target_date)
        if any(not b['start_time'] and not b['end_time'] for b in blocks):
            continue  # dia inteiro bloqueado

        existing = _fetch_staff_appointments(str(staff['id']), target_date, company_id)

        busy: list[dict] = []
        for appt in existing:
            if appt['start_time']:
                start_m = _time_to_minutes(appt['start_time'])
                dur = int(appt.get('duration_min') or 60)
                busy.append({'start': start_m, 'end': start_m + dur})

        # Resolve per-day hours (override or default)
        by_day = staff.get('work_hours_by_day') or {}
        day_key = str(db_dow)
        if day_key in by_day:
            day_h = by_day[day_key]
            ws = day_h['start']
            we = day_h['end']
            ls = day_h.get('lunch_start')
            le = day_h.get('lunch_end')
        else:
            ws = staff['work_start']
            we = staff['work_end']
            ls = staff.get('lunch_start')
            le = staff.get('lunch_end')

        # Almoço
        if ls and le:
            busy.append({
                'start': _time_to_minutes(ls),
                'end': _time_to_minutes(le),
            })

        # Bloqueios parciais
        for b in blocks:
            if b['start_time'] and b['end_time']:
                busy.append({
                    'start': _time_to_minutes(b['start_time']),
                    'end': _time_to_minutes(b['end_time']),
                })

        work_start = _time_to_minutes(ws)
        work_end = _time_to_minutes(we)

        # Limitar ao horário de funcionamento do petshop
        if shop_open_minutes is not None:
            work_start = max(work_start, shop_open_minutes)
        if shop_close_minutes is not None:
            work_end = min(work_end, shop_close_minutes)
        if work_start >= work_end:
            continue

        cursor = work_start

        while cursor + duration_min <= work_end:
            slot_end = cursor + duration_min
            start_str = _minutes_to_time(cursor)

            # Não mostrar horários já passados (horário de Brasília)
            slot_dt = datetime.combine(parsed_date, datetime.strptime(start_str, '%H:%M').time())
            if slot_dt <= now_dt:
                cursor += duration_min
                continue

            # Não mostrar horários que o pet já tem compromisso
            if start_str in pet_occupied_starts:
                cursor += duration_min
                continue

            conflict = any(cursor < b['end'] and slot_end > b['start'] for b in busy)
            if not conflict and start_str not in slots_by_time:
                uses_double = duration_min > service_duration_base
                slots_by_time[start_str] = {
                    'slot_id': str(uuid.uuid4()),
                    'start_time': start_str,
                    'end_time': _minutes_to_time(slot_end),
                    'staff_id': str(staff['id']),
                    'staff_name': staff['name'],
                    'vagas': 1,
                    'booking_date': target_date,
                    'uses_double_slot': uses_double,
                    'second_slot_time': (
                        _minutes_to_time(cursor + service_duration_base)
                        if uses_double else None
                    ),
                }

            cursor += duration_min

    return slots_by_time


def build_booking_tools(company_id: int, client_id) -> list:
    """
    Retorna as tools de agendamento com company_id e client_id pré-vinculados via closure.
    A LLM nunca recebe os IDs como parâmetro.
    """

    def get_specialties() -> dict:
        """
        Retorna especialidades ativas do petshop.
        Chamar para saber quais especialidades existem antes de buscar disponibilidade.
        """
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id, name, description
                FROM petshop_specialties
                WHERE company_id = %s AND is_active = TRUE
                ORDER BY name
            """,
                (company_id,),
            )
            specs = cur.fetchall()
        return {"specialties": [dict(s) for s in specs], "count": len(specs)}

    def get_services() -> dict:
        """
        Retorna serviços ativos (`services`) e, quando existir cadastro, ofertas de hospedagem em
        `lodging_offerings` (hotel/creche — não usam create_appointment).

        Ao responder pedido de **catálogo**, **lista de serviços**, **o que vocês fazem/oferecem** ou
        equivalente: cite **todos** os itens de `services` **e** **todos** de `lodging_offerings`
        (uma linha por item) — **não** omita hospedagem só porque é outro fluxo.

        Serviços com block_ai_schedule=true NÃO devem ser agendados pelo bot via create_appointment.
        """
        cached = cache_get_services(company_id)
        if cached is not None:
            with get_connection() as conn:
                cur = conn.cursor()
                lodging_offerings = _lodging_offerings_for_catalog(cur, company_id)
            out = {
                "services": cached["services"],
                "count": cached["count"],
                "lodging_offerings": lodging_offerings,
                "lodging_offerings_count": len(lodging_offerings),
            }
            return {**out, "from_cache": True}

        out = fetch_services_snapshot(company_id)
        cache_set_services(
            company_id,
            {"services": out["services"], "count": out["count"]},
        )
        return out


    def get_available_times(
        specialty_id: str,
        target_date: str,
        service_id=None,
        pet_id: str | None = None,
        ignore_appointment_ids: str | None = None,
    ) -> dict:
        """
        Retorna horários disponíveis para uma especialidade numa data.
        Use sempre quando houver data. Não invente horários.
        `pet_id` é obrigatório; `service_id` ajuda a corrigir specialty_id e duração.
        `ignore_appointment_ids` (opcional): UUIDs separados por vírgula dos compromissos que não devem
        contar como «pet ocupado» nesta consulta — use ao **remarcar** na mesma data (id de
        get_upcoming_appointments e, se uses_double_slot, também paired_appointment_id).
        """
        try:
            parsed_date = date.fromisoformat(target_date)
        except ValueError:
            return {
                "available": False,
                "message": "Data inválida. Use o formato YYYY-MM-DD.",
            }

        pid_norm = (str(pet_id).strip() if pet_id is not None else "") or ""
        if not pid_norm or not _is_uuid(pid_norm):
            return {
                "available": False,
                "closed_days": [],
                "full_days": [],
                "available_times": [],
                "message": (
                    "pet_id é obrigatório (UUID do pet). Chame get_client_pets e use o campo id do animal "
                    "antes de get_available_times."
                ),
                "missing_pet_id": True,
            }
        pet_id = pid_norm

        ignore_aid: list[str] = []
        if ignore_appointment_ids and str(ignore_appointment_ids).strip():
            for part in re.split(r"[\s,;]+", str(ignore_appointment_ids).strip()):
                p = part.strip()
                if _is_uuid(p):
                    ignore_aid.append(p)

        # Data "hoje" em America/Sao_Paulo
        today = today_sao_paulo()
        if parsed_date < today:
            return {
                "available": False,
                "message": "Não é possível agendar em datas passadas.",
            }
        if parsed_date > today + timedelta(days=MAX_AGENDA_DAYS_AHEAD):
            return {
                "available": False,
                "message": f"Só é possível agendar com até {MAX_AGENDA_DAYS_AHEAD} dias de antecedência.",
                "beyond_limit": True,
            }

        now = now_sao_paulo_naive()

        raw_specialty = (specialty_id or "").strip()
        spec_id = raw_specialty

        def _resolve_specialty_from_service(svc_int: int) -> str | None:
            with get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT specialty_id::text AS sid
                    FROM petshop_services
                    WHERE id = %s AND company_id = %s AND is_active = TRUE
                    LIMIT 1
                    """,
                    (svc_int, company_id),
                )
                row = cur.fetchone()
            sid = row.get("sid") if row else None
            return str(sid).strip() if sid else None

        if not _is_uuid(spec_id):
            lookup_service_id = None
            if service_id is not None:
                try:
                    lookup_service_id = int(service_id)
                except (TypeError, ValueError):
                    lookup_service_id = None
            if lookup_service_id is None and raw_specialty.isdigit():
                try:
                    lookup_service_id = int(raw_specialty)
                except ValueError:
                    lookup_service_id = None
            if lookup_service_id is not None:
                resolved = _resolve_specialty_from_service(lookup_service_id)
                if resolved and _is_uuid(resolved):
                    spec_id = resolved
                    logger.info(
                        "get_available_times: specialty_id corrigido via service_id=%s → %s",
                        lookup_service_id,
                        spec_id,
                    )
            if not _is_uuid(spec_id):
                logger.warning(
                    "get_available_times: specialty_id inválido (não é UUID): %r",
                    specialty_id,
                )
                return {
                    "available": False,
                    "closed_days": [],
                    "full_days": [],
                    "available_times": [],
                    "message": (
                        "specialty_id deve ser o UUID de get_specialties. "
                        "Se tiver o id numérico do serviço (get_services), passe em service_id — "
                        "o sistema resolve a especialidade automaticamente."
                    ),
                    "hint": "Chame get_services, use o campo specialty_id do serviço escolhido, ou só service_id + target_date + pet_id.",
                }

        sid_for_block: int | None = None
        if service_id is not None:
            try:
                sid_for_block = int(service_id)
            except (TypeError, ValueError):
                sid_for_block = None
        if sid_for_block is None and raw_specialty.strip().isdigit():
            try:
                sid_for_block = int(raw_specialty.strip())
            except ValueError:
                sid_for_block = None
        if sid_for_block is not None:
            block_meta = _fetch_service_ai_block_if_any(company_id, sid_for_block)
            if block_meta:
                logger.info(
                    "get_available_times: service_id=%s bloqueado para IA (block_ai_schedule)",
                    sid_for_block,
                )
                return {
                    "available": False,
                    "error_code": ERROR_SERVICE_BLOCKED_FOR_AI,
                    "blocked_for_ai_schedule": True,
                    "closed_days": [],
                    "full_days": [],
                    "available_times": [],
                    "message": _message_blocked_service_for_ai(
                        block_meta["service_name"],
                        block_meta.get("dependent_service_name"),
                    ),
                    "dependent_service_name": block_meta.get("dependent_service_name"),
                }

        # ── Verificar business hours do petshop ──────────────────
        python_dow = parsed_date.weekday()  # 0=seg, 6=dom
        db_dow = (python_dow + 1) % 7       # seg=1, dom=0
        bh = _fetch_business_hours_for_day(company_id, db_dow)
        if bh and bh.get('is_closed'):
            return {
                "available": False,
                "closed_days": [target_date],
                "full_days": [],
                "available_times": [],
                "message": "O petshop está fechado neste dia.",
            }
        shop_open_minutes = bh['open_minutes'] if bh else None
        shop_close_minutes = bh['close_minutes'] if bh else None

        # ── Lógica por funcionário (nova) ────────────────────────
        # Se houver staff cadastrado para a especialidade, usa a nova lógica.
        # Caso contrário, cai no fluxo legado de slots (vw_slot_availability).

        busy_starts: set[str] = set()
        with get_connection() as conn:
            cur = conn.cursor()
            busy_starts = _pet_occupied_starts_hhmm_staff(
                cur,
                company_id,
                pet_id,
                parsed_date,
                exclude_appointment_ids=ignore_aid or None,
            )

        staff_list = _fetch_staff_for_specialty(company_id, spec_id)

        if staff_list:
            # ── Nova lógica: disponibilidade por funcionário ──────
            service_duration_base = 60
            duration_min_eff = 60

            if service_id is not None:
                try:
                    sid_int = int(service_id)
                except (TypeError, ValueError):
                    sid_int = None
                if sid_int is not None:
                    with get_connection() as conn:
                        cur = conn.cursor()
                        cur.execute(
                            """
                            SELECT duration_min, duration_multiplier_large
                            FROM petshop_services
                            WHERE id = %s AND company_id = %s AND is_active = TRUE
                            """,
                            (sid_int, company_id),
                        )
                        svc_r = cur.fetchone()
                    if svc_r:
                        service_duration_base = int(svc_r['duration_min'] or 60)
                        # Checar porte do pet para multiplicador G/GG
                        with get_connection() as conn:
                            cur = conn.cursor()
                            cur.execute(
                                "SELECT size FROM petshop_pets WHERE id = %s AND company_id = %s",
                                (pet_id, company_id),
                            )
                            pet_r2 = cur.fetchone()
                        if pet_r2 and (pet_r2.get('size') or '').upper() in ('G', 'GG'):
                            mult = svc_r.get('duration_multiplier_large')
                            try:
                                m = float(mult) if mult is not None else 1.0
                            except (TypeError, ValueError):
                                m = 1.0
                            if m > 1:
                                duration_min_eff = int(round(service_duration_base * m))
                            else:
                                duration_min_eff = service_duration_base
                        else:
                            duration_min_eff = service_duration_base

            slots_by_time = _build_staff_available_slots(
                staff_list=staff_list,
                target_date=target_date,
                duration_min=duration_min_eff,
                service_duration_base=service_duration_base,
                company_id=company_id,
                now_dt=now,
                parsed_date=parsed_date,
                pet_occupied_starts=busy_starts,
                shop_open_minutes=shop_open_minutes,
                shop_close_minutes=shop_close_minutes,
            )

            available_slots = sorted(slots_by_time.values(), key=lambda x: x['start_time'])

            if not available_slots:
                return {
                    "available": False,
                    "closed_days": [],
                    "full_days": [target_date],
                    "available_times": [],
                    "message": "Sem vagas disponíveis neste dia para os profissionais desta especialidade.",
                    "availability_policy": {
                        "timezone": "America/Sao_Paulo",
                        "reference_now_local": now.strftime("%Y-%m-%d %H:%M"),
                        "data_source": "petshop_staff",
                        "specialty_id": spec_id,
                    },
                }

            # Armazenar no cache Redis para create/reschedule recuperar staff_id + times
            cache_set_slots(company_id, str(client_id), available_slots)

            return {
                "available": True,
                "date": target_date,
                "specialty_id_effective": spec_id,
                "closed_days": [],
                "full_days": [],
                "available_times": available_slots,
                "service_duration_minutes": duration_min_eff,
                "availability_policy": {
                    "timezone": "America/Sao_Paulo",
                    "reference_now_local": now.strftime("%Y-%m-%d %H:%M"),
                    "data_source": "petshop_staff",
                    "specialty_id": spec_id,
                },
                "total_offered_slots": len(available_slots),
            }

        # Sem profissionais cadastrados para esta especialidade
        return {
            "available": False,
            "closed_days": [],
            "full_days": [target_date],
            "available_times": [],
            "message": (
                "Nenhum profissional cadastrado para esta especialidade. "
                "O agendamento deve ser feito diretamente com a loja."
            ),
            "availability_policy": {
                "timezone": "America/Sao_Paulo",
                "reference_now_local": now.strftime("%Y-%m-%d %H:%M"),
                "data_source": "petshop_staff",
                "specialty_id": spec_id,
            },
        }

    def create_appointment(
        pet_id: str,
        slot_id: str,
        service_id: int | None = None,
        confirmed: bool = False,
        notes: str | None = None,
    ) -> dict:
        """
        Cria um agendamento por chamada.
        Regras:
        - exige confirmed=True
        - slot_id vem de get_available_times
        - service_id vem de get_services
        - se já existir compromisso ativo equivalente, use reschedule_appointment
        """
        if not confirmed:
            return {
                "success": False,
                "message": "Aguardando confirmação explícita do cliente antes de criar o agendamento.",
            }

        # Garante que client_id é válido antes de qualquer query
        if not client_id:
            logger.error(
                "create_appointment: client_id vazio — cliente não encontrado no contexto"
            )
            return {
                "success": False,
                "message": "Cliente não identificado. Não é possível criar o agendamento.",
            }

        if service_id is None:
            return {
                "success": False,
                "missing_service_id": True,
                "message": (
                    "service_id é obrigatório (número inteiro do catálogo). Chame get_services e use o campo "
                    "`id` do serviço deste agendamento — um serviço por chamada a create_appointment."
                ),
            }

        # service_id é integer no banco
        try:
            service_id = int(service_id)
        except (ValueError, TypeError):
            return {
                "success": False,
                "message": "service_id deve ser um número inteiro válido (id numérico de get_services).",
            }

        logger.info(
            "create_appointment | client_id=%s | pet_id=%s | service_id=%s | slot_id=%s",
            client_id,
            pet_id,
            service_id,
            slot_id,
        )
        try:
            result = _do_create_appointment(
                company_id,
                client_id,
                pet_id,
                service_id,
                slot_id,
                notes,
            )
            logger.info("create_appointment resultado: %s", result)
            return result
        except Exception as exc:
            logger.exception(
                "create_appointment falhou | client_id=%s | pet_id=%s | service_id=%s | slot_id=%s | erro=%s",
                client_id,
                pet_id,
                service_id,
                slot_id,
                exc,
            )
            return {
                "success": False,
                "message": "Falha ao salvar agendamento no banco. Verifique os IDs e tente novamente.",
                "debug": str(exc),
            }

    def _do_create_appointment_staff(
        company_id, client_id, pet_id, service_id, cached_slot: dict, notes
    ):
        """Cria agendamento usando a nova lógica por funcionário (slot do cache Redis)."""
        staff_id = cached_slot['staff_id']
        start_time = cached_slot['start_time']
        end_time = cached_slot['end_time']
        appt_date = cached_slot['booking_date']

        with get_connection() as conn:
            cur = conn.cursor()

            # Valida serviço
            cur.execute(
                """
                SELECT ps.id, ps.name, ps.price, ps.price_by_size, ps.duration_multiplier_large,
                       ps.duration_min, ps.block_ai_schedule, dep.name AS dependent_service_name
                FROM petshop_services ps
                LEFT JOIN petshop_services dep ON dep.id = ps.dependent_service_id
                WHERE ps.id = %s AND ps.company_id = %s AND ps.is_active = TRUE
                """,
                (service_id, company_id),
            )
            service_row = cur.fetchone()
            if not service_row:
                return {"success": False, "message": f"Serviço id={service_id} não encontrado."}
            if service_row.get("block_ai_schedule"):
                return {
                    "success": False,
                    "error_code": ERROR_SERVICE_BLOCKED_FOR_AI,
                    "message": _message_blocked_service_for_ai(
                        service_row["name"], service_row.get("dependent_service_name")
                    ),
                }

            # Valida pet
            cur.execute(
                "SELECT id, name, size, species, breed FROM petshop_pets WHERE id = %s AND client_id = %s AND company_id = %s AND is_active = TRUE",
                (pet_id, client_id, company_id),
            )
            pet_row = cur.fetchone()
            if not pet_row:
                return {"success": False, "message": f"Pet id={pet_id} não encontrado."}

            missing_pet_fields = []
            if not pet_row.get("species"):
                missing_pet_fields.append("espécie (cachorro ou gato)")
            if not pet_row.get("size"):
                missing_pet_fields.append("porte (P, M, G ou GG)")
            if missing_pet_fields:
                return {
                    "success": False,
                    "incomplete_pet": True,
                    "missing_fields": missing_pet_fields,
                    "message": f"Cadastro do pet incompleto. Faltam: {', '.join(missing_pet_fields)}.",
                }

            # Verifica conflito de horário em tempo real
            if _check_staff_conflict(staff_id, appt_date, start_time, end_time, company_id):
                return {
                    "success": False,
                    "error_code": "client_same_start_conflict",
                    "message": "Este horário acabou de ser ocupado. Chame get_available_times e escolha outro.",
                }

            # Mesmo serviço/pet no mesmo dia → sugerir remarcação
            cur.execute(
                """
                SELECT id FROM petshop_appointments
                WHERE company_id = %s AND client_id = %s AND pet_id = %s AND service_id = %s
                  AND status IN ('pending', 'confirmed')
                  AND scheduled_date = %s::date
                LIMIT 1
                """,
                (company_id, client_id, pet_id, service_id, appt_date),
            )
            same_day = cur.fetchone()
            if same_day:
                return {
                    "success": False,
                    "error_code": "use_reschedule_instead",
                    "message": "Esse pet já tem esse serviço marcado nesse dia. Use remarcação.",
                    "appointment_id_for_reschedule": str(same_day["id"]),
                }

            price_charged = _resolve_price_charged_from_service_and_pet(service_row, pet_row)
            eff_dur = _effective_service_duration_minutes(service_row, pet_row)

            cur.execute(
                """
                INSERT INTO petshop_appointments
                    (company_id, client_id, pet_id, service_id, staff_id,
                     scheduled_date, start_time, end_time,
                     status, confirmed, notes, price_charged, slot_id)
                VALUES (%s, %s, %s, %s, %s, %s::date, %s::time, %s::time,
                        'confirmed', TRUE, %s, %s, NULL)
                RETURNING id
                """,
                (
                    company_id, client_id, pet_id, service_id, staff_id,
                    appt_date, start_time, end_time,
                    notes, price_charged,
                ),
            )
            appointment_id = cur.fetchone()["id"]

            cur.execute(
                "UPDATE clients SET conversation_stage = 'completed', updated_at = NOW() WHERE id = %s AND company_id = %s",
                (client_id, company_id),
            )

        pet_nm = (pet_row.get("name") or "").strip() or "Pet"
        svc_nm = (service_row.get("name") or "").strip() or "Serviço"
        end_br = hhmm_after_minutes(start_time, eff_dur)
        return {
            "success": True,
            "appointment_id": str(appointment_id),
            "message": f"Feito — {pet_nm} ficou com {svc_nm} na agenda.",
            "rescheduled": False,
            "start_time": start_time,
            "service_end_time": end_br,
            "uses_double_slot": cached_slot.get("uses_double_slot", False),
            "service_duration_minutes": eff_dur,
            "pet_name": pet_nm,
            "service_name": svc_nm,
            "appointment_date": appt_date,
            "staff_name": cached_slot.get("staff_name"),
            "customer_pickup_hint": (
                f"Previsão de término do serviço ~{end_br} "
                f"(início {start_time}; duração prevista ~{eff_dur} min para este pet)."
            ),
            "canonical_summary": f"{svc_nm} para {pet_nm} no dia {appt_date} às {start_time}",
        }

    def _do_create_appointment(
        company_id, client_id, pet_id, service_id, slot_id, notes
    ):
        # Valida IDs antes de qualquer consulta ao banco
        if not _is_uuid(pet_id):
            return {
                "success": False,
                "message": (
                    f"pet_id inválido: '{pet_id}' não é um UUID. "
                    "Chame get_client_pets para obter o ID correto do pet antes de agendar."
                ),
            }
        if not _is_uuid(slot_id):
            return {
                "success": False,
                "message": (
                    f"slot_id inválido: '{slot_id}' não é um UUID. "
                    "Chame get_available_times para obter o ID correto do slot antes de agendar."
                ),
            }

        # ── Verificar cache de slots (lógica por funcionário) ──
        cached_slot = cache_get_slot(company_id, str(client_id), slot_id)
        if cached_slot:
            return _do_create_appointment_staff(
                company_id, client_id, pet_id, service_id, cached_slot, notes
            )

        # Slot não encontrado no cache — expirado ou inválido
        return {
            "success": False,
            "error_code": "slot_expired",
            "message": (
                "O horário selecionado expirou ou não é mais válido. "
                "Chame get_available_times novamente para obter horários atualizados."
            ),
        }

    def reschedule_appointment(
        appointment_id: str | None = None,
        new_slot_id: str | None = None,
        confirmed: bool = False,
        reason: str | None = None,
    ) -> dict:
        """
        Remarca um agendamento por chamada, na mesma transação.
        Use para trocar data/horário de compromisso já existente.
        Regras:
        - exige appointment_id de get_upcoming_appointments
        - exige new_slot_id de get_available_times
        - confirmed=True só após aceite explícito
        """
        if not confirmed:
            return {
                "success": False,
                "message": "Aguardando confirmação explícita do cliente antes de remarcar.",
            }

        aid = (str(appointment_id).strip() if appointment_id is not None else "") or ""
        nid = (str(new_slot_id).strip() if new_slot_id is not None else "") or ""

        if not aid:
            return {
                "success": False,
                "missing_appointment_id": True,
                "message": (
                    "appointment_id é obrigatório (UUID). Chame get_upcoming_appointments e use o campo `id` "
                    "do compromisso que está sendo remarcado — um agendamento por chamada a reschedule_appointment."
                ),
            }
        if not nid:
            return {
                "success": False,
                "missing_new_slot_id": True,
                "message": (
                    "new_slot_id é obrigatório (UUID do slot novo). Chame get_available_times na data desejada "
                    "e use o slot_id do horário escolhido."
                ),
            }
        if not _is_uuid(aid):
            return {
                "success": False,
                "message": "appointment_id inválido. Use o id retornado por get_upcoming_appointments.",
            }
        if not _is_uuid(nid):
            return {
                "success": False,
                "message": "new_slot_id inválido. Chame get_available_times e use o slot_id da lista.",
            }

        if not client_id:
            return {
                "success": False,
                "message": "Cliente não identificado. Não é possível remarcar.",
            }

        cancel_note = (reason or "Remarcação via assistente").strip()

        logger.info(
            "reschedule_appointment | client_id=%s | from=%s | new_slot=%s",
            client_id,
            aid,
            nid,
        )

        try:
            with get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT id, pet_id, service_id, notes, status, slot_id, staff_id
                    FROM petshop_appointments
                    WHERE id = %s AND company_id = %s AND client_id = %s
                    """,
                    (aid, company_id, client_id),
                )
                old = cur.fetchone()
                if not old:
                    return {
                        "success": False,
                        "message": "Agendamento não encontrado.",
                    }
                if old.get("status") in ("completed", "cancelled"):
                    return {
                        "success": False,
                        "message": "Agendamento já finalizado — não pode remarcar.",
                    }
                # Aceita tanto agendamentos com slot_id (legado) quanto com staff_id (novo)
                if not old.get("slot_id") and not old.get("staff_id"):
                    return {
                        "success": False,
                        "message": (
                            "Este agendamento não está vinculado a um horário reconhecido. "
                            "Oriente o cliente a falar com a loja."
                        ),
                    }

                ids_to_cancel = [str(old["id"])]
                partner_id = _extract_double_pair_id(old.get("notes"))
                if partner_id and _is_uuid(partner_id):
                    cur.execute(
                        """
                        SELECT id, status FROM petshop_appointments
                        WHERE id = %s AND company_id = %s AND client_id = %s
                        """,
                        (partner_id, company_id, client_id),
                    )
                    prow = cur.fetchone()
                    if prow and prow.get("status") not in ("completed", "cancelled"):
                        ids_to_cancel.append(str(prow["id"]))

                ids_to_cancel_set = set(ids_to_cancel)

                pet_id = str(old["pet_id"])
                try:
                    service_id = int(old["service_id"])
                except (TypeError, ValueError):
                    return {
                        "success": False,
                        "message": "Dados do agendamento antigo inválidos.",
                    }
                user_notes = _strip_internal_appointment_notes(old.get("notes"))

                # ── Verificar se novo slot é da lógica staff (cache Redis) ──
                cached_new_slot = cache_get_slot(company_id, str(client_id), nid)
                if cached_new_slot:
                    # Cancela agendamentos antigos e cria novo via lógica staff
                    for cid_cancel in ids_to_cancel:
                        cur.execute(
                            """
                            UPDATE petshop_appointments
                            SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = %s
                            WHERE id = %s AND company_id = %s AND client_id = %s
                              AND status NOT IN ('completed', 'cancelled')
                            """,
                            (cancel_note, cid_cancel, company_id, client_id),
                        )
                    conn.commit()

                    new_staff_id = cached_new_slot['staff_id']
                    new_start = cached_new_slot['start_time']
                    new_end = cached_new_slot['end_time']
                    new_date = cached_new_slot['booking_date']

                    if _check_staff_conflict(new_staff_id, new_date, new_start, new_end, company_id):
                        return {
                            "success": False,
                            "error_code": "client_same_start_conflict",
                            "message": "Este horário acabou de ser ocupado. Chame get_available_times e escolha outro.",
                        }

                    cur.execute(
                        """
                        SELECT id, name, price, price_by_size, duration_multiplier_large, duration_min
                        FROM petshop_services
                        WHERE id = %s AND company_id = %s AND is_active = TRUE
                        """,
                        (service_id, company_id),
                    )
                    svc_rs = cur.fetchone()
                    cur.execute(
                        "SELECT id, name, size FROM petshop_pets WHERE id = %s AND company_id = %s AND is_active = TRUE",
                        (pet_id, company_id),
                    )
                    pet_rs = cur.fetchone()

                    price_charged = _resolve_price_charged_from_service_and_pet(svc_rs, pet_rs) if svc_rs and pet_rs else None
                    eff_dur = _effective_service_duration_minutes(svc_rs, pet_rs) if svc_rs and pet_rs else 60

                    cur.execute(
                        """
                        INSERT INTO petshop_appointments
                            (company_id, client_id, pet_id, service_id, staff_id,
                             scheduled_date, start_time, end_time,
                             status, confirmed, notes, price_charged, slot_id)
                        VALUES (%s, %s, %s, %s, %s, %s::date, %s::time, %s::time,
                                'confirmed', TRUE, %s, %s, NULL)
                        RETURNING id
                        """,
                        (
                            company_id, client_id, pet_id, service_id, new_staff_id,
                            new_date, new_start, new_end,
                            user_notes, price_charged,
                        ),
                    )
                    new_aid = cur.fetchone()["id"]
                    cur.execute(
                        "UPDATE clients SET conversation_stage = 'completed', updated_at = NOW() WHERE id = %s AND company_id = %s",
                        (client_id, company_id),
                    )

                    pet_nmr = (pet_rs.get("name") or "Pet").strip() if pet_rs else "Pet"
                    svc_nmr = (svc_rs.get("name") or "Serviço").strip() if svc_rs else "Serviço"
                    end_br = hhmm_after_minutes(new_start, eff_dur)
                    return {
                        "success": True,
                        "rescheduled": True,
                        "previous_appointment_ids": ids_to_cancel,
                        "appointment_id": str(new_aid),
                        "message": f"Pronto — atualizei o horário do {pet_nmr} ({svc_nmr}).",
                        "start_time": new_start,
                        "service_end_time": end_br,
                        "uses_double_slot": False,
                        "service_duration_minutes": eff_dur,
                        "pet_name": pet_nmr,
                        "service_name": svc_nmr,
                        "appointment_date": new_date,
                        "staff_name": cached_new_slot.get("staff_name"),
                        "customer_pickup_hint": (
                            f"Previsão de término ~{end_br} (início {new_start}; duração ~{eff_dur} min)."
                        ),
                        "canonical_summary": f"{svc_nmr} para {pet_nmr} no dia {new_date} às {new_start}",
                    }

                # Novo slot não encontrado no cache — expirado ou inválido
                return {
                    "success": False,
                    "error_code": "slot_expired",
                    "message": (
                        "O novo horário selecionado expirou ou não é mais válido. "
                        "Chame get_available_times novamente para obter horários atualizados."
                    ),
                }
        except Exception as exc:
            logger.exception("reschedule_appointment falhou | client_id=%s", client_id)
            return {
                "success": False,
                "message": "Falha ao remarcar. Tente de novo ou oriente o cliente a falar com a loja.",
                "debug": str(exc),
            }

    def cancel_appointment(appointment_id: str, reason: str = None) -> dict:
        """
        Cancela um agendamento existente do cliente.
        `appointment_id` deve vir de get_upcoming_appointments.
        """
        if not appointment_id:
            return {"success": False, "message": "appointment_id é obrigatório."}

        logger.info(
            "cancel_appointment | client_id=%s | appointment_id=%s | reason=%r",
            client_id,
            appointment_id,
            reason,
        )
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT a.id, a.notes, a.status, a.start_time, a.end_time,
                       s.name AS service_name, p.name AS pet_name
                FROM petshop_appointments a
                LEFT JOIN petshop_services s ON s.id = a.service_id
                LEFT JOIN pets p ON p.id = a.pet_id
                WHERE a.id = %s AND a.company_id = %s AND a.client_id = %s
            """,
                (appointment_id, company_id, client_id),
            )
            existing = cur.fetchone()

            if (
                not existing
                or existing.get("status") in ("completed", "cancelled")
            ):
                updated = None
            else:
                partner_id = _extract_double_pair_id(existing.get("notes"))

                cur.execute(
                    """
                    UPDATE petshop_appointments
                    SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = %s
                    WHERE id = %s AND company_id = %s AND client_id = %s
                      AND status NOT IN ('completed', 'cancelled')
                    RETURNING id
                """,
                    (reason, appointment_id, company_id, client_id),
                )
                updated = cur.fetchone()

                if partner_id:
                    cur.execute(
                        """
                        SELECT status FROM petshop_appointments
                        WHERE id = %s AND company_id = %s AND client_id = %s
                    """,
                        (partner_id, company_id, client_id),
                    )
                    prow = cur.fetchone()
                    if prow and prow.get("status") not in (
                        "completed",
                        "cancelled",
                    ):
                        cur.execute(
                            """
                            UPDATE petshop_appointments
                            SET status = 'cancelled', cancelled_at = NOW(),
                                cancel_reason = %s
                            WHERE id = %s AND company_id = %s AND client_id = %s
                              AND status NOT IN ('completed', 'cancelled')
                        """,
                            (
                                reason
                                or "Cancelado em conjunto (dois horários)",
                                partner_id,
                                company_id,
                                client_id,
                            ),
                        )

        if not updated:
            return {
                "success": False,
                "message": "Agendamento não encontrado ou já finalizado/cancelado.",
            }

        cancelled_info = {}
        if existing:
            if existing.get("service_name"):
                cancelled_info["service_name"] = existing["service_name"]
            if existing.get("pet_name"):
                cancelled_info["pet_name"] = existing["pet_name"]
            if existing.get("start_time"):
                cancelled_info["start_time"] = str(existing["start_time"])

        result = {
            "success": True,
            "message": "Agendamento cancelado com sucesso.",
            "cancelled_appointment_id": str(appointment_id),
        }
        result.update(cancelled_info)
        return result

    return [
        get_specialties,
        get_services,
        get_available_times,
        create_appointment,
        reschedule_appointment,
        cancel_appointment,
    ]


def fetch_available_times_snapshot(
    company_id: int,
    client_id: str,
    specialty_id: str,
    target_date: str,
    service_id=None,
    pet_id: str | None = None,
    ignore_appointment_ids: str | None = None,
) -> dict:
    """Mesma lógica da tool `get_available_times` — para pré-carga no router (sem depender do LLM)."""
    tools = build_booking_tools(company_id, client_id)
    get_at = next(
        (t for t in tools if getattr(t, "__name__", "") == "get_available_times"),
        None,
    )
    if not get_at:
        return {"available": False, "message": "Ferramenta de horários indisponível."}
    return get_at(
        specialty_id=specialty_id or "",
        target_date=target_date,
        service_id=service_id,
        pet_id=pet_id,
        ignore_appointment_ids=ignore_appointment_ids,
    )
