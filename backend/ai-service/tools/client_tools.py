import logging
import re
import unicodedata

from db import get_connection
from memory.tool_result_cache import (
    cache_get_client_pets,
    cache_invalidate_client_pets,
    cache_set_client_pets,
)
from prompts.scheduling_pet_shared import PET_SIZE_WEIGHT_REFERENCE_PT
from tools.booking_tools import _effective_service_duration_minutes, _extract_double_pair_id
from tools.slot_time_utils import hhmm_after_minutes, slot_time_to_hhmm

logger = logging.getLogger("ai-service.tools.client")


def fetch_client_pets_snapshot(company_id: int, client_id: str) -> dict | None:
    """Executa a mesma leitura de get_client_pets sem passar pelo loop de tools."""
    if not client_id or not str(client_id).strip():
        return None
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
    out = {"pets": [dict(p) for p in pets], "count": len(pets)}
    cache_set_client_pets(company_id, str(client_id), out)
    return out


def _norm_comp(s: str) -> str:
    """Lowercase + strip accents for robust comparisons."""
    s = unicodedata.normalize("NFD", (s or "").strip().lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


# Nome não pode ser espécie, placeholder numérico ou parecer raça.
_SPECIES_OR_GENERIC_NAMES = frozenset(
    _norm_comp(x)
    for x in (
        "gato", "gata", "gatinho", "gatinha",
        "cachorro", "cachorra", "cachorrinho", "cachorrinha",
        "cão", "cadela", "dog", "cat", "pet", "animal", "bicho",
        "filhote", "filhota", "canino", "felino",
    )
)

_BREED_CANNOT_BE_SPECIES_WORD = frozenset(
    _norm_comp(x)
    for x in (
        "gato", "gata", "gatinho", "gatinha",
        "cachorro", "cachorra", "cachorrinho", "cachorrinha",
        "cão", "cadela", "dog", "cat", "felino", "canino",
    )
)

_PLACEHOLDER_NAME_RE = re.compile(
    r"^(cachorro|gato|cão|cao|pet|dog|cat|animal|bicho)(\s*[0-9]+)?$",
    re.IGNORECASE,
)

_FULL_BREED_PHRASES = frozenset(
    _norm_comp(x)
    for x in (
        "bull terrier", "golden retriever", "labrador retriever",
        "yorkshire terrier", "border collie", "cocker spaniel",
        "bichon frise", "cavalier king charles", "basset hound",
        "great dane", "são bernardo", "sao bernardo", "saint bernard",
        "american bully", "french bulldog", "bulldog francês",
        "bulldog frances", "pastor alemão", "pastor alemao",
        "german shepherd", "pit bull", "shih tzu", "chow chow",
        "bichon frisé", "lhasa apso",
    )
)

_SINGLE_TOKEN_BREEDS = frozenset(
    _norm_comp(x)
    for x in (
        "bulldog", "buldog", "buldogue", "labrador", "poodle",
        "beagle", "dachshund", "husky", "pug", "rottweiler",
        "chihuahua", "dobermann", "doberman", "boxer", "collie",
        "maltês", "maltese", "pitbull", "shiba", "akita",
        "dálmata", "dalmatian", "schnauzer", "persa", "siamês",
        "siames", "siamese", "angorá", "angora", "srd", "golden",
        "yorkshire", "lhasa", "lab",
    )
)

SIZE_MAP = {
    "pequeno": "P", "médio": "M", "medio": "M",
    "grande": "G", "gigante": "GG", "extra grande": "GG",
    "P": "P", "M": "M", "G": "G", "GG": "GG",
    "small": "P", "medium": "M", "large": "G",
    "p": "P", "m": "M", "g": "G", "gg": "GG",
}

SIZE_LABEL = {"P": "pequeno", "M": "médio", "G": "grande", "GG": "extra grande"}


def _pet_display_name_error(name: str) -> str | None:
    """If name is invalid for a new pet registration, return a PT-BR message; else None."""
    raw = (name or "").strip()
    if len(raw) < 2:
        return "Nome do pet inválido ou muito curto. Pergunte qual é o nome ou apelido que o dono usa no dia a dia."
    n = _norm_comp(raw)
    if n in _SPECIES_OR_GENERIC_NAMES:
        return (
            f"'{raw}' é espécie ou termo genérico, não nome de pet. "
            "Pergunte: 'Qual é o nome ou apelido dele?'"
        )
    if _PLACEHOLDER_NAME_RE.match(raw.strip()):
        return (
            "Esse nome parece genérico (ex.: cachorro 1, gato 2). "
            "Pergunte o nome ou apelido real que o dono usa."
        )
    if n in _FULL_BREED_PHRASES or n in _SINGLE_TOKEN_BREEDS:
        return (
            f"'{raw}' parece raça ou tipo de animal, não nome de pet. "
            "Pergunte: 'Qual é o nome ou apelido dele?'"
        )
    return None


def _normalize_size(size: str) -> str | None:
    """Normaliza porte para P/M/G/GG. Retorna None se inválido."""
    val = (size or "").strip()
    return SIZE_MAP.get(val) or SIZE_MAP.get(val.lower()) or SIZE_MAP.get(val.upper())


def _merge_upcoming_appointment_rows(rows: list) -> list:
    """
    Une pares __DOUBLE_PAIR__ em um único item com faixa de horário,
    para o agente não confundir dois registros (ex.: 15h e 16h) com dois serviços.
    """

    def _eff_from_row(row: dict) -> int:
        return _effective_service_duration_minutes(
            {
                "duration_min": row.get("duration_min"),
                "duration_multiplier_large": row.get("duration_multiplier_large"),
            },
            {"size": row.get("pet_size")},
        )

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
            first, second = (r, partner) if t_a <= t_b else (partner, r)
            t1 = slot_time_to_hhmm(first.get("start_time_raw"))
            t2 = slot_time_to_hhmm(second.get("start_time_raw"))
            dur_eff = _eff_from_row(first)
            end_br = hhmm_after_minutes(t1, dur_eff)
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
                    "service_duration_minutes": dur_eff,
                    "uses_double_slot": True,
                }
            )
            continue
        st = slot_time_to_hhmm(r.get("start_time_raw"))
        dur_eff = _eff_from_row(r)
        out.append(
            {
                "id": rid,
                "scheduled_date": r.get("scheduled_date"),
                "status": r.get("status"),
                "service_name": r.get("service_name"),
                "pet_name": r.get("pet_name"),
                "start_time": st,
                "service_end_time": hhmm_after_minutes(st, dur_eff) if st else None,
                "service_duration_minutes": dur_eff,
                "uses_double_slot": False,
            }
        )
    return out


def fetch_upcoming_appointments_snapshot(company_id: int, client_id: str) -> list | None:
    """Executa a mesma leitura de get_upcoming_appointments sem tool calling."""
    if not client_id or not str(client_id).strip():
        return None
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
                svc.duration_multiplier_large,
                p.size AS pet_size,
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


def build_client_tools(company_id: int, client_id: str) -> list:
    """
    Retorna as tools de cliente com company_id e client_id pré-vinculados via closure.
    A LLM nunca recebe os IDs como parâmetro — ela só preenche o que realmente importa.
    """

    def get_client_pets() -> dict:
        """
        Lista os pets ativos do cliente.
        Use para validar nome, UUID e porte antes de cadastro ou agenda.
        """
        if client_id:
            cached = cache_get_client_pets(company_id, str(client_id))
            if cached is not None:
                return {**cached, "from_cache": True}
        return fetch_client_pets_snapshot(company_id, str(client_id)) or {"pets": [], "count": 0}

    def create_pet(name: str, species: str, breed: str, size: str) -> dict:
        """
        Cadastra um novo pet ou atualiza o porte de um pet existente sem porte.

        Regras:
        - Exige nome, espécie, raça e porte
        - Não invente dados nem use raça como nome
        - Use só 'cachorro' ou 'gato' em species
        - Porte: P (até 7 kg), M (7-15 kg), G (15-25 kg), GG (acima de 25 kg)
        - Se o pet já existe MAS sem porte definido, atualiza o porte

        Args:
            name: Apelido real do pet
            species: 'cachorro' ou 'gato'
            breed: Raça real, ou 'Sem raça definida' só se o cliente disser
            size: Porte confirmado ('P', 'M', 'G' ou 'GG')
        """
        missing = []
        if not name or not name.strip():
            missing.append("nome")
        if not species or not species.strip():
            missing.append("espécie (cachorro ou gato)")
        if not breed or not breed.strip():
            missing.append("raça (ou 'Sem raça definida' se não souber)")
        if not size or not size.strip():
            missing.append("porte (P, M, G ou GG)")

        if missing:
            return {
                "success": False,
                "missing_fields": missing,
                "message": f"Faltam dados: {', '.join(missing)}. Pergunte ao cliente.",
            }

        # Normalize breed
        breed_raw = breed.strip()
        breed_l = breed_raw.lower()
        if breed_l in ("srd", "sem raça definida", "sem raca definida"):
            breed_for_db = "Sem raça definida"
        else:
            breed_for_db = breed_raw

        # Validate name
        name_err = _pet_display_name_error(name)
        if name_err:
            return {"success": False, "name_is_breed": True, "message": name_err}

        if breed_l not in ("srd", "sem raça definida", "sem raca definida") and _norm_comp(
            name
        ) == _norm_comp(breed_raw):
            return {
                "success": False,
                "message": "Nome e raça não podem ser iguais. Pergunte o nome ou apelido real.",
            }

        # Validate species
        species_norm = species.lower().strip()
        if species_norm not in ("cachorro", "gato"):
            return {"success": False, "message": "Espécie inválida. Use 'cachorro' ou 'gato'."}

        # Validate breed
        if breed_l not in ("srd", "sem raça definida", "sem raca definida"):
            bn = _norm_comp(breed_raw)
            if bn in _BREED_CANNOT_BE_SPECIES_WORD or bn == _norm_comp(species_norm):
                return {
                    "success": False,
                    "message": (
                        "A raça precisa descrever o animal (ex.: Persa, Labrador, SRD), "
                        "não pode ser só 'gato' ou 'cachorro'. Se não souber, use 'Sem raça definida'."
                    ),
                }

        # Validate size
        size_db = _normalize_size(size)
        if not size_db:
            return {
                "success": False,
                "missing_fields": ["porte (P, M, G ou GG)"],
                "message": f"Porte inválido. Referência: {PET_SIZE_WEIGHT_REFERENCE_PT}",
            }

        name_key = (name or "").strip()

        with get_connection() as conn:
            cur = conn.cursor()

            # Check if pet already exists
            cur.execute(
                """
                SELECT id, name, size FROM petshop_pets
                WHERE company_id = %s AND client_id = %s
                  AND LOWER(name) = LOWER(%s) AND is_active = TRUE
            """,
                (company_id, client_id, name_key),
            )
            existing = cur.fetchone()

            if existing:
                existing = dict(existing)
                # Pet exists but missing size → update it
                if not existing.get("size") or existing["size"].strip() in ("", "?"):
                    cur.execute(
                        """
                        UPDATE petshop_pets SET size = %s
                        WHERE id = %s AND company_id = %s
                        RETURNING id, name
                    """,
                        (size_db, existing["id"], company_id),
                    )
                    cache_invalidate_client_pets(company_id, str(client_id))
                    size_label = SIZE_LABEL.get(size_db, size_db)
                    return {
                        "success": True,
                        "pet_id": str(existing["id"]),
                        "pet_updated": True,
                        "message": f"Porte de {existing['name']} atualizado para {size_label}.",
                    }
                # Pet exists with size already set
                return {
                    "success": False,
                    "message": f"Já existe um pet chamado {name_key} cadastrado.",
                }

            # Create new pet
            cur.execute(
                """
                INSERT INTO petshop_pets (company_id, client_id, name, species, breed, size)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
            """,
                (company_id, client_id, name_key, species_norm, breed_for_db, size_db),
            )
            pet_id = cur.fetchone()["id"]

            # Auto-advance stage
            if client_id:
                cur.execute(
                    """
                    UPDATE clients
                    SET conversation_stage = 'pet_registered', updated_at = NOW()
                    WHERE id = %s AND company_id = %s
                """,
                    (client_id, company_id),
                )

        cache_invalidate_client_pets(company_id, str(client_id))
        return {
            "success": True,
            "pet_id": str(pet_id),
            "message": f"{name_key} cadastrado!",
        }

    def update_pet_size(pet_name: str, size: str) -> dict:
        """
        Atualiza o porte de um pet já cadastrado.
        Use quando o pet existe em get_client_pets mas o porte está vazio ou precisa ser corrigido.

        Args:
            pet_name: Nome do pet (como retornado por get_client_pets)
            size: Novo porte ('P', 'M', 'G' ou 'GG')
        """
        if not pet_name or not pet_name.strip():
            return {"success": False, "message": "Informe o nome do pet."}

        size_db = _normalize_size(size)
        if not size_db:
            return {
                "success": False,
                "message": f"Porte inválido. Referência: {PET_SIZE_WEIGHT_REFERENCE_PT}",
            }

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
                (size_db, company_id, client_id, pet_name.strip()),
            )
            updated = cur.fetchone()

        if not updated:
            return {"success": False, "message": f"Pet '{pet_name}' não encontrado no cadastro."}

        cache_invalidate_client_pets(company_id, str(client_id))
        size_label = SIZE_LABEL.get(size_db, size_db)
        return {
            "success": True,
            "pet_id": str(updated["id"]),
            "size": size_db,
            "size_label": size_label,
            "message": f"Porte de {updated['name']} atualizado para {size_label}.",
        }

    def get_upcoming_appointments() -> list:
        """Retorna os próximos agendamentos confirmados ou pendentes do cliente."""
        return fetch_upcoming_appointments_snapshot(company_id, str(client_id)) or []

    return [
        get_client_pets,
        create_pet,
        update_pet_size,
        get_upcoming_appointments,
    ]
