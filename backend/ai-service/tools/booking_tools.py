import logging
from datetime import date, datetime, timedelta, timezone
from db import get_connection

# Fuso horário de Brasília (UTC-3) — usado para filtrar horários do dia
BRASILIA = timezone(timedelta(hours=-3))

logger = logging.getLogger("ai-service.tools.booking")


def build_booking_tools(company_id: int, client_id) -> list:
    """
    Retorna as tools de agendamento com company_id e client_id pré-vinculados via closure.
    A LLM nunca recebe os IDs como parâmetro.
    """

    def get_services() -> dict:
        """
        Retorna lista de serviços ativos do petshop.
        Chamar em silêncio para validar o serviço antes de pedir dados do pet.
        """
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id, name, description, duration_min, price, price_by_size, duration_multiplier_large
                FROM petshop_services
                WHERE company_id = %s AND is_active = TRUE
                ORDER BY name
            """,
                (company_id,),
            )
            services = cur.fetchall()
        return {"services": [dict(s) for s in services], "count": len(services)}

    def get_available_times(target_date: str) -> dict:
        """
        Retorna horários disponíveis para uma data específica.
        Chamar SEMPRE que o cliente mencionar uma data — nunca inventar horários.

        Args:
            target_date: Data no formato YYYY-MM-DD
        """
        try:
            parsed_date = date.fromisoformat(target_date)
        except ValueError:
            return {"available": False, "message": "Data inválida. Use o formato YYYY-MM-DD."}

        today = date.today()
        if parsed_date < today:
            return {"available": False, "message": "Não é possível agendar em datas passadas."}
        if parsed_date > today + timedelta(days=60):
            return {
                "available": False,
                "message": "Só é possível agendar com até 60 dias de antecedência.",
                "beyond_limit": True,
            }

        weekday = parsed_date.isoweekday() % 7  # 0=Dom, 1=Seg ... 6=Sab

        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT
                    sch.id,
                    sch.start_time,
                    sch.end_time,
                    sch.capacity,
                    COUNT(a.id) AS booked
                FROM petshop_schedules sch
                LEFT JOIN petshop_appointments a
                    ON a.schedule_id = sch.id
                    AND a.scheduled_date = %s
                    AND a.status NOT IN ('cancelled', 'no_show')
                WHERE sch.company_id = %s
                  AND sch.weekday = %s
                  AND sch.is_active = TRUE
                GROUP BY sch.id, sch.start_time, sch.end_time, sch.capacity
                ORDER BY sch.start_time
            """,
                (target_date, company_id, weekday),
            )
            all_slots = cur.fetchall()

        if not all_slots:
            return {
                "available": False,
                "closed_days": [target_date],
                "full_days": [],
                "available_times": [],
                "message": "Petshop fechado neste dia.",
            }

        # Usa horário de Brasília — servidor pode rodar em UTC
        now = datetime.now(BRASILIA).replace(tzinfo=None)
        available_slots = []
        full = True

        for s in all_slots:
            vacancies = s["capacity"] - s["booked"]
            slot_dt = datetime.combine(parsed_date, s["start_time"])

            if slot_dt <= now + timedelta(hours=2):
                continue

            if vacancies > 0:
                full = False
                available_slots.append(
                    {
                        "schedule_id": s["id"],
                        "start_time": str(s["start_time"])[:5],
                        "end_time": str(s["end_time"])[:5],
                        "vacancies": vacancies,
                        "booking_date": target_date,
                    }
                )

        if full:
            return {
                "available": False,
                "closed_days": [],
                "full_days": [target_date],
                "available_times": [],
                "message": "Sem vagas disponíveis neste dia.",
            }

        return {
            "available": True,
            "date": target_date,
            "closed_days": [],
            "full_days": [],
            "available_times": available_slots,
        }

    def create_appointment(
        pet_id: str,
        service_id: int,
        schedule_id: int,
        scheduled_date: str,
        confirmed: bool = False,
        notes: str = None,
    ) -> dict:
        """
        Cria um agendamento. Exige confirmed=True — nunca criar sem confirmação explícita do cliente.

        Args:
            pet_id: ID do pet (obtido via get_client_pets)
            service_id: ID do serviço (obtido via get_services)
            schedule_id: ID do horário (obtido via get_available_times)
            scheduled_date: Data no formato YYYY-MM-DD
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
            logger.error("create_appointment: client_id vazio — cliente não encontrado no contexto")
            return {"success": False, "message": "Cliente não identificado. Não é possível criar o agendamento."}

        # Valida formato da data antes de qualquer query
        try:
            date.fromisoformat(scheduled_date)
        except (ValueError, TypeError):
            return {"success": False, "message": "scheduled_date inválida. Use o formato YYYY-MM-DD."}

        # pet_id é UUID (string) — NÃO converter para int
        # service_id e schedule_id são integer no banco
        try:
            service_id = int(service_id)
            schedule_id = int(schedule_id)
        except (ValueError, TypeError):
            return {"success": False, "message": "service_id e schedule_id devem ser números inteiros válidos."}

        logger.info(
            "create_appointment | client_id=%s | pet_id=%s | service_id=%s | schedule_id=%s | date=%s",
            client_id, pet_id, service_id, schedule_id, scheduled_date,
        )
        try:
            result = _do_create_appointment(company_id, client_id, pet_id, service_id, schedule_id, scheduled_date, notes)
            logger.info("create_appointment resultado: %s", result)
            return result
        except Exception as exc:
            logger.exception(
                "create_appointment falhou | client_id=%s | pet_id=%s | service_id=%s | schedule_id=%s | date=%s | erro=%s",
                client_id, pet_id, service_id, schedule_id, scheduled_date, exc,
            )
            return {
                "success": False,
                "message": "Falha ao salvar agendamento no banco. Verifique os IDs e tente novamente.",
                "debug": str(exc),
            }

    def _do_create_appointment(company_id, client_id, pet_id, service_id, schedule_id, scheduled_date, notes):
        with get_connection() as conn:
            cur = conn.cursor()

            # Valida service_id — busca preço fixo e preço por porte
            cur.execute(
                "SELECT id, price, price_by_size FROM petshop_services WHERE id = %s AND company_id = %s AND is_active = TRUE",
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
                missing_pet_fields.append("porte (pequeno, médio ou grande)")
            if missing_pet_fields:
                return {
                    "success": False,
                    "incomplete_pet": True,
                    "missing_fields": missing_pet_fields,
                    "message": f"Cadastro do pet incompleto. Faltam: {', '.join(missing_pet_fields)}. O cliente deve completar o cadastro antes de agendar.",
                }

            # Verifica vaga no horário
            cur.execute(
                """
                SELECT sch.capacity - COUNT(a.id) AS vacancies
                FROM petshop_schedules sch
                LEFT JOIN petshop_appointments a
                    ON a.schedule_id = sch.id
                    AND a.scheduled_date = %s
                    AND a.status NOT IN ('cancelled', 'no_show')
                WHERE sch.id = %s AND sch.company_id = %s
                GROUP BY sch.capacity
            """,
                (scheduled_date, schedule_id, company_id),
            )
            row = cur.fetchone()
            if not row or row["vacancies"] <= 0:
                return {"success": False, "message": "Horário não disponível. Por favor, escolha outro."}

            # Calcula preço cobrado: prioriza price_by_size se existir, fallback para price fixo
            price_charged = service_row["price"]
            price_by_size = service_row.get("price_by_size")
            if price_by_size and isinstance(price_by_size, dict):
                pet_size = pet_row.get("size")  # 'small', 'medium', 'large'
                if pet_size and pet_size in price_by_size:
                    price_charged = price_by_size[pet_size]
                elif pet_size:
                    logger.warning(
                        "Porte '%s' não encontrado em price_by_size=%s — usando price fixo",
                        pet_size, price_by_size,
                    )

            logger.info(
                "price_charged calculado: %s (pet_size=%s, price_by_size=%s, price_fixo=%s)",
                price_charged, pet_row.get("size"), price_by_size, service_row["price"],
            )

            cur.execute(
                """
                INSERT INTO petshop_appointments
                    (company_id, client_id, pet_id, service_id, schedule_id,
                     scheduled_date, status, notes, price_charged)
                VALUES (%s, %s, %s, %s, %s, %s, 'confirmed', %s, %s)
                RETURNING id
            """,
                (
                    company_id,
                    client_id,
                    pet_id,
                    service_id,
                    schedule_id,
                    scheduled_date,
                    notes,
                    price_charged,
                ),
            )
            appointment_id = cur.fetchone()["id"]

        return {
            "success": True,
            "appointment_id": str(appointment_id),
            "message": "Agendamento confirmado com sucesso! 🐾",
        }

    def cancel_appointment(appointment_id: str, reason: str = None) -> dict:
        """
        Cancela um agendamento existente do cliente.

        Args:
            appointment_id: ID do agendamento a cancelar
            reason: Motivo do cancelamento (opcional)
        """
        if not appointment_id:
            return {"success": False, "message": "appointment_id é obrigatório."}

        logger.info("cancel_appointment | client_id=%s | appointment_id=%s | reason=%r", client_id, appointment_id, reason)
        with get_connection() as conn:
            cur = conn.cursor()
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

        if not updated:
            return {"success": False, "message": "Agendamento não encontrado ou já finalizado."}
        return {"success": True, "message": "Agendamento cancelado com sucesso."}

    return [get_services, get_available_times, create_appointment, cancel_appointment]
