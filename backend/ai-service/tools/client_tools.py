import logging
from db import get_connection
from tools.booking_tools import _extract_double_pair_id
from tools.slot_time_utils import hhmm_after_minutes, slot_time_to_hhmm

logger = logging.getLogger("ai-service.tools.client")


def _merge_upcoming_appointment_rows(rows: list) -> list:
    """
    Une pares __DOUBLE_PAIR__ em um único item com faixa de horário,
    para o agente não confundir dois registros (ex.: 15h e 16h) com dois serviços.
    """
    by_id = {str(r["id"]): r for r in rows}
    consumed: set[str] = set()
    out: list = []
    for r in rows:
        rid = str(r["id"])
        if rid in consumed:
            continue
        pid = _extract_double_pair_id(r.get("notes"))
        partner = by_id.get(pid) if pid else None
        if (
            partner
            and _extract_double_pair_id(partner.get("notes")) == rid
        ):
            consumed.add(rid)
            consumed.add(str(partner["id"]))
            t_a = slot_time_to_hhmm(r.get("start_time_raw"))
            t_b = slot_time_to_hhmm(partner.get("start_time_raw"))
            dur = int(r.get("duration_min") or 60)
            first, second = (r, partner) if t_a <= t_b else (partner, r)
            t1 = slot_time_to_hhmm(first.get("start_time_raw"))
            t2 = slot_time_to_hhmm(second.get("start_time_raw"))
            end_br = hhmm_after_minutes(t2, dur)
            out.append(
                {
                    "id": str(first["id"]),
                    "paired_appointment_id": str(second["id"]),
                    "scheduled_date": first.get("scheduled_date"),
                    "status": first.get("status"),
                    "service_name": first.get("service_name"),
                    "pet_name": first.get("pet_name"),
                    "start_time": t1,
                    "second_slot_start": t2,
                    "service_end_time": end_br,
                    "uses_double_slot": True,
                }
            )
            continue
        st = slot_time_to_hhmm(r.get("start_time_raw"))
        dur = int(r.get("duration_min") or 60)
        out.append(
            {
                "id": rid,
                "scheduled_date": r.get("scheduled_date"),
                "status": r.get("status"),
                "service_name": r.get("service_name"),
                "pet_name": r.get("pet_name"),
                "start_time": st,
                "service_end_time": hhmm_after_minutes(st, dur) if st else None,
                "uses_double_slot": False,
            }
        )
    return out


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

        ATENÇÃO — RAÇA NÃO É NOME:
        Raças são palavras como: "Bull Terrier", "Golden Retriever", "Labrador", "Poodle",
        "Shih Tzu", "Yorkshire", "Bulldog", "Beagle", "Dachshund", "Husky", "Pastor Alemão",
        "Lhasa Apso", "Maltês", "Rottweiler", "Chihuahua", "Pug", "Dobermann", "Sem raça definida" etc.
        Se o cliente mencionar apenas uma raça, NÃO use a raça como nome — pergunte qual é
        o nome/apelido do pet antes de prosseguir. O nome é o apelido dado pelo dono
        (ex: "Rex", "Bolinha", "Max", "Luna", "Mel", "Toby").

        Args:
            name: Nome/apelido do pet dado pelo dono (NÃO pode ser uma raça)
            species: Espécie — 'cachorro' ou 'gato'
            breed: Raça (ou 'Sem raça definida' se o cliente disser que não sabe)
            size: Porte — 'P', 'M', 'G' ou 'GG' (DEVE ter sido PERGUNTADO ao cliente)
        """
        # Lista de raças comuns para detectar confusão nome vs raça
        _KNOWN_BREEDS = {
            "bull terrier", "golden retriever", "labrador", "labrador retriever",
            "poodle", "shih tzu", "yorkshire", "yorkshire terrier", "bulldog",
            "beagle", "dachshund", "husky", "pastor alemão", "german shepherd",
            "lhasa apso", "maltês", "maltese", "rottweiler", "chihuahua", "pug",
            "dobermann", "doberman", "border collie", "cocker spaniel", "boxer",
            "srd", "sem raça definida", "sem raca definida", "vira-lata", "vira lata", "pitbull", "pit bull",
            "american bully", "french bulldog", "bulldog francês",
            "shiba inu", "akita", "chow chow", "dálmata", "dalmatian",
            "schnauzer", "bichon frise", "cavalier king charles", "basset hound",
            "great dane", "são bernardo", "saint bernard",
        }

        missing = []
        if not name or not name.strip():
            missing.append("nome")
        if not species or not species.strip():
            missing.append("espécie (cachorro ou gato)")
        if not breed or not breed.strip():
            missing.append("raça (ou Sem raça definida se não souber)")
        if not size or not size.strip():
            missing.append("porte (pequeno (P), médio (M), grande (G) ou extra grande (GG))")

        if missing:
            return {
                "success": False,
                "missing_fields": missing,
                "message": f"Faltam dados obrigatórios: {', '.join(missing)}. Pergunte ao cliente antes de cadastrar.",
            }

        breed_raw = breed.strip()
        breed_l = breed_raw.lower()
        if breed_l in ("srd", "sem raça definida", "sem raca definida"):
            breed_for_db = "Sem raça definida"
        else:
            breed_for_db = breed_raw

        # Detecta se o nome passado é uma raça conhecida
        if name.strip().lower() in _KNOWN_BREEDS:
            return {
                "success": False,
                "name_is_breed": True,
                "message": (
                    f"'{name}' parece ser uma raça, não um nome de pet. "
                    "Pergunte ao cliente: 'Qual é o nome/apelido do seu pet?' antes de cadastrar."
                ),
            }

        species_norm = species.lower().strip()
        size_norm = size.lower().strip()

        if species_norm not in ("cachorro", "gato"):
            return {
                "success": False,
                "message": "Espécie inválida. Use 'cachorro' ou 'gato'.",
            }

        size_map = {
            "pequeno": "P",
            "médio": "M",
            "medio": "M",
            "grande": "G",
            "gigante": "GG",
            "extra grande": "GG",
            "P": "P",
            "M": "M",
            "G": "G",
            "GG": "GG",
            "small": "P",
            "medium": "M",
            "large": "G",
        }
        size_db = size_map.get(size_norm) or size_map.get(size_norm.upper())
        if not size_db:
            return {
                "success": False,
                "missing_fields": ["porte (pequeno (P), médio (M), grande (G) ou extra grande (GG))"],
                "message": "Porte inválido. Pergunte ao cliente: o pet é pequeno (P, até 10kg), médio (M, 10-25kg), grande (G, acima de 25kg) ou extra grande (GG)?",
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
                (company_id, client_id, name, species_norm, breed_for_db, size_db),
            )
            pet_id = cur.fetchone()["id"]

            if client_id:
                cur.execute(
                    """
                    UPDATE clients
                    SET conversation_stage = 'pet_registered', updated_at = NOW()
                    WHERE id = %s AND company_id = %s
                """,
                    (client_id, company_id),
                )

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
            pet_name: Nome/apelido do pet (NÃO use raça como nome — veja instruções em create_pet)
            size: Porte informado pelo cliente — 'P', 'M', 'G' ou 'GG'
        """
        if not size or not size.strip():
            return {
                "success": False,
                "message": "Porte não informado. Pergunte ao cliente: o pet é pequeno (até 10kg), médio (10-25kg) ou grande (acima de 25kg)?",
            }

        size_map = {
            "pequeno": "P",
            "médio": "M",
            "medio": "M",
            "grande": "G",
            "gigante": "GG",
            "extra grande": "GG",
            "P": "P",
            "M": "M",
            "G": "G",
            "GG": "GG",
            "small": "P",
            "medium": "M",
            "large": "G",
        }
        size_norm_val = size.lower().strip()
        size_db = size_map.get(size_norm_val) or size_map.get(size_norm_val.upper())
        if not size_db:
            return {
                "success": False,
                "message": "Porte inválido. Pergunte ao cliente: o pet é pequeno (P, até 10kg), médio (M, 10-25kg), grande (G, acima de 25kg) ou extra grande (GG)?",
            }

        size_label = {"P": "pequeno", "M": "médio", "G": "grande", "GG": "extra grande"}.get(size_db, size)

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
                    a.notes,
                    COALESCE(sl.slot_time, sch.start_time) AS start_time_raw,
                    svc.name AS service_name,
                    COALESCE(svc.duration_min, 60) AS duration_min,
                    p.name AS pet_name
                FROM petshop_appointments a
                JOIN petshop_services svc ON svc.id = a.service_id
                JOIN petshop_pets p ON p.id = a.pet_id
                LEFT JOIN petshop_slots sl ON sl.id = a.slot_id
                LEFT JOIN petshop_schedules sch ON sch.id = a.schedule_id
                WHERE a.company_id = %s
                  AND a.client_id = %s
                  AND a.status IN ('pending', 'confirmed')
                  AND a.scheduled_date >= CURRENT_DATE
                ORDER BY a.scheduled_date,
                    COALESCE(sl.slot_time, sch.start_time) NULLS LAST
            """,
                (company_id, client_id),
            )
            rows = [dict(r) for r in cur.fetchall()]
        return _merge_upcoming_appointment_rows(rows)

    return [
        get_client_pets,
        create_pet,
        set_pet_size,
        advance_stage,
        get_upcoming_appointments,
    ]
