import json
import logging
import re
from datetime import date, timedelta

from db import get_connection
from timezone_br import today_sao_paulo

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _is_uuid(val) -> bool:
    return bool(val and _UUID_RE.match(str(val)))

logger = logging.getLogger("ai-service.tools.lodging")

# Busca de próxima vaga / mensagens ao cliente — alinhado ao horizonte da agenda (slots).
MAX_LODGING_AVAILABILITY_SEARCH_DAYS = 90


def _time_to_hhmm(val) -> str | None:
    """Normaliza TIME do Postgres para HH:MM."""
    if val is None:
        return None
    if hasattr(val, "strftime"):
        return val.strftime("%H:%M")
    s = str(val).strip()
    return s[:5] if len(s) >= 5 else s


def _last_use_day(checkin: date, checkout: date) -> date:
    """Último dia civil de uso (checkout no banco é fim exclusivo). Nunca persistir isto em checkout_date."""
    return checkout - timedelta(days=1)


def build_lodging_tools(company_id: int, client_id, lodging_type: str = "hotel") -> list:
    """Tools do agente de hospedagem."""

    def get_kennel_availability(checkin_date: str, checkout_date: str) -> dict:
        """
        Verifica vagas disponíveis no período de hospedagem.
        Retorna opções por tipo de quarto (preços em `room_type_options`, com descrição/features por item).
        **Preço:** em cada opção, `daily_rate` e `total_amount` / `total_amount_one_pet_stay` referem-se a **um pet**
        no período (total = diária × `days`). Para mais de um pet, em geral multiplique por quantos pets terão
        reserva separada — **salvo** se `description`/`features` desse tipo disser outra regra (pacote, desconto,
        “falar com especialista”, etc.); nesse caso siga o texto cadastrado, não invente conta.
        Em sucesso, inclui `standard_checkin_time` e `standard_checkout_time` (horários padrão do cadastro).
        O campo `message` já menciona esses horários para hotel e creche.
        Chamar SEMPRE que o cliente mencionar datas de check-in/check-out.
        """
        try:
            checkin = date.fromisoformat(checkin_date)
            checkout = date.fromisoformat(checkout_date)
        except ValueError:
            return {"success": False, "message": "Datas inválidas. Use o formato YYYY-MM-DD."}

        if checkout <= checkin:
            return {"success": False, "message": "Data de saída deve ser posterior à entrada."}

        if checkin < today_sao_paulo():
            return {"success": False, "message": "Data de check-in não pode ser no passado."}

        days = (checkout - checkin).days
        service_name = "Hotel" if lodging_type == "hotel" else "Creche"

        with get_connection() as conn:
            cur = conn.cursor()

            # Busca config (enabled + taxa global de fallback)
            cur.execute(
                """
                SELECT hotel_enabled, daycare_enabled,
                       hotel_daily_rate, daycare_daily_rate,
                       hotel_checkin_time, hotel_checkout_time,
                       daycare_checkin_time, daycare_checkout_time
                FROM petshop_lodging_config
                WHERE company_id = %s
            """,
                (company_id,),
            )
            cfg = cur.fetchone()
            enabled = (cfg["hotel_enabled"] if lodging_type == "hotel" else cfg["daycare_enabled"]) if cfg else None
            if not cfg or not enabled:
                return {"success": False, "message": f"{service_name} não está disponível no momento."}

            rate_key = "hotel_daily_rate" if lodging_type == "hotel" else "daycare_daily_rate"
            global_daily_rate = float(cfg[rate_key]) if cfg[rate_key] else None
            hotel_checkin = _time_to_hhmm(cfg.get("hotel_checkin_time"))
            hotel_checkout = _time_to_hhmm(cfg.get("hotel_checkout_time"))
            daycare_dropoff = _time_to_hhmm(cfg.get("daycare_checkin_time"))
            daycare_pickup = _time_to_hhmm(cfg.get("daycare_checkout_time"))

            # ── Verifica tipos de quarto configurados ────────────────────────────
            cur.execute(
                """
                SELECT
                    room_type_id,
                    room_type_name,
                    daily_rate,
                    total_capacity,
                    MIN(available_capacity) AS min_vagas
                FROM vw_room_type_availability
                WHERE company_id   = %s
                  AND lodging_type = %s
                  AND check_date BETWEEN %s AND (%s::date - INTERVAL '1 day')
                GROUP BY room_type_id, room_type_name, daily_rate, total_capacity
                ORDER BY daily_rate ASC
                """,
                (company_id, lodging_type, checkin_date, checkout_date),
            )
            room_type_rows = cur.fetchall()

            if not room_type_rows:
                # Sem tipos de quarto configurados — petshop precisa configurar
                return {
                    "success": False,
                    "message": (
                        f"{service_name} não possui tipos de quarto configurados. "
                        "O petshop precisa configurar os tipos de quarto antes de aceitar reservas."
                    ),
                }

            # ── Busca descrições e features dos tipos de quarto ──────────────────
            room_type_ids = [str(r["room_type_id"]) for r in room_type_rows]
            cur.execute(
                """
                SELECT id::text, description, features
                FROM petshop_room_types
                WHERE id = ANY(%s::uuid[])
                """,
                (room_type_ids,),
            )
            rt_details = {row["id"]: row for row in cur.fetchall()}

            # ── Filtra opções com vagas no período ───────────────────────────────
            available_options = []
            for r in room_type_rows:
                if r["min_vagas"] is None or int(r["min_vagas"]) <= 0:
                    continue
                det = rt_details.get(str(r["room_type_id"]), {}) or {}
                feats = det.get("features")
                rate = float(r["daily_rate"])
                total_one = round(rate * days, 2)
                opt = {
                    "room_type_id": str(r["room_type_id"]),
                    "name": r["room_type_name"],
                    "description": det.get("description") or None,
                    "daily_rate": rate,
                    # Sempre 1 pet × período: diária × quantidade de diárias cobradas (`days`).
                    "total_amount": total_one,
                    "total_amount_one_pet_stay": total_one,
                }
                if feats not in (None, {}, []):
                    opt["features"] = feats
                available_options.append(opt)

            if not available_options:
                # Todos os tipos estão lotados — busca próxima data disponível
                nearest_checkin, nearest_checkout = _find_next_available_with_room_types(
                    cur, company_id, lodging_type, checkin, checkout, days
                )
                if nearest_checkin:
                    return {
                        "success": False,
                        "available": False,
                        "days": days,
                        "nearest_available": {
                            "checkin_date": str(nearest_checkin),
                            "checkout_date": str(nearest_checkout),
                            "days": days,
                        },
                        "message": (
                            f"Sem vagas de nenhum tipo no período solicitado. "
                            f"Próxima disponibilidade: {nearest_checkin.strftime('%d/%m/%Y')} "
                            f"a {nearest_checkout.strftime('%d/%m/%Y')}. Ofereça ao cliente."
                        ),
                    }
                return {
                    "success": False,
                    "available": False,
                    "days": days,
                    "message": (
                        f"Sem vagas nos próximos {MAX_LODGING_AVAILABILITY_SEARCH_DAYS} dias. "
                        "Informe o cliente e peça novas datas."
                    ),
                }

            # ── Há vagas — monta resposta com opções ─────────────────────────────
            def _fmt_option(opt: dict) -> str:
                """Lista curta na `message`; descrição/features ficam em `room_type_options` (evita repetir blocos longos)."""
                return (
                    f"• {opt['name']}: R${opt['daily_rate']:.2f}/diária "
                    f"(total para 1 pet no período: R${opt['total_amount']:.2f} "
                    f"= {days} diária(s) × R${opt['daily_rate']:.2f})"
                )

            options_text = "\n".join(_fmt_option(opt) for opt in available_options)
            pricing_footer = (
                f"\n\nPreço: cada total acima é para um pet no período ({days} diária(s)). "
                "Para vários pets (cada um com reserva própria), em geral multiplique esse total pela quantidade de pets, "
                "exceto se a descrição/features do tipo de quarto disser outra condição — aí siga o cadastro."
            )

            last_day = _last_use_day(checkin, checkout)
            if lodging_type == "daycare":
                pickup = daycare_pickup or "horário da loja"
                dropoff = daycare_dropoff or "horário da loja"
                date_info = (
                    f"dia {checkin.strftime('%d/%m/%Y')}"
                    if last_day == checkin
                    else f"{checkin.strftime('%d/%m/%Y')} a {last_day.strftime('%d/%m/%Y')}"
                )
                msg = (
                    f"Temos vagas na creche para {date_info} ({days} diária(s)). "
                    f"Entrada a partir de {dropoff}, retirada até {pickup}. "
                    f"Opções disponíveis:\n{options_text}{pricing_footer}\n"
                    f"Qual tipo o cliente prefere?"
                )
            else:
                cin_h = hotel_checkin or "consulte a loja"
                cout_h = hotel_checkout or "consulte a loja"
                msg = (
                    f"Temos vagas no hotel de {checkin_date} a {checkout_date} ({days} dia(s)). "
                    f"Check-in padrão a partir de {cin_h}, check-out até {cout_h}. "
                    f"Opções disponíveis:\n{options_text}{pricing_footer}\n"
                    f"Qual tipo o cliente prefere?"
                )

            return {
                "success": True,
                "available": True,
                "days": days,
                "checkin_date": checkin_date,
                "checkout_date": checkout_date,
                "room_type_options": available_options,
                "pricing_note": {
                    "totals_are_for_one_pet": True,
                    "billing_nights": days,
                    "per_pet_reservation": True,
                },
                "message": msg,
                **(
                    {
                        "last_day_client": str(last_day),
                        "pickup_time_hint": daycare_pickup,
                        "standard_checkin_time": daycare_dropoff,
                        "standard_checkout_time": daycare_pickup,
                    }
                    if lodging_type == "daycare"
                    else {
                        "standard_checkin_time": hotel_checkin,
                        "standard_checkout_time": hotel_checkout,
                    }
                ),
            }

    def create_lodging(
        pet_id: str,
        checkin_date: str,
        checkout_date: str,
        room_type_id: str = None,
        daily_rate: float = None,
        care_notes: dict = None,
        confirmed: bool = False,
    ) -> dict:
        """
        Cria uma reserva de hospedagem. Exige confirmed=True — nunca criar sem confirmação explícita do cliente.

        Args:
            pet_id:        ID do pet (obtido via get_client_pets)
            checkin_date:  Data de entrada YYYY-MM-DD
            checkout_date: Data de saída YYYY-MM-DD
            room_type_id:  ID do tipo de quarto escolhido pelo cliente (obtido via get_kennel_availability)
                           Obrigatório quando o petshop possui tipos de quarto configurados.
            daily_rate:    Valor diário — opcional; usa a taxa do tipo de quarto se não informado
            care_notes:    Instruções de cuidado — opcional
            confirmed:     Deve ser True — só confirmar após aceite explícito do cliente
        """
        if not confirmed:
            return {"success": False, "message": "Aguardando confirmação explícita do cliente antes de criar a hospedagem."}

        if not client_id:
            return {"success": False, "message": "Cliente não identificado."}

        if not _is_uuid(pet_id):
            return {
                "success": False,
                "message": (
                    f"pet_id inválido: '{pet_id}' não é um UUID. "
                    "Chame get_client_pets para obter o ID correto do pet antes de criar a hospedagem."
                ),
            }

        try:
            checkin = date.fromisoformat(checkin_date)
            checkout = date.fromisoformat(checkout_date)
        except ValueError:
            return {"success": False, "message": "Datas inválidas. Use o formato YYYY-MM-DD."}

        if checkout <= checkin:
            return {"success": False, "message": "Data de saída deve ser posterior à data de entrada."}

        if checkin < today_sao_paulo():
            return {"success": False, "message": "Data de check-in não pode ser no passado."}

        days = (checkout - checkin).days
        service_name = "Hotel" if lodging_type == "hotel" else "Creche"

        with get_connection() as conn:
            cur = conn.cursor()

            # Verifica config
            cur.execute(
                """
                SELECT hotel_enabled, daycare_enabled,
                       hotel_daily_rate, daycare_daily_rate,
                       daycare_checkout_time
                FROM petshop_lodging_config
                WHERE company_id = %s
                """,
                (company_id,),
            )
            config = cur.fetchone()
            enabled = (
                (config["hotel_enabled"] if lodging_type == "hotel" else config["daycare_enabled"])
                if config else None
            )
            if not config or not enabled:
                return {"success": False, "message": f"{service_name} não está disponível no momento."}

            daycare_pickup = _time_to_hhmm(config.get("daycare_checkout_time"))
            rate_key = "hotel_daily_rate" if lodging_type == "hotel" else "daycare_daily_rate"
            effective_rate = daily_rate

            # Resolve taxa via tipo de quarto
            resolved_room_type_id = None
            room_type_name = None

            if room_type_id:
                if not _is_uuid(room_type_id):
                    return {
                        "success": False,
                        "message": (
                            f"room_type_id inválido: '{room_type_id}' não é um UUID. "
                            "Use o room_type_id retornado por get_kennel_availability."
                        ),
                    }
                cur.execute(
                    """
                    SELECT id, name, capacity, daily_rate, is_active, lodging_type
                    FROM petshop_room_types
                    WHERE id = %s AND company_id = %s
                    """,
                    (room_type_id, company_id),
                )
                rt = cur.fetchone()
                if not rt:
                    return {"success": False, "message": "Tipo de quarto não encontrado."}
                if not rt["is_active"]:
                    return {"success": False, "message": f"O tipo de quarto '{rt['name']}' está inativo."}
                if rt["lodging_type"] != lodging_type:
                    return {"success": False, "message": f"Tipo de quarto '{rt['name']}' não é para {service_name}."}

                resolved_room_type_id = str(rt["id"])
                room_type_name = rt["name"]
                if effective_rate is None:
                    effective_rate = float(rt["daily_rate"])

            else:
                # Sem room_type_id: usa taxa global como fallback
                if effective_rate is None and config[rate_key]:
                    effective_rate = float(config[rate_key])

            # Verifica pet
            cur.execute(
                "SELECT id, name FROM petshop_pets WHERE id = %s AND client_id = %s AND company_id = %s AND is_active = TRUE",
                (pet_id, client_id, company_id),
            )
            pet = cur.fetchone()
            if not pet:
                return {"success": False, "message": "Pet não encontrado. Use get_client_pets para obter os IDs corretos."}

            total_amount = round(float(effective_rate) * days, 2) if effective_rate else None

            cur.execute(
                """
                INSERT INTO petshop_lodging_reservations
                    (company_id, client_id, pet_id, type, room_type_id,
                     checkin_date, checkout_date,
                     daily_rate, total_amount, care_notes, status, confirmed)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'confirmed', TRUE)
                RETURNING id
                """,
                (
                    company_id, client_id, pet_id, lodging_type,
                    resolved_room_type_id,
                    checkin_date, checkout_date,
                    effective_rate, total_amount,
                    json.dumps(care_notes or {}),
                ),
            )
            lodging_id = cur.fetchone()["id"]

            cur.execute(
                "UPDATE clients SET conversation_stage = 'completed', updated_at = NOW() WHERE id = %s AND company_id = %s",
                (client_id, company_id),
            )

        pickup_phrase = daycare_pickup or "horário da loja"
        last_day = _last_use_day(checkin, checkout)
        type_label = f" ({room_type_name})" if room_type_name else ""

        if lodging_type == "daycare":
            if last_day == checkin:
                confirm_msg = (
                    f"Creche{type_label} confirmada para o dia {checkin.strftime('%d/%m/%Y')} (1 diária). "
                    f"Retirada no mesmo dia até {pickup_phrase}."
                )
            else:
                confirm_msg = (
                    f"Creche{type_label} confirmada de {checkin.strftime('%d/%m/%Y')} a {last_day.strftime('%d/%m/%Y')} "
                    f"({days} diárias). Retirada no último dia ({last_day.strftime('%d/%m/%Y')}) até {pickup_phrase}."
                )
            return {
                "success": True, "lodging_id": str(lodging_id),
                "days": days, "total_amount": total_amount, "message": confirm_msg,
                "checkin_date": checkin_date, "checkout_date": checkout_date,
                "last_day_client": str(last_day), "pickup_time_hint": daycare_pickup,
            }

        confirm_msg = (
            f"Hospedagem{type_label} confirmada! "
            f"Check-in {checkin_date}, check-out {checkout_date} ({days} dias)."
        )
        return {
            "success": True, "lodging_id": str(lodging_id),
            "days": days, "total_amount": total_amount, "message": confirm_msg,
        }

    def cancel_lodging(lodging_id: str, reason: str = None) -> dict:
        """
        Cancela uma hospedagem existente.

        Args:
            lodging_id: ID da hospedagem
            reason: Motivo do cancelamento (opcional)
        """
        if not lodging_id:
            return {"success": False, "message": "lodging_id é obrigatório."}

        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                UPDATE petshop_lodging_reservations
                SET status = 'cancelled', updated_at = NOW()
                WHERE id = %s AND company_id = %s AND client_id = %s
                  AND status NOT IN ('checked_out', 'cancelled')
                RETURNING id
                """,
                (lodging_id, company_id, client_id),
            )
            updated = cur.fetchone()

        if not updated:
            return {"success": False, "message": "Hospedagem não encontrada ou já finalizada."}
        return {"success": True, "message": "Hospedagem cancelada com sucesso."}

    def get_lodging_status(lodging_id: str = None) -> dict:
        """
        Retorna status da hospedagem ativa do cliente.

        Args:
            lodging_id: ID específico da hospedagem (opcional — se não informado, retorna a mais recente ativa)
        """
        with get_connection() as conn:
            cur = conn.cursor()
            if lodging_id:
                cur.execute(
                    """
                    SELECT l.id, l.kennel_id, l.checkin_date, l.checkout_date, l.status,
                           l.total_amount, p.name AS pet_name,
                           rt.name AS room_type_name, l.daily_rate
                    FROM petshop_lodging_reservations l
                    JOIN petshop_pets p ON p.id = l.pet_id
                    LEFT JOIN petshop_room_types rt ON rt.id = l.room_type_id
                    WHERE l.id = %s AND l.company_id = %s AND l.client_id = %s
                    """,
                    (lodging_id, company_id, client_id),
                )
            else:
                cur.execute(
                    """
                    SELECT l.id, l.kennel_id, l.checkin_date, l.checkout_date, l.status,
                           l.total_amount, p.name AS pet_name,
                           rt.name AS room_type_name, l.daily_rate
                    FROM petshop_lodging_reservations l
                    JOIN petshop_pets p ON p.id = l.pet_id
                    LEFT JOIN petshop_room_types rt ON rt.id = l.room_type_id
                    WHERE l.company_id = %s AND l.client_id = %s
                      AND l.status NOT IN ('cancelled', 'checked_out')
                    ORDER BY l.checkin_date DESC
                    LIMIT 1
                    """,
                    (company_id, client_id),
                )
            row = cur.fetchone()

        if not row:
            return {"found": False, "message": "Nenhuma hospedagem ativa encontrada."}
        return {"found": True, **dict(row)}

    def get_room_types_info(lodging_type_filter: str = None) -> dict:
        """
        Retorna dados cadastrados pelo petshop para cada tipo de quarto/espaço
        (nome, descrição, diária, features).

        Chamar quando o cliente perguntar sobre:
        - Quais tipos de quarto/espaços existem
        - Como funciona o hotel ou a creche
        - Detalhes de um tipo específico (conforme o que estiver em description/features)
        - Preços sem especificar datas
        - Diferenças entre as opções disponíveis

        Args:
            lodging_type_filter: 'hotel' | 'daycare' | None (retorna ambos se None)
        """
        with get_connection() as conn:
            cur = conn.cursor()

            query = """
                SELECT id::text, lodging_type, name, description, daily_rate, features, is_active
                FROM petshop_room_types
                WHERE company_id = %s AND is_active = TRUE
            """
            params = [company_id]

            effective_filter = lodging_type_filter or lodging_type
            if effective_filter in ("hotel", "daycare"):
                query += " AND lodging_type = %s"
                params.append(effective_filter)

            query += " ORDER BY daily_rate ASC"
            cur.execute(query, params)
            rows = cur.fetchall()

        if not rows:
            service = "Hotel" if effective_filter == "hotel" else ("Creche" if effective_filter == "daycare" else "Hospedagem")
            return {
                "success": False,
                "message": f"{service} não possui tipos de quarto/espaço configurados no momento.",
            }

        result = []
        for r in rows:
            entry = {
                "id": r["id"],
                "lodging_type": r["lodging_type"],
                "name": r["name"],
                "daily_rate": float(r["daily_rate"]),
            }
            if r["description"]:
                entry["description"] = r["description"]
            if r["features"]:
                entry["features"] = r["features"]
            result.append(entry)

        # Texto resumido para o agente usar na conversa
        lines = []
        for entry in result:
            label = "Hotel" if entry["lodging_type"] == "hotel" else "Creche"
            line = f"[{label}] {entry['name']} — R${entry['daily_rate']:.2f}/dia"
            if entry.get("description"):
                line += f"\nDescrição:\n{entry['description']}"
            lines.append(line)

        return {
            "success": True,
            "room_types": result,
            "summary": "\n\n".join(lines),
            "message": (
                "Dados do cadastro do petshop por tipo. Explique ao cliente com suas palavras quando quiser, "
                "mantendo fidelidade ao conteúdo de description/features e aos valores; não invente fora disso.\n\n"
                + "\n\n".join(lines)
            ),
        }

    return [get_kennel_availability, create_lodging, cancel_lodging, get_lodging_status, get_room_types_info]


# ── Helper interno ─────────────────────────────────────────────────────────────

def _find_next_available_with_room_types(cur, company_id, lodging_type, checkin, checkout, days):
    """Busca o próximo período disponível (qualquer tipo de quarto) dentro do horizonte configurado."""
    for offset in range(1, MAX_LODGING_AVAILABILITY_SEARCH_DAYS + 1):
        candidate_in = checkin + timedelta(days=offset)
        candidate_out = candidate_in + timedelta(days=days)
        cur.execute(
            """
            SELECT COUNT(*) AS available_types
            FROM (
                SELECT room_type_id
                FROM vw_room_type_availability
                WHERE company_id   = %s
                  AND lodging_type = %s
                  AND check_date BETWEEN %s AND (%s::date - INTERVAL '1 day')
                GROUP BY room_type_id, room_type_name, daily_rate, total_capacity
                HAVING MIN(available_capacity) > 0
            ) sub
            """,
            (company_id, lodging_type, str(candidate_in), str(candidate_out)),
        )
        r = cur.fetchone()
        if r and int(r["available_types"]) > 0:
            return candidate_in, candidate_out
    return None, None
