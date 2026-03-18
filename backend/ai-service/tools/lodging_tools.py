import json
import logging
import re
from datetime import date, timedelta
from db import get_connection

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _is_uuid(val) -> bool:
    return bool(val and _UUID_RE.match(str(val)))

logger = logging.getLogger("ai-service.tools.lodging")


def build_lodging_tools(company_id: int, client_id, lodging_type: str = "hotel") -> list:
    """Tools do agente de hospedagem."""

    def get_kennel_availability(checkin_date: str, checkout_date: str) -> dict:
        """
        Verifica vagas disponíveis no período de hospedagem.
        Chamar SEMPRE que o cliente mencionar datas de check-in/check-out.
        """
        try:
            checkin = date.fromisoformat(checkin_date)
            checkout = date.fromisoformat(checkout_date)
        except ValueError:
            return {"success": False, "message": "Datas inválidas. Use o formato YYYY-MM-DD."}

        if checkout <= checkin:
            return {"success": False, "message": "Data de saída deve ser posterior à entrada."}

        if checkin < date.today():
            return {"success": False, "message": "Data de check-in não pode ser no passado."}

        days = (checkout - checkin).days

        # Verifica disponibilidade e busca configuração (taxa diária incluída)
        # Toda a lógica de consulta fica dentro de um único bloco de conexão
        nearest_checkin = None
        nearest_checkout = None
        daily_rate_val = None
        min_vagas = 0

        with get_connection() as conn:
            cur = conn.cursor()
            enabled_field = "hotel_enabled" if lodging_type == "hotel" else "daycare_enabled"
            rate_field = "hotel_daily_rate" if lodging_type == "hotel" else "daycare_daily_rate"
            cur.execute(f"""
                SELECT {enabled_field}, {rate_field}
                FROM petshop_lodging_config
                WHERE company_id = %s
            """, (company_id,))
            config = cur.fetchone()
            if not config or not config[enabled_field]:
                service_name = "Hotel" if lodging_type == "hotel" else "Creche"
                return {"success": False, "message": f"{service_name} não está disponível no momento."}

            daily_rate_val = float(config[rate_field]) if config[rate_field] else None

            # Disponibilidade do período solicitado
            cur.execute("""
                SELECT MIN(available_capacity) AS min_vagas
                FROM vw_lodging_availability
                WHERE company_id = %s
                  AND type       = %s
                  AND check_date BETWEEN %s AND (%s::date - INTERVAL '1 day')
            """, (company_id, lodging_type, checkin_date, checkout_date))
            row = cur.fetchone()
            min_vagas = row["min_vagas"] if row and row["min_vagas"] is not None else 0

            if min_vagas <= 0:
                # Busca o próximo período disponível da mesma duração — dentro da mesma conexão
                for offset in range(1, 61):
                    candidate_in = checkin + timedelta(days=offset)
                    candidate_out = candidate_in + timedelta(days=days)
                    cur.execute("""
                        SELECT MIN(available_capacity) AS min_vagas
                        FROM vw_lodging_availability
                        WHERE company_id = %s
                          AND type       = %s
                          AND check_date BETWEEN %s AND (%s::date - INTERVAL '1 day')
                    """, (company_id, lodging_type, str(candidate_in), str(candidate_out)))
                    r = cur.fetchone()
                    if r and r["min_vagas"] is not None and int(r["min_vagas"]) > 0:
                        nearest_checkin = candidate_in
                        nearest_checkout = candidate_out
                        break

        if min_vagas <= 0:
            if nearest_checkin:
                nearest_info = (
                    f"Próxima disponibilidade encontrada: "
                    f"{nearest_checkin.strftime('%d/%m/%Y')} a {nearest_checkout.strftime('%d/%m/%Y')} "
                    f"({days} dia{'s' if days > 1 else ''})."
                )
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
                        f"Sem vagas no período solicitado ({checkin_date} a {checkout_date}). "
                        f"{nearest_info} Ofereça este período ao cliente."
                    ),
                }
            return {
                "success": False,
                "available": False,
                "days": days,
                "message": (
                    f"Sem vagas disponíveis nos próximos 60 dias a partir de {checkin_date}. "
                    "Informe o cliente e peça novas datas."
                ),
            }

        total = round(daily_rate_val * days, 2) if daily_rate_val else None
        rate_info = f"R${daily_rate_val:.2f}/dia" if daily_rate_val else "valor a combinar"
        total_info = f"Total: R${total:.2f} ({days} dia{'s' if days > 1 else ''})" if total else ""

        return {
            "success": True,
            "available": True,
            "available_capacity": int(min_vagas),
            "days": days,
            "daily_rate": daily_rate_val,
            "total_amount": total,
            "checkin_date": checkin_date,
            "checkout_date": checkout_date,
            "message": f"Há vaga(s) disponíveis. {rate_info}. {total_info}".strip(),
        }

    def create_lodging(
        pet_id: str,
        checkin_date: str,
        checkout_date: str,
        daily_rate: float = None,
        care_notes: dict = None,
        confirmed: bool = False,
    ) -> dict:
        """
        Cria uma reserva de hospedagem. Exige confirmed=True — nunca criar sem confirmação explícita do cliente.

        Args:
            pet_id: ID do pet (obtido via get_client_pets)
            checkin_date: Data de entrada YYYY-MM-DD
            checkout_date: Data de saída YYYY-MM-DD
            daily_rate: Valor diário — opcional
            care_notes: Instruções de cuidado — opcional
            confirmed: Deve ser True — só confirmar após aceite explícito do cliente
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

        # Verifica se o tipo está habilitado e busca taxa diária configurada
        with get_connection() as conn:
            cur = conn.cursor()
            enabled_field = "hotel_enabled" if lodging_type == "hotel" else "daycare_enabled"
            rate_field = "hotel_daily_rate" if lodging_type == "hotel" else "daycare_daily_rate"
            cur.execute(f"""
                SELECT {enabled_field}, {rate_field}
                FROM petshop_lodging_config
                WHERE company_id = %s
            """, (company_id,))
            config = cur.fetchone()
            if not config or not config[enabled_field]:
                service_name = "Hotel" if lodging_type == "hotel" else "Creche"
                return {"success": False, "message": f"{service_name} não está disponível no momento."}

            # Usa a taxa configurada se o agente não passou explicitamente
            if daily_rate is None and config[rate_field]:
                daily_rate = float(config[rate_field])

        days = (checkout - checkin).days
        total_amount = round(float(daily_rate) * days, 2) if daily_rate else None

        with get_connection() as conn:
            cur = conn.cursor()

            # Verifica pet
            cur.execute(
                "SELECT id, name FROM petshop_pets WHERE id = %s AND client_id = %s AND company_id = %s AND is_active = TRUE",
                (pet_id, client_id, company_id)
            )
            pet = cur.fetchone()
            if not pet:
                return {"success": False, "message": "Pet não encontrado. Use get_client_pets para obter os IDs corretos."}

            cur.execute("""
                INSERT INTO petshop_lodging_reservations
                    (company_id, client_id, pet_id, type, checkin_date, checkout_date,
                     daily_rate, total_amount, care_notes, status, confirmed)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'confirmed', TRUE)
                RETURNING id
            """, (company_id, client_id, pet_id, lodging_type, checkin_date, checkout_date,
                  daily_rate, total_amount, json.dumps(care_notes or {})))
            lodging_id = cur.fetchone()["id"]

            cur.execute(
                "UPDATE clients SET conversation_stage = 'completed', updated_at = NOW() WHERE id = %s AND company_id = %s",
                (client_id, company_id)
            )

        return {
            "success": True,
            "lodging_id": str(lodging_id),
            "days": days,
            "total_amount": total_amount,
            "message": f"Hospedagem confirmada! Check-in {checkin_date}, check-out {checkout_date} ({days} dias)."
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
            cur.execute("""
                UPDATE petshop_lodging_reservations
                SET status = 'cancelled', updated_at = NOW()
                WHERE id = %s AND company_id = %s AND client_id = %s
                  AND status NOT IN ('checked_out', 'cancelled')
                RETURNING id
            """, (lodging_id, company_id, client_id))
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
                cur.execute("""
                    SELECT l.id, l.kennel_id, l.checkin_date, l.checkout_date, l.status,
                           l.total_amount, p.name AS pet_name
                    FROM petshop_lodging_reservations l
                    JOIN petshop_pets p ON p.id = l.pet_id
                    WHERE l.id = %s AND l.company_id = %s AND l.client_id = %s
                """, (lodging_id, company_id, client_id))
            else:
                cur.execute("""
                    SELECT l.id, l.kennel_id, l.checkin_date, l.checkout_date, l.status,
                           l.total_amount, p.name AS pet_name
                    FROM petshop_lodging_reservations l
                    JOIN petshop_pets p ON p.id = l.pet_id
                    WHERE l.company_id = %s AND l.client_id = %s
                      AND l.status NOT IN ('cancelled', 'checked_out')
                    ORDER BY l.checkin_date DESC
                    LIMIT 1
                """, (company_id, client_id))
            row = cur.fetchone()

        if not row:
            return {"found": False, "message": "Nenhuma hospedagem ativa encontrada."}
        return {"found": True, **dict(row)}

    return [get_kennel_availability, create_lodging, cancel_lodging, get_lodging_status]
