import logging
import os
import re
import urllib.request
import json
from datetime import date, datetime, timedelta
from db import get_connection
from memory.tool_result_cache import cache_get_services, cache_set_services
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


# URL interna do backend Node (Docker network)
BACKEND_INTERNAL_URL = os.getenv("BACKEND_INTERNAL_URL", "http://backend:3000")

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

    def _try_generate_slots() -> bool:
        """Tenta gerar slots via endpoint interno. Retorna True se bem-sucedido."""
        try:
            url = f"{BACKEND_INTERNAL_URL}/internal/generate-slots"
            payload = json.dumps(
                {"company_id": company_id, "days": MAX_AGENDA_DAYS_AHEAD}
            ).encode()
            req = urllib.request.Request(
                url, data=payload, headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                result = json.loads(resp.read())
                logger.info("Fallback generate-slots: %s", result)
                return result.get("success", False)
        except Exception as exc:
            logger.warning("Fallback generate-slots falhou: %s", exc)
            return False

    def _query_available_slots(specialty_id_val, target_date_val):
        """
        Slots com vaga na grade (não bloqueados, used < max) para a **especialidade**
        do serviço — fonte: view `vw_slot_availability` (petshop_slots + specialty ativa).
        """
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT slot_id AS id, slot_time, max_capacity, used_capacity,
                       available_capacity AS vagas_restantes
                FROM vw_slot_availability
                WHERE company_id = %s
                  AND specialty_id = %s
                  AND slot_date = %s
                ORDER BY slot_time
            """,
                (company_id, specialty_id_val, target_date_val),
            )
            rows = cur.fetchall()
            logger.info(
                "vw_slot_availability | company_id=%s specialty_id=%s slot_date=%s → %s linhas",
                company_id,
                specialty_id_val,
                target_date_val,
                len(rows),
            )
            return rows

    def _query_slots_ordered(specialty_id_val, target_date_val):
        """Todos os slots do dia+especialidade (inclui bloqueados), ordenados por horário."""
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id, slot_time, max_capacity, used_capacity, is_blocked
                FROM petshop_slots
                WHERE company_id = %s
                  AND specialty_id = %s
                  AND slot_date = %s
                ORDER BY slot_time
            """,
                (company_id, specialty_id_val, target_date_val),
            )
            return cur.fetchall()

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

        slots = _query_available_slots(spec_id, target_date)

        # Fallback: se não há slots, tenta gerar via endpoint interno e re-consulta
        if not slots:
            logger.info(
                "Nenhum slot encontrado para %s/%s — tentando fallback generate-slots",
                spec_id,
                target_date,
            )
            if _try_generate_slots():
                slots = _query_available_slots(spec_id, target_date)

        if not slots:
            return {
                "available": False,
                "closed_days": [],
                "full_days": [target_date],
                "available_times": [],
                "message": "Sem vagas disponíveis neste dia.",
            }

        excluded_lead: list[str] = []
        available_slots = []
        for s in slots:
            slot_dt = datetime.combine(parsed_date, s["slot_time"])
            st = str(s["slot_time"])[:5]
            if slot_dt <= now + timedelta(hours=2):
                excluded_lead.append(st)
                continue
            available_slots.append(
                {
                    "slot_id": str(s["id"]),
                    "start_time": st,
                    "vagas": s["vagas_restantes"],
                    "booking_date": target_date,
                }
            )

        after_lead_count = len(available_slots)

        busy_starts: set[str] = set()
        excluded_same_pet: list[str] = []
        with get_connection() as conn:
            cur = conn.cursor()
            busy_starts = _pet_occupied_slot_starts_hhmm(
                cur,
                company_id,
                pet_id,
                parsed_date,
                exclude_appointment_ids=ignore_aid or None,
            )
        if busy_starts:
            filtered_slots = []
            for x in available_slots:
                if x["start_time"] in busy_starts:
                    excluded_same_pet.append(x["start_time"])
                else:
                    filtered_slots.append(x)
            available_slots = filtered_slots

        def _availability_policy(
            extra: str | None = None,
            excluded_same_pet_starts: list[str] | None = None,
        ) -> dict:
            esp = sorted(set(excluded_same_pet_starts or []))
            note = (
                "A view já filtra por especialidade ativa, slot não bloqueado e vaga. "
                "Aqui só entram em available_times horários com início > agora + 2h (Brasília). "
                "Se o cliente perguntar por um horário listado em excluded_..., explique: "
                "já passou ou não cumpre a antecedência mínima — não invente outro motivo."
            )
            if esp:
                note += (
                    " excluded_due_to_same_pet_already_booked_at_start: o mesmo pet já tem serviço "
                    "começando nesse horário neste dia (ex.: 2º bloco de banho G/GG) — para outro serviço no mesmo dia, "
                    "só oferte inícios **depois** do último bloco ocupado."
                )
            pol = {
                "timezone": "America/Sao_Paulo",
                "minimum_hours_ahead_of_start": 2,
                "reference_now_local": now.strftime("%Y-%m-%d %H:%M"),
                "data_source": "vw_slot_availability",
                "specialty_id": spec_id,
                "slots_with_capacity_before_filter": len(slots),
                "excluded_due_to_minimum_notice_or_past": sorted(set(excluded_lead)),
                "note": note,
            }
            if esp:
                pol["excluded_due_to_same_pet_already_booked_at_start"] = esp
            if extra:
                pol["situation"] = extra
            return pol

        if not available_slots:
            if after_lead_count > 0 and excluded_same_pet:
                return {
                    "available": False,
                    "closed_days": [],
                    "full_days": [],
                    "available_times": [],
                    "message": (
                        "Para este pet neste dia, após antecedência mínima, todo início de faixa com vaga coincide "
                        "com um horário em que ele já tem serviço (cada bloco G/GG conta). "
                        "Para **outro** serviço no mesmo dia, oferte só horários **depois** do último bloco ocupado "
                        "— veja availability_policy.excluded_due_to_same_pet_already_booked_at_start ou tente outro dia. "
                        "Se estiver **remarcando**, chame de novo com ignore_appointment_ids = id (+ paired_appointment_id se houver)."
                    ),
                    "availability_policy": _availability_policy(
                        excluded_same_pet_starts=excluded_same_pet,
                    ),
                }
            return {
                "available": False,
                "closed_days": [],
                "full_days": [],
                "available_times": [],
                "message": (
                    "Não há horários elegíveis no momento: há vagas na grade, mas todos os slots "
                    "já passaram ou começam dentro de 2 horas a partir de agora (horário de Brasília). "
                    "Use availability_policy.excluded_due_to_minimum_notice_or_past para responder "
                    "se o cliente insistir num horário (ex.: 9h)."
                ),
                "availability_policy": _availability_policy(
                    excluded_same_pet_starts=excluded_same_pet,
                ),
            }

        need_consecutive = False
        inferred_svc_row = None
        if _is_uuid(pet_id):
            with get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT size FROM petshop_pets
                    WHERE id = %s AND client_id = %s AND company_id = %s AND is_active = TRUE
                """,
                    (pet_id, client_id, company_id),
                )
                pet_r = cur.fetchone()
            if pet_r and (pet_r.get("size") or "").strip().upper() in ("G", "GG"):
                sid = None
                if service_id is not None:
                    try:
                        sid = int(service_id)
                    except (TypeError, ValueError):
                        sid = None
                if sid is not None:
                    with get_connection() as conn:
                        cur = conn.cursor()
                        cur.execute(
                            """
                            SELECT duration_multiplier_large
                            FROM petshop_services
                            WHERE id = %s AND company_id = %s AND is_active = TRUE
                        """,
                            (sid, company_id),
                        )
                        inferred_svc_row = cur.fetchone()
                else:
                    with get_connection() as conn:
                        cur = conn.cursor()
                        cur.execute(
                            """
                            SELECT id, duration_multiplier_large
                            FROM petshop_services
                            WHERE company_id = %s AND specialty_id = %s AND is_active = TRUE
                              AND duration_multiplier_large IS NOT NULL
                              AND duration_multiplier_large > 1
                        """,
                            (company_id, spec_id),
                        )
                        multi = cur.fetchall()
                    if len(multi) == 1:
                        inferred_svc_row = multi[0]
                if (
                    inferred_svc_row
                    and pet_r
                    and _requires_consecutive_slots(inferred_svc_row, pet_r)
                ):
                    need_consecutive = True

        if need_consecutive:
            ordered = _query_slots_ordered(spec_id, target_date)
            starter_ids = set()
            # starter slot_id -> horário do segundo slot (G/GG + multiplier = dois slots seguidos)
            double_pair_end: dict[str, str] = {}
            for i in range(len(ordered) - 1):
                a, b = ordered[i], ordered[i + 1]
                if a.get("is_blocked") or (
                    a["max_capacity"] - a["used_capacity"]
                ) <= 0:
                    continue
                if b.get("is_blocked") or (
                    b["max_capacity"] - b["used_capacity"]
                ) <= 0:
                    continue
                slot_dt = datetime.combine(parsed_date, a["slot_time"])
                if slot_dt <= now + timedelta(hours=2):
                    continue
                sid_a = str(a["id"])
                starter_ids.add(sid_a)
                double_pair_end[sid_a] = str(b["slot_time"])[:5]
            prev_slots = available_slots
            available_slots = []
            for x in prev_slots:
                if x["slot_id"] not in starter_ids:
                    continue
                pe = double_pair_end.get(x["slot_id"])
                if pe and pe in busy_starts:
                    continue
                if pe:
                    x = {
                        **x,
                        "uses_double_slot": True,
                        "second_slot_time": pe,
                    }
                available_slots.append(x)

        if not available_slots:
            return {
                "available": False,
                "closed_days": [],
                "full_days": [target_date],
                "available_times": [],
                "message": (
                    "Para este pet/serviço é necessário **dois slots seguidos** com vaga; "
                    "não há par disponível hoje respeitando a antecedência mínima de 2h. "
                    "Chame get_available_times noutra data ou ofereça os horários de outro dia."
                ),
                "availability_policy": _availability_policy(
                    "Filtro G/GG + duration_multiplier: sem par consecutivo elegível após regras.",
                    excluded_same_pet_starts=excluded_same_pet,
                ),
            }

        return {
            "available": True,
            "date": target_date,
            "specialty_id_effective": spec_id,
            "closed_days": [],
            "full_days": [],
            "available_times": available_slots,
            "availability_policy": _availability_policy(
                excluded_same_pet_starts=excluded_same_pet,
            ),
            "total_offered_slots": len(available_slots),
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

        with get_connection() as conn:
            cur = conn.cursor()

            # Valida service_id — preço, multiplier G/GG, bloqueio de agendamento pela IA
            cur.execute(
                """
                SELECT ps.id, ps.name, ps.price, ps.price_by_size, ps.duration_multiplier_large, ps.duration_min,
                       ps.block_ai_schedule, dep.name AS dependent_service_name
                FROM petshop_services ps
                LEFT JOIN petshop_services dep ON dep.id = ps.dependent_service_id
                WHERE ps.id = %s AND ps.company_id = %s AND ps.is_active = TRUE
            """,
                (service_id, company_id),
            )
            service_row = cur.fetchone()
            if not service_row:
                return {
                    "success": False,
                    "message": f"Serviço id={service_id} não encontrado. Chame get_services para obter os IDs corretos.",
                }
            if service_row.get("block_ai_schedule"):
                logger.info(
                    "create_appointment recusado | block_ai_schedule | service_id=%s name=%s",
                    service_id,
                    service_row.get("name"),
                )
                return {
                    "success": False,
                    "error_code": ERROR_SERVICE_BLOCKED_FOR_AI,
                    "message": _message_blocked_service_for_ai(
                        service_row["name"],
                        service_row.get("dependent_service_name"),
                    ),
                    "dependent_service_name": service_row.get("dependent_service_name"),
                }

            # Valida pet_id — busca também campos obrigatórios para agendamento
            cur.execute(
                "SELECT id, name, size, species, breed FROM petshop_pets WHERE id = %s AND client_id = %s AND company_id = %s AND is_active = TRUE",
                (pet_id, client_id, company_id),
            )
            pet_row = cur.fetchone()
            if not pet_row:
                return {
                    "success": False,
                    "message": f"Pet id={pet_id} não encontrado. Chame get_client_pets para obter os IDs corretos.",
                }

            # Bloqueia agendamento se o cadastro do pet estiver incompleto
            missing_pet_fields = []
            if not pet_row.get("species"):
                missing_pet_fields.append("espécie (cachorro ou gato)")
            if not pet_row.get("size"):
                missing_pet_fields.append(
                    "porte (pequeno (P), médio (M), grande (G) ou extra grande (GG))"
                )
            if missing_pet_fields:
                return {
                    "success": False,
                    "incomplete_pet": True,
                    "missing_fields": missing_pet_fields,
                    "message": f"Cadastro do pet incompleto. Faltam: {', '.join(missing_pet_fields)}. O cliente deve completar o cadastro antes de agendar.",
                }

            # Verifica vaga no slot
            cur.execute(
                """
                SELECT id, max_capacity, used_capacity, slot_date, slot_time,
                       specialty_id, is_blocked
                FROM petshop_slots
                WHERE id = %s AND company_id = %s
            """,
                (slot_id, company_id),
            )
            slot_row = cur.fetchone()
            if (
                not slot_row
                or (slot_row["max_capacity"] - slot_row["used_capacity"]) <= 0
            ):
                return {
                    "success": False,
                    "error_code": "first_slot_full",
                    "message": "Horário não disponível. Por favor, escolha outro.",
                }

            need_double = _requires_consecutive_slots(service_row, pet_row)
            second_row = None
            if need_double:
                cur.execute(
                    """
                    SELECT id, slot_time, max_capacity, used_capacity, is_blocked
                    FROM petshop_slots
                    WHERE company_id = %s AND specialty_id = %s AND slot_date = %s
                    ORDER BY slot_time
                """,
                    (
                        company_id,
                        slot_row["specialty_id"],
                        slot_row["slot_date"],
                    ),
                )
                day_slots = cur.fetchall()
                ids = [str(r["id"]) for r in day_slots]
                try:
                    idx = ids.index(str(slot_id))
                except ValueError:
                    return {
                        "success": False,
                        "error_code": "invalid_slot",
                        "message": "Horário inválido para esta regra de agendamento.",
                    }
                if idx >= len(day_slots) - 1:
                    logger.info(
                        "create_appointment need_double: sem slot seguinte | slot_id=%s idx=%s n=%s",
                        slot_id,
                        idx,
                        len(day_slots),
                    )
                    return {
                        "success": False,
                        "error_code": "no_consecutive_slot",
                        "message": (
                            "Este serviço exige dois horários seguidos para pets G/GG; "
                            "não há segundo horário após o selecionado."
                        ),
                    }
                second_candidate = day_slots[idx + 1]
                cur.execute(
                    """
                    SELECT id, slot_time, max_capacity, used_capacity, is_blocked
                    FROM petshop_slots
                    WHERE company_id = %s AND id IN (%s, %s)
                    FOR UPDATE
                """,
                    (company_id, slot_id, second_candidate["id"]),
                )
                locked = {str(r["id"]): r for r in cur.fetchall()}
                first_l = locked.get(str(slot_id))
                second_row = locked.get(str(second_candidate["id"]))
                if not first_l or not second_row:
                    return {
                        "success": False,
                        "error_code": "slot_not_found",
                        "message": "Horário não encontrado após validação. Chame get_available_times e tente de novo.",
                    }
                if first_l.get("is_blocked") or (
                    first_l["max_capacity"] - first_l["used_capacity"]
                ) <= 0:
                    return {
                        "success": False,
                        "error_code": "first_slot_full",
                        "message": "Horário inicial sem vaga. Chame get_available_times e escolha outro.",
                    }
                if second_row.get("is_blocked"):
                    logger.info(
                        "create_appointment need_double: segundo slot bloqueado | second=%s",
                        second_row["id"],
                    )
                    return {
                        "success": False,
                        "error_code": "second_slot_blocked",
                        "message": (
                            "O horário seguinte está bloqueado. Escolha outro início "
                            "para pets G/GG."
                        ),
                    }
                if (
                    second_row["max_capacity"] - second_row["used_capacity"]
                ) <= 0:
                    logger.info(
                        "create_appointment need_double: segundo slot lotado | second=%s",
                        second_row["id"],
                    )
                    return {
                        "success": False,
                        "error_code": "second_slot_full",
                        "message": (
                            "O horário seguinte está lotado. Escolha outro início "
                            "para pets G/GG."
                        ),
                    }

            # Calcula preço cobrado: prioriza price_by_size (chaves EN) com porte P/M/G/GG do banco
            price_charged = _resolve_price_charged_from_service_and_pet(service_row, pet_row)

            logger.info(
                "price_charged calculado: %s (pet_size=%s, price_by_size=%s, price_fixo=%s)",
                price_charged,
                pet_row.get("size"),
                service_row.get("price_by_size"),
                service_row["price"],
            )

            # Constrói scheduled_date combinando slot_date + slot_time
            slot_date = slot_row.get("slot_date")
            slot_time_val = slot_row.get("slot_time")
            if slot_date and slot_time_val:
                scheduled_date = datetime.combine(slot_date, slot_time_val)
            else:
                scheduled_date = None

            # Se já houver o mesmo serviço para o mesmo pet no MESMO DIA, trate como provável remarcação.
            # Mantém permitido um segundo banho/serviço igual em OUTRO dia, que é um novo agendamento válido.
            cur.execute(
                """
                SELECT a.id, a.scheduled_date,
                       COALESCE(sl.slot_time, sch.start_time) AS start_time_raw
                FROM petshop_appointments a
                LEFT JOIN petshop_slots sl ON sl.id = a.slot_id
                LEFT JOIN petshop_schedules sch ON sch.id = a.schedule_id
                WHERE a.company_id = %s AND a.client_id = %s
                  AND a.pet_id = %s AND a.service_id = %s
                  AND a.status IN ('pending', 'confirmed')
                  AND a.scheduled_date >= CURRENT_DATE
                  AND a.scheduled_date::date = %s::date
                ORDER BY a.scheduled_date,
                    COALESCE(sl.slot_time, sch.start_time) NULLS LAST
                LIMIT 6
                """,
                (company_id, client_id, pet_id, service_id, slot_row["slot_date"]),
            )
            active_same_day = cur.fetchall()
            if active_same_day:
                primary = str(active_same_day[0]["id"])
                return {
                    "success": False,
                    "error_code": "use_reschedule_instead",
                    "message": (
                        "Esse pet já tem esse serviço marcado nesse dia. "
                        "Pra só mudar horário, use remarcação com o id desse compromisso; "
                        "pra marcar de novo em outro dia, aí sim um agendamento novo."
                    ),
                    "appointment_id_for_reschedule": primary,
                    "active_rows_found": len(active_same_day),
                }

            clash = _pet_conflict_same_slot_start(
                cur,
                company_id,
                pet_id,
                slot_row.get("slot_date"),
                slot_row.get("slot_time"),
                None,
            )
            if clash:
                pn = clash.get("pet_name") or "Esse pet"
                sn = clash["service_name"]
                return {
                    "success": False,
                    "error_code": "pet_same_start_conflict",
                    "message": (
                        f"{pn} já está com «{sn}» nesse horário. "
                        "Sugira outro encaixe ou remarque o que já está na agenda."
                    ),
                }

            second_scheduled = None
            if need_double and second_row:
                second_scheduled = datetime.combine(
                    slot_row["slot_date"],
                    second_row["slot_time"],
                )
                clash2 = _pet_conflict_same_slot_start(
                    cur,
                    company_id,
                    pet_id,
                    slot_row["slot_date"],
                    second_row.get("slot_time"),
                    None,
                )
                if clash2:
                    pn2 = clash2.get("pet_name") or "Esse pet"
                    sn2 = clash2["service_name"]
                    return {
                        "success": False,
                        "error_code": "pet_same_start_conflict",
                        "message": (
                            f"{pn2} já tem «{sn2}» no horário do segundo bloco deste serviço. "
                            "Escolha outro início ou ajuste o agendamento que conflita."
                        ),
                    }

            if not need_double:
                cur.execute(
                    """
                    INSERT INTO petshop_appointments
                        (company_id, client_id, pet_id, service_id, slot_id,
                         scheduled_date, status, confirmed, notes, price_charged)
                    VALUES (%s, %s, %s, %s, %s, %s, 'confirmed', TRUE, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        client_id,
                        pet_id,
                        service_id,
                        slot_id,
                        scheduled_date,
                        notes,
                        price_charged,
                    ),
                )
                appointment_id = cur.fetchone()["id"]
            else:
                cur.execute(
                    """
                    INSERT INTO petshop_appointments
                        (company_id, client_id, pet_id, service_id, slot_id,
                         scheduled_date, status, confirmed, notes, price_charged)
                    VALUES (%s, %s, %s, %s, %s, %s, 'confirmed', TRUE, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        client_id,
                        pet_id,
                        service_id,
                        slot_id,
                        scheduled_date,
                        notes,
                        price_charged,
                    ),
                )
                appointment_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    INSERT INTO petshop_appointments
                        (company_id, client_id, pet_id, service_id, slot_id,
                         scheduled_date, status, confirmed, notes, price_charged)
                    VALUES (%s, %s, %s, %s, %s, %s, 'confirmed', TRUE, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        client_id,
                        pet_id,
                        service_id,
                        second_row["id"],
                        second_scheduled,
                        _merge_notes_with_double_pair(notes, str(appointment_id)),
                        price_charged,
                    ),
                )
                second_aid = cur.fetchone()["id"]

                cur.execute(
                    """
                    UPDATE petshop_appointments
                    SET notes = %s
                    WHERE id = %s
                """,
                    (
                        _merge_notes_with_double_pair(notes, str(second_aid)),
                        str(appointment_id),
                    ),
                )

            cur.execute(
                """
                UPDATE clients
                SET conversation_stage = 'completed', updated_at = NOW()
                WHERE id = %s AND company_id = %s
            """,
                (client_id, company_id),
            )

            eff_dur = _effective_service_duration_minutes(service_row, pet_row)
            start_br = slot_time_to_hhmm(slot_row.get("slot_time"))
            appt_date_iso = _date_iso(slot_row.get("slot_date"))
            pet_nm = (pet_row.get("name") or "").strip() or "Pet"
            svc_nm = (service_row.get("name") or "").strip() or "Serviço"
            success_payload: dict = {
                "success": True,
                "appointment_id": str(appointment_id),
                "message": f"Feito — {pet_nm} ficou com {svc_nm} na agenda.",
                # Sinal explícito para o modelo: não usar vocabulário de remarcação
                "rescheduled": False,
                # Horários canônicos — a mensagem ao cliente DEVE usar estes campos
                "start_time": start_br,
                "uses_double_slot": bool(need_double and second_row),
                # Duração total para este pet (G/GG + multiplicador → já dobrada na prática)
                "service_duration_minutes": eff_dur,
                # Gravado no banco — use na fala ao cliente (evita Lucio na conversa × Thigas no INSERT)
                "pet_name": pet_nm,
                "service_name": svc_nm,
                "appointment_date": appt_date_iso,
                "canonical_summary": (
                    f"{svc_nm} para {pet_nm} no dia {appt_date_iso} às {start_br}"
                    if appt_date_iso
                    else f"{svc_nm} para {pet_nm} às {start_br}"
                ),
            }
            if need_double and second_row:
                sec_br = slot_time_to_hhmm(second_row.get("slot_time"))
                success_payload["second_slot_start"] = sec_br
                end_br = hhmm_after_minutes(start_br, eff_dur)
                success_payload["service_end_time"] = end_br
                success_payload["customer_pickup_hint"] = (
                    f"O serviço ocupa dois horários seguidos: início {start_br}, "
                    f"segundo bloco a partir de {sec_br}; previsão de término ~{end_br} "
                    f"(duração total ~{eff_dur} min para o porte deste pet; "
                    f"para buscar, combine com o petshop — em geral após {end_br})."
                )
            else:
                end_br = hhmm_after_minutes(start_br, eff_dur)
                success_payload["service_end_time"] = end_br
                success_payload["customer_pickup_hint"] = (
                    f"Previsão de término do serviço ~{end_br} "
                    f"(início {start_br}; duração prevista ~{eff_dur} min para este pet)."
                )
            return success_payload

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
                    SELECT id, pet_id, service_id, notes, status, slot_id
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
                if not old.get("slot_id"):
                    return {
                        "success": False,
                        "message": (
                            "Este agendamento não está vinculado a um slot da agenda atual. "
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

                cur.execute(
                    """
                    SELECT id, name, price, price_by_size, duration_multiplier_large, duration_min
                    FROM petshop_services
                    WHERE id = %s AND company_id = %s AND is_active = TRUE
                    """,
                    (service_id, company_id),
                )
                service_row = cur.fetchone()
                if not service_row:
                    return {
                        "success": False,
                        "message": "Serviço do agendamento não está mais ativo.",
                    }

                cur.execute(
                    """
                    SELECT id, name, size, species, breed FROM petshop_pets
                    WHERE id = %s AND client_id = %s AND company_id = %s AND is_active = TRUE
                    """,
                    (pet_id, client_id, company_id),
                )
                pet_row = cur.fetchone()
                if not pet_row:
                    return {
                        "success": False,
                        "message": "Pet não encontrado para este agendamento.",
                    }
                missing_pet_fields = []
                if not pet_row.get("species"):
                    missing_pet_fields.append("espécie (cachorro ou gato)")
                if not pet_row.get("size"):
                    missing_pet_fields.append(
                        "porte (pequeno (P), médio (M), grande (G) ou extra grande (GG))"
                    )
                if missing_pet_fields:
                    return {
                        "success": False,
                        "incomplete_pet": True,
                        "missing_fields": missing_pet_fields,
                        "message": f"Cadastro do pet incompleto. Faltam: {', '.join(missing_pet_fields)}.",
                    }

                cur.execute(
                    """
                    SELECT id, max_capacity, used_capacity, slot_date, slot_time,
                           specialty_id, is_blocked
                    FROM petshop_slots
                    WHERE id = %s AND company_id = %s
                    """,
                    (nid, company_id),
                )
                slot_row = cur.fetchone()
                if (
                    not slot_row
                    or (slot_row["max_capacity"] - slot_row["used_capacity"]) <= 0
                ):
                    return {
                        "success": False,
                        "error_code": "first_slot_full",
                        "message": "Novo horário não está disponível. Chame get_available_times e escolha outro.",
                    }

                need_double = _requires_consecutive_slots(service_row, pet_row)
                second_row = None
                if need_double:
                    cur.execute(
                        """
                        SELECT id, slot_time, max_capacity, used_capacity, is_blocked
                        FROM petshop_slots
                        WHERE company_id = %s AND specialty_id = %s AND slot_date = %s
                        ORDER BY slot_time
                        """,
                        (
                            company_id,
                            slot_row["specialty_id"],
                            slot_row["slot_date"],
                        ),
                    )
                    day_slots = cur.fetchall()
                    ids_list = [str(r["id"]) for r in day_slots]
                    try:
                        idx = ids_list.index(str(nid))
                    except ValueError:
                        return {
                            "success": False,
                            "error_code": "invalid_slot",
                            "message": "Horário inválido para esta regra de agendamento.",
                        }
                    if idx >= len(day_slots) - 1:
                        return {
                            "success": False,
                            "error_code": "no_consecutive_slot",
                            "message": (
                                "Este serviço exige dois horários seguidos para pets G/GG; "
                                "não há segundo horário após o selecionado."
                            ),
                        }
                    second_candidate = day_slots[idx + 1]
                    cur.execute(
                        """
                        SELECT id, slot_time, max_capacity, used_capacity, is_blocked
                        FROM petshop_slots
                        WHERE company_id = %s AND id IN (%s, %s)
                        FOR UPDATE
                        """,
                        (company_id, nid, second_candidate["id"]),
                    )
                    locked = {str(r["id"]): r for r in cur.fetchall()}
                    first_l = locked.get(str(nid))
                    second_row = locked.get(str(second_candidate["id"]))
                    if not first_l or not second_row:
                        return {
                            "success": False,
                            "error_code": "slot_not_found",
                            "message": "Horário não encontrado após validação. Chame get_available_times de novo.",
                        }
                    if first_l.get("is_blocked") or (
                        first_l["max_capacity"] - first_l["used_capacity"]
                    ) <= 0:
                        return {
                            "success": False,
                            "error_code": "first_slot_full",
                            "message": "Horário inicial sem vaga. Escolha outro.",
                        }
                    if second_row.get("is_blocked"):
                        return {
                            "success": False,
                            "error_code": "second_slot_blocked",
                            "message": (
                                "O horário seguinte está bloqueado. Escolha outro início para pets G/GG."
                            ),
                        }
                    if (
                        second_row["max_capacity"] - second_row["used_capacity"]
                    ) <= 0:
                        return {
                            "success": False,
                            "error_code": "second_slot_full",
                            "message": (
                                "O horário seguinte está lotado. Escolha outro início para pets G/GG."
                            ),
                        }

                price_charged = _resolve_price_charged_from_service_and_pet(
                    service_row, pet_row
                )
                slot_date = slot_row.get("slot_date")
                slot_time_val = slot_row.get("slot_time")
                if slot_date and slot_time_val:
                    scheduled_date = datetime.combine(slot_date, slot_time_val)
                else:
                    scheduled_date = None

                clash_r = _pet_conflict_same_slot_start(
                    cur,
                    company_id,
                    pet_id,
                    slot_row.get("slot_date"),
                    slot_row.get("slot_time"),
                    ids_to_cancel_set,
                )
                if clash_r:
                    pr = clash_r.get("pet_name") or "Esse pet"
                    sr = clash_r["service_name"]
                    return {
                        "success": False,
                        "error_code": "pet_same_start_conflict",
                        "message": (
                            f"{pr} já está com «{sr}» nesse horário. "
                            "Ofereça outro horário ou combine remarcar o que já existe."
                        ),
                    }

                second_scheduled_rs = None
                if need_double and second_row:
                    second_scheduled_rs = datetime.combine(
                        slot_row["slot_date"],
                        second_row["slot_time"],
                    )
                    clash_r2p = _pet_conflict_same_slot_start(
                        cur,
                        company_id,
                        pet_id,
                        slot_row["slot_date"],
                        second_row.get("slot_time"),
                        ids_to_cancel_set,
                    )
                    if clash_r2p:
                        pr2 = clash_r2p.get("pet_name") or "Esse pet"
                        sr2 = clash_r2p["service_name"]
                        return {
                            "success": False,
                            "error_code": "pet_same_start_conflict",
                            "message": (
                                f"{pr2} já tem «{sr2}» no segundo bloco desse horário. "
                                "Escolha outro início ou ajuste o agendamento que conflita."
                            ),
                        }

                for cid in ids_to_cancel:
                    cur.execute(
                        """
                        UPDATE petshop_appointments
                        SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = %s
                        WHERE id = %s AND company_id = %s AND client_id = %s
                          AND status NOT IN ('completed', 'cancelled')
                        """,
                        (cancel_note, cid, company_id, client_id),
                    )

                if not need_double:
                    cur.execute(
                        """
                        INSERT INTO petshop_appointments
                            (company_id, client_id, pet_id, service_id, slot_id,
                             scheduled_date, status, confirmed, notes, price_charged)
                        VALUES (%s, %s, %s, %s, %s, %s, 'confirmed', TRUE, %s, %s)
                        RETURNING id
                        """,
                        (
                            company_id,
                            client_id,
                            pet_id,
                            service_id,
                            nid,
                            scheduled_date,
                            user_notes,
                            price_charged,
                        ),
                    )
                    new_appointment_id = cur.fetchone()["id"]
                else:
                    cur.execute(
                        """
                        INSERT INTO petshop_appointments
                            (company_id, client_id, pet_id, service_id, slot_id,
                             scheduled_date, status, confirmed, notes, price_charged)
                        VALUES (%s, %s, %s, %s, %s, %s, 'confirmed', TRUE, %s, %s)
                        RETURNING id
                        """,
                        (
                            company_id,
                            client_id,
                            pet_id,
                            service_id,
                            nid,
                            scheduled_date,
                            user_notes,
                            price_charged,
                        ),
                    )
                    new_appointment_id = cur.fetchone()["id"]

                    cur.execute(
                        """
                        INSERT INTO petshop_appointments
                            (company_id, client_id, pet_id, service_id, slot_id,
                             scheduled_date, status, confirmed, notes, price_charged)
                        VALUES (%s, %s, %s, %s, %s, %s, 'confirmed', TRUE, %s, %s)
                        RETURNING id
                        """,
                        (
                            company_id,
                            client_id,
                            pet_id,
                            service_id,
                            second_row["id"],
                            second_scheduled_rs,
                            _merge_notes_with_double_pair(
                                user_notes, str(new_appointment_id)
                            ),
                            price_charged,
                        ),
                    )
                    second_aid = cur.fetchone()["id"]

                    cur.execute(
                        """
                        UPDATE petshop_appointments
                        SET notes = %s
                        WHERE id = %s
                        """,
                        (
                            _merge_notes_with_double_pair(
                                user_notes, str(second_aid)
                            ),
                            str(new_appointment_id),
                        ),
                    )

                cur.execute(
                    """
                    UPDATE clients
                    SET conversation_stage = 'completed', updated_at = NOW()
                    WHERE id = %s AND company_id = %s
                    """,
                    (client_id, company_id),
                )

                eff_dur = _effective_service_duration_minutes(service_row, pet_row)
                start_br = slot_time_to_hhmm(slot_row.get("slot_time"))
                appt_date_rs = _date_iso(slot_row.get("slot_date"))
                pet_nmr = (pet_row.get("name") or "").strip() or "Pet"
                svc_nmr = (service_row.get("name") or "").strip() or "Serviço"
                payload: dict = {
                    "success": True,
                    "rescheduled": True,
                    "previous_appointment_ids": ids_to_cancel,
                    "appointment_id": str(new_appointment_id),
                    "message": f"Pronto — atualizei o horário do {pet_nmr} ({svc_nmr}).",
                    "start_time": start_br,
                    "uses_double_slot": bool(need_double and second_row),
                    "service_duration_minutes": eff_dur,
                    "pet_name": pet_nmr,
                    "service_name": svc_nmr,
                    "appointment_date": appt_date_rs,
                    "canonical_summary": (
                        f"{svc_nmr} para {pet_nmr} no dia {appt_date_rs} às {start_br}"
                        if appt_date_rs
                        else f"{svc_nmr} para {pet_nmr} às {start_br}"
                    ),
                }
                if need_double and second_row:
                    sec_br = slot_time_to_hhmm(second_row.get("slot_time"))
                    payload["second_slot_start"] = sec_br
                    end_br = hhmm_after_minutes(start_br, eff_dur)
                    payload["service_end_time"] = end_br
                    payload["customer_pickup_hint"] = (
                        f"O serviço ocupa dois horários seguidos: início {start_br}, "
                        f"segundo bloco a partir de {sec_br}; previsão de término ~{end_br} "
                        f"(duração total ~{eff_dur} min para o porte deste pet; "
                        f"para buscar, combine com o petshop — em geral após {end_br})."
                    )
                else:
                    end_br = hhmm_after_minutes(start_br, eff_dur)
                    payload["service_end_time"] = end_br
                    payload["customer_pickup_hint"] = (
                        f"Previsão de término do serviço ~{end_br} "
                        f"(início {start_br}; duração prevista ~{eff_dur} min para este pet)."
                    )
                return payload
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
                SELECT id, notes, status
                FROM petshop_appointments
                WHERE id = %s AND company_id = %s AND client_id = %s
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
                "message": "Agendamento não encontrado ou já finalizado.",
            }
        return {
            "success": True,
            "message": "Cancelado. Se quiser remarcar, é só avisar.",
        }

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
