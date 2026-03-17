import logging
from db import get_connection

logger = logging.getLogger("ai-service.tools.client")


def build_client_tools(company_id: int, client_id: str) -> list:
    """
    Retorna as tools de cliente com company_id e client_id pré-vinculados via closure.
    A LLM nunca recebe os IDs como parâmetro — ela só preenche o que realmente importa.
    """

    def get_client_pets() -> dict:
        """
        Lista os pets ativos do cliente.
        Chamar SEMPRE antes de cadastrar um pet para evitar duplicatas.
        """
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id, name, species, breed, size, weight_kg, gender
                FROM petshop_pets
                WHERE company_id = %s AND client_id = %s AND is_active = TRUE
                ORDER BY name
            """,
                (company_id, client_id),
            )
            pets = cur.fetchall()
        return {"pets": [dict(p) for p in pets], "count": len(pets)}

    def create_pet(name: str, species: str, breed: str, size: str) -> dict:
        """
        Cadastra um novo pet para o cliente.
        TODOS os 4 campos são OBRIGATÓRIOS — incluindo o porte.
        O porte DEVE ter sido perguntado e informado EXPLICITAMENTE pelo cliente.
        NUNCA deduza o porte pela raça — sempre pergunte antes de chamar esta tool.

        Args:
            name: Nome do pet (apelido dado pelo dono)
            species: Espécie — 'cachorro' ou 'gato'
            breed: Raça (ou 'SRD' apenas se o cliente disse que não sabe)
            size: Porte — 'pequeno', 'médio' ou 'grande' (DEVE ter sido PERGUNTADO ao cliente)
        """
        missing = []
        if not name or not name.strip():
            missing.append("nome")
        if not species or not species.strip():
            missing.append("espécie (cachorro ou gato)")
        if not breed or not breed.strip():
            missing.append("raça (ou SRD se não souber)")
        if not size or not size.strip():
            missing.append("porte (pequeno, médio ou grande)")

        if missing:
            return {
                "success": False,
                "missing_fields": missing,
                "message": f"Faltam dados obrigatórios: {', '.join(missing)}. Pergunte ao cliente antes de cadastrar.",
            }

        species_norm = species.lower().strip()
        size_norm = size.lower().strip()

        if species_norm not in ("cachorro", "gato"):
            return {
                "success": False,
                "message": "Espécie inválida. Use 'cachorro' ou 'gato'.",
            }

        size_map = {
            "pequeno": "small",
            "médio": "medium",
            "medio": "medium",
            "grande": "large",
            "small": "small",
            "medium": "medium",
            "large": "large",
        }
        size_db = size_map.get(size_norm)
        if not size_db:
            return {
                "success": False,
                "missing_fields": ["porte (pequeno, médio ou grande)"],
                "message": "Porte inválido. Pergunte ao cliente: o pet é pequeno (até 10kg), médio (10-25kg) ou grande (acima de 25kg)?",
            }

        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id FROM petshop_pets
                WHERE company_id = %s AND client_id = %s
                  AND LOWER(name) = LOWER(%s) AND is_active = TRUE
            """,
                (company_id, client_id, name),
            )
            if cur.fetchone():
                return {
                    "success": False,
                    "message": f"Já existe um pet chamado {name} cadastrado.",
                }

            cur.execute(
                """
                INSERT INTO petshop_pets (company_id, client_id, name, species, breed, size)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
            """,
                (company_id, client_id, name, species_norm, breed, size_db),
            )
            pet_id = cur.fetchone()["id"]

        return {
            "success": True,
            "pet_id": str(pet_id),
            "message": f"{name} cadastrado com sucesso!",
        }

    def set_pet_size(pet_name: str, size: str) -> dict:
        """
        Confirma e registra o porte do pet informado pelo cliente.
        Use esta tool SEMPRE que o cliente informar o porte — tanto para pets já cadastrados quanto para pets ainda não cadastrados.

        - Se o pet já existe no banco → atualiza o porte
        - Se o pet ainda não foi cadastrado → retorna o porte confirmado para uso em create_pet e nos preços

        O porte confirmado por esta tool define o preço dos serviços.
        NUNCA deduza o porte pela raça — sempre pergunte ao cliente primeiro.

        Args:
            pet_name: Nome do pet (pode ser um pet já cadastrado ou o nome informado pelo cliente)
            size: Porte informado pelo cliente — 'pequeno', 'médio' ou 'grande'
        """
        if not size or not size.strip():
            return {
                "success": False,
                "message": "Porte não informado. Pergunte ao cliente: o pet é pequeno (até 10kg), médio (10-25kg) ou grande (acima de 25kg)?",
            }

        size_map = {
            "pequeno": "small",
            "médio": "medium",
            "medio": "medium",
            "grande": "large",
            "small": "small",
            "medium": "medium",
            "large": "large",
        }
        size_db = size_map.get(size.lower().strip())
        if not size_db:
            return {
                "success": False,
                "message": "Porte inválido. Pergunte ao cliente: o pet é pequeno (até 10kg), médio (10-25kg) ou grande (acima de 25kg)?",
            }

        size_label = {"small": "pequeno", "medium": "médio", "large": "grande"}.get(
            size_db, size
        )

        # Tenta atualizar se o pet já existe no banco
        updated = None
        if pet_name and pet_name.strip():
            with get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    UPDATE petshop_pets
                    SET size = %s
                    WHERE company_id = %s AND client_id = %s
                      AND LOWER(name) = LOWER(%s) AND is_active = TRUE
                    RETURNING id, name
                """,
                    (size_db, company_id, client_id, pet_name),
                )
                updated = cur.fetchone()

        if updated:
            return {
                "success": True,
                "pet_updated": True,
                "size": size_db,
                "size_label": size_label,
                "message": f"Porte de {updated['name']} confirmado como {size_label}!",
            }
        else:
            # Pet ainda não cadastrado — retorna porte confirmado para uso posterior
            return {
                "success": True,
                "pet_updated": False,
                "size": size_db,
                "size_label": size_label,
                "message": f"Porte confirmado: {size_label}. Use este porte ao cadastrar o pet e para calcular preços.",
            }

    VALID_STAGES = {"initial", "onboarding", "pet_registered", "booking", "completed"}

    def advance_stage(conversation_stage: str) -> dict:
        """
        Avança o estágio da conversa do cliente.
        Chamar após o cliente completar uma etapa do fluxo.

        Args:
            conversation_stage: Novo estágio — valores válidos: initial, onboarding, pet_registered, booking, completed
        """
        if not conversation_stage:
            return {"success": False, "message": "conversation_stage é obrigatório."}

        if conversation_stage not in VALID_STAGES:
            logger.warning(
                "advance_stage chamado com estágio inválido=%r", conversation_stage
            )
            return {
                "success": False,
                "message": f"Estágio inválido: '{conversation_stage}'. Valores permitidos: {', '.join(sorted(VALID_STAGES))}.",
            }

        logger.info(
            "advance_stage | client_id=%s | stage=%s", client_id, conversation_stage
        )
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                UPDATE clients
                SET conversation_stage = %s, updated_at = NOW()
                WHERE id = %s AND company_id = %s
                RETURNING conversation_stage
            """,
                (conversation_stage, client_id, company_id),
            )
            updated = cur.fetchone()

        if not updated:
            return {"success": False, "message": "Cliente não encontrado."}

        return {"success": True, "conversation_stage": updated["conversation_stage"]}

    def get_upcoming_appointments() -> list:
        """Retorna os próximos agendamentos confirmados ou pendentes do cliente."""
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT
                    a.id,
                    a.scheduled_date,
                    a.status,
                    sch.start_time,
                    svc.name AS service_name,
                    p.name   AS pet_name
                FROM petshop_appointments a
                JOIN petshop_schedules sch ON sch.id = a.schedule_id
                JOIN petshop_services  svc ON svc.id = a.service_id
                JOIN petshop_pets      p   ON p.id   = a.pet_id
                WHERE a.company_id = %s
                  AND a.client_id  = %s
                  AND a.status IN ('pending', 'confirmed')
                  AND a.scheduled_date >= CURRENT_DATE
                ORDER BY a.scheduled_date, sch.start_time
            """,
                (company_id, client_id),
            )
            rows = cur.fetchall()
        return [dict(r) for r in rows]

    return [
        get_client_pets,
        create_pet,
        set_pet_size,
        advance_stage,
        get_upcoming_appointments,
    ]
