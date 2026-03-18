import logging
import os
import re
import urllib.request
import json
from datetime import date, datetime, timedelta, timezone
from db import get_connection

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
        """Executa a query de slots com vagas disponíveis."""
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
            return cur.fetchall()

    def get_available_times(specialty_id: str, target_date: str) -> dict:
        """
        Retorna horários disponíveis para uma especialidade em uma data específica.
        Chamar SEMPRE que o cliente mencionar uma data — nunca inventar horários.

        Args:
            specialty_id: ID da especialidade (obtido via get_specialties)
            target_date: Data no formato YYYY-MM-DD
        """
        try:
            parsed_date = date.fromisoformat(target_date)
        except ValueError:
            return {
                "available": False,
                "message": "Data inválida. Use o formato YYYY-MM-DD.",
            }

        today = date.today()
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

        slots = _query_available_slots(specialty_id, target_date)

        # Fallback: se não há slots, tenta gerar via endpoint interno e re-consulta
        if not slots:
            logger.info(
                "Nenhum slot encontrado para %s/%s — tentando fallback generate-slots",
                specialty_id,
                target_date,
            )
            if _try_generate_slots():
                slots = _query_available_slots(specialty_id, target_date)

        if not slots:
            return {
                "available": False,
                "closed_days": [],
                "full_days": [target_date],
                "available_times": [],
                "message": "Sem vagas disponíveis neste dia.",
            }

        available_slots = []
        for s in slots:
            slot_dt = datetime.combine(parsed_date, s["slot_time"])
            if slot_dt <= now + timedelta(hours=2):
                continue
            available_slots.append(
                {
                    "slot_id": str(s["id"]),
                    "start_time": str(s["slot_time"])[:5],
                    "vagas": s["vagas_restantes"],
                    "booking_date": target_date,
                }
            )

        if not available_slots:
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
                "SELECT id, max_capacity, used_capacity, slot_date, slot_time FROM petshop_slots WHERE id = %s AND company_id = %s",
                (slot_id, company_id),
            )
            slot_row = cur.fetchone()
            if (
                not slot_row
                or (slot_row["max_capacity"] - slot_row["used_capacity"]) <= 0
            ):
                return {
                    "success": False,
                    "message": "Horário não disponível. Por favor, escolha outro.",
                }

            # Calcula preço cobrado: prioriza price_by_size se existir, fallback para price fixo
            price_charged = service_row["price"]
            price_by_size = service_row.get("price_by_size")
            if price_by_size and isinstance(price_by_size, dict):
                pet_size = pet_row.get("size")  # 'P', 'M', 'G', 'GG'
                if pet_size and pet_size in price_by_size:
                    price_charged = price_by_size[pet_size]
                elif pet_size:
                    logger.warning(
                        "Porte '%s' não encontrado em price_by_size=%s — usando price fixo",
                        pet_size,
                        price_by_size,
                    )

            logger.info(
                "price_charged calculado: %s (pet_size=%s, price_by_size=%s, price_fixo=%s)",
                price_charged,
                pet_row.get("size"),
                price_by_size,
                service_row["price"],
            )

            # Constrói scheduled_date combinando slot_date + slot_time
            slot_date = slot_row.get("slot_date")
            slot_time_val = slot_row.get("slot_time")
            if slot_date and slot_time_val:
                scheduled_date = datetime.combine(slot_date, slot_time_val)
            else:
                scheduled_date = None

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

            # Incrementa used_capacity no slot
            cur.execute(
                "UPDATE petshop_slots SET used_capacity = used_capacity + 1 WHERE id = %s",
                (slot_id,),
            )

            cur.execute(
                """
                UPDATE clients
                SET conversation_stage = 'completed', updated_at = NOW()
                WHERE id = %s AND company_id = %s
            """,
                (client_id, company_id),
            )

        return {
            "success": True,
            "appointment_id": str(appointment_id),
            "message": "Agendamento confirmado com sucesso!",
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
                UPDATE petshop_appointments
                SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = %s
                WHERE id = %s AND company_id = %s AND client_id = %s
                  AND status NOT IN ('completed', 'cancelled')
                RETURNING id, slot_id
            """,
                (reason, appointment_id, company_id, client_id),
            )
            updated = cur.fetchone()

            if updated and updated.get("slot_id"):
                cur.execute(
                    "UPDATE petshop_slots SET used_capacity = GREATEST(used_capacity - 1, 0) WHERE id = %s",
                    (updated["slot_id"],),
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
