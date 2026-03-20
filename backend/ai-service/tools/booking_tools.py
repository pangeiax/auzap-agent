import logging
import os
import re
import urllib.request
import json
from datetime import date, datetime, timedelta, timezone
from db import get_connection
from tools.slot_time_utils import hhmm_after_minutes, slot_time_to_hhmm

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _is_uuid(val) -> bool:
    return bool(val and _UUID_RE.match(str(val)))

# Fuso horário de Brasília (UTC-3) — usado para filtrar horários do dia
BRASILIA = timezone(timedelta(hours=-3))

# URL interna do backend Node (Docker network)
BACKEND_INTERNAL_URL = os.getenv("BACKEND_INTERNAL_URL", "http://backend:3000")

logger = logging.getLogger("ai-service.tools.booking")

DOUBLE_PAIR_PREFIX = "__DOUBLE_PAIR__:"


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
        Retorna lista de serviços ativos do petshop.
        Chamar em silêncio para validar o serviço antes de pedir dados do pet.
        """
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id, name, description, duration_min, price, price_by_size, duration_multiplier_large, specialty_id
                FROM petshop_services
                WHERE company_id = %s AND is_active = TRUE
                ORDER BY name
            """,
                (company_id,),
            )
            services = cur.fetchall()
        return {"services": [dict(s) for s in services], "count": len(services)}

    def _try_generate_slots() -> bool:
        """Tenta gerar slots via endpoint interno. Retorna True se bem-sucedido."""
        try:
            url = f"{BACKEND_INTERNAL_URL}/internal/generate-slots"
            payload = json.dumps({"company_id": company_id, "days": 60}).encode()
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
        pet_id: str = None,
    ) -> dict:
        """
        Retorna horários disponíveis para uma especialidade em uma data específica.
        Chamar SEMPRE que o cliente mencionar uma data — nunca inventar horários.

        Args:
            specialty_id: UUID da especialidade (get_specialties ou coluna specialty_id do serviço no contexto).
                Se vier errado (ex.: número), ainda assim passe **service_id** — o sistema resolve a especialidade pelo serviço.
            target_date: Data no formato YYYY-MM-DD
            service_id: ID numérico do serviço (get_services) — obrigatório para G/GG com duração dobrada; também corrige specialty_id inválido
            pet_id: UUID do pet — use junto com service_id para aplicar a regra de dois slots consecutivos
        """
        try:
            parsed_date = date.fromisoformat(target_date)
        except ValueError:
            return {
                "available": False,
                "message": "Data inválida. Use o formato YYYY-MM-DD.",
            }

        # Data "hoje" em Brasília — evita desvio se o servidor estiver em UTC
        today = datetime.now(BRASILIA).date()
        if parsed_date < today:
            return {
                "available": False,
                "message": "Não é possível agendar em datas passadas.",
            }
        if parsed_date > today + timedelta(days=60):
            return {
                "available": False,
                "message": "Só é possível agendar com até 60 dias de antecedência.",
                "beyond_limit": True,
            }

        now = datetime.now(BRASILIA).replace(tzinfo=None)

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

        def _availability_policy(extra: str | None = None) -> dict:
            pol = {
                "timezone": "America/Sao_Paulo",
                "minimum_hours_ahead_of_start": 2,
                "reference_now_local": now.strftime("%Y-%m-%d %H:%M"),
                "data_source": "vw_slot_availability",
                "specialty_id": spec_id,
                "slots_with_capacity_before_filter": len(slots),
                "excluded_due_to_minimum_notice_or_past": sorted(set(excluded_lead)),
                "note": (
                    "A view já filtra por especialidade ativa, slot não bloqueado e vaga. "
                    "Aqui só entram em available_times horários com início > agora + 2h (Brasília). "
                    "Se o cliente perguntar por um horário listado em excluded_..., explique: "
                    "já passou ou não cumpre a antecedência mínima — não invente outro motivo."
                ),
            }
            if extra:
                pol["situation"] = extra
            return pol

        count_after_lead_time = len(available_slots)

        if not available_slots:
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
                "availability_policy": _availability_policy(),
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
                    "Filtro G/GG + duration_multiplier: sem par consecutivo elegível após regras."
                ),
            }

        return {
            "available": True,
            "date": target_date,
            "specialty_id_effective": spec_id,
            "closed_days": [],
            "full_days": [],
            "available_times": available_slots,
            "availability_policy": _availability_policy(),
            "total_offered_slots": len(available_slots),
        }

    def create_appointment(
        pet_id: str,
        service_id: int,
        slot_id: str,
        confirmed: bool = False,
        notes: str = None,
    ) -> dict:
        """
        Cria um agendamento. Exige confirmed=True — nunca criar sem confirmação explícita do cliente.

        Args:
            pet_id: ID do pet (obtido via get_client_pets)
            service_id: ID do serviço (obtido via get_services)
            slot_id: ID do slot (obtido via get_available_times)
            confirmed: Deve ser True — só confirmar após aceite explícito do cliente
            notes: Observações opcionais
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

        # service_id é integer no banco
        try:
            service_id = int(service_id)
        except (ValueError, TypeError):
            return {
                "success": False,
                "message": "service_id deve ser um número inteiro válido.",
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

            # Valida service_id — busca preço fixo, preço por porte e multiplier G/GG
            cur.execute(
                """
                SELECT id, price, price_by_size, duration_multiplier_large, duration_min
                FROM petshop_services
                WHERE id = %s AND company_id = %s AND is_active = TRUE
            """,
                (service_id, company_id),
            )
            service_row = cur.fetchone()
            if not service_row:
                return {
                    "success": False,
                    "message": f"Serviço id={service_id} não encontrado. Chame get_services para obter os IDs corretos.",
                }

            # Valida pet_id — busca também campos obrigatórios para agendamento
            cur.execute(
                "SELECT id, size, species, breed FROM petshop_pets WHERE id = %s AND client_id = %s AND company_id = %s AND is_active = TRUE",
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

                second_scheduled = datetime.combine(
                    slot_row["slot_date"],
                    second_row["slot_time"],
                )

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

            dur = int(service_row.get("duration_min") or 60)
            start_br = slot_time_to_hhmm(slot_row.get("slot_time"))
            success_payload: dict = {
                "success": True,
                "appointment_id": str(appointment_id),
                "message": "Agendamento confirmado com sucesso!",
                # Horários canônicos — a mensagem ao cliente DEVE usar estes campos
                "start_time": start_br,
                "uses_double_slot": bool(need_double and second_row),
            }
            if need_double and second_row:
                sec_br = slot_time_to_hhmm(second_row.get("slot_time"))
                success_payload["second_slot_start"] = sec_br
                end_br = hhmm_after_minutes(sec_br, dur)
                success_payload["service_end_time"] = end_br
                success_payload["customer_pickup_hint"] = (
                    f"O serviço ocupa dois horários seguidos: início {start_br}, "
                    f"segundo bloco a partir de {sec_br}; previsão de término ~{end_br} "
                    f"(para buscar o pet, combine com o petshop — em geral após {end_br})."
                )
            else:
                end_br = hhmm_after_minutes(start_br, dur)
                success_payload["service_end_time"] = end_br
                success_payload["customer_pickup_hint"] = (
                    f"Previsão de término do serviço ~{end_br} "
                    f"(início {start_br}; duração base {dur} min)."
                )
            return success_payload

    def cancel_appointment(appointment_id: str, reason: str = None) -> dict:
        """
        Cancela um agendamento existente do cliente.
        used_capacity dos slots é atualizado por triggers no banco (sem UPDATE manual).

        Args:
            appointment_id: ID do agendamento a cancelar
            reason: Motivo do cancelamento (opcional)
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
        return {"success": True, "message": "Agendamento cancelado com sucesso."}

    return [
        get_specialties,
        get_services,
        get_available_times,
        create_appointment,
        cancel_appointment,
    ]


def fetch_available_times_snapshot(
    company_id: int,
    client_id: str,
    specialty_id: str,
    target_date: str,
    service_id=None,
    pet_id: str | None = None,
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
    )
