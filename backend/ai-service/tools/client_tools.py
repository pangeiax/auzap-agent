import logging
import re
import unicodedata

import redis as sync_redis

from config import REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
from db import get_connection
from memory.tool_result_cache import (
    cache_get_client_pets,
    cache_invalidate_client_pets,
    cache_set_client_pets,
)
from tools.booking_tools import _effective_service_duration_minutes, _extract_double_pair_id
from tools.slot_time_utils import hhmm_after_minutes, slot_time_to_hhmm

logger = logging.getLogger("ai-service.tools.client")

PET_SIZE_GATE_PREFIX = "pet_size_gate"
PET_SIZE_GATE_TTL_SEC = 7200


def _pet_size_gate_key(company_id: int, client_id: str, pet_name: str) -> str:
    n = (pet_name or "").strip().lower()
    return f"{PET_SIZE_GATE_PREFIX}:{company_id}:{client_id}:{n}"


def _pet_size_gate_set(company_id: int, client_id: str, pet_name: str, size_db: str) -> None:
    if not client_id or not (pet_name or "").strip() or not size_db:
        return
    try:
        r = sync_redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            password=REDIS_PASSWORD or None,
            decode_responses=True,
        )
        r.setex(
            _pet_size_gate_key(company_id, client_id, pet_name),
            PET_SIZE_GATE_TTL_SEC,
            size_db,
        )
        r.close()
    except Exception as e:
        logger.warning("pet_size_gate set falhou: %s", e)


def _pet_size_gate_get(company_id: int, client_id: str, pet_name: str) -> tuple[str | None, bool]:
    """
    Retorna (porte confirmado P/M/G/GG ou None, redis_ok).
    None com redis_ok=True → chave não existe (set_pet_size ainda não foi chamado para este nome).
    """
    if not client_id or not (pet_name or "").strip():
        return (None, False)
    try:
        r = sync_redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            password=REDIS_PASSWORD or None,
            decode_responses=True,
        )
        v = r.get(_pet_size_gate_key(company_id, client_id, pet_name))
        r.close()
        return (v, True)
    except Exception as e:
        logger.warning("pet_size_gate get falhou: %s", e)
        return (None, False)


def _pet_size_gate_delete(company_id: int, client_id: str, pet_name: str) -> None:
    if not client_id or not (pet_name or "").strip():
        return
    try:
        r = sync_redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            password=REDIS_PASSWORD or None,
            decode_responses=True,
        )
        r.delete(_pet_size_gate_key(company_id, client_id, pet_name))
        r.close()
    except Exception as e:
        logger.warning("pet_size_gate delete falhou: %s", e)


def _norm_comp(s: str) -> str:
    """Lowercase + strip accents for robust comparisons."""
    s = unicodedata.normalize("NFD", (s or "").strip().lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


# Nome não pode ser espécie, placeholder numérico ou parecer raça (evita cadastros "gato", "buldog", "cachorro 2").
_SPECIES_OR_GENERIC_NAMES = frozenset(
    _norm_comp(x)
    for x in (
        "gato",
        "gata",
        "gatinho",
        "gatinha",
        "cachorro",
        "cachorra",
        "cachorrinho",
        "cachorrinha",
        "cão",
        "cadela",
        "dog",
        "cat",
        "pet",
        "animal",
        "bicho",
        "filhote",
        "filhota",
        "canino",
        "felino",
    )
)

# Raça não pode ser só a espécie (evita LLM passar breed="gato" com species="gato").
_BREED_CANNOT_BE_SPECIES_WORD = frozenset(
    _norm_comp(x)
    for x in (
        "gato",
        "gata",
        "gatinho",
        "gatinha",
        "cachorro",
        "cachorra",
        "cachorrinho",
        "cachorrinha",
        "cão",
        "cadela",
        "dog",
        "cat",
        "felino",
        "canino",
    )
)

_PLACEHOLDER_NAME_RE = re.compile(
    r"^(cachorro|gato|cão|cao|pet|dog|cat|animal|bicho)(\s*[0-9]+)?$",
    re.IGNORECASE,
)

# Frases ou tokens que o modelo costuma usar como "nome" mas são raça/tipo.
_FULL_BREED_PHRASES = frozenset(
    _norm_comp(x)
    for x in (
        "bull terrier",
        "golden retriever",
        "labrador retriever",
        "yorkshire terrier",
        "border collie",
        "cocker spaniel",
        "bichon frise",
        "cavalier king charles",
        "basset hound",
        "great dane",
        "são bernardo",
        "sao bernardo",
        "saint bernard",
        "american bully",
        "french bulldog",
        "bulldog francês",
        "bulldog frances",
        "pastor alemão",
        "pastor alemao",
        "german shepherd",
        "pit bull",
        "shih tzu",
        "chow chow",
        "bichon frisé",
        "lhasa apso",
    )
)

_SINGLE_TOKEN_BREEDS = frozenset(
    _norm_comp(x)
    for x in (
        "bulldog",
        "buldog",
        "buldogue",
        "labrador",
        "poodle",
        "beagle",
        "dachshund",
        "husky",
        "pug",
        "rottweiler",
        "chihuahua",
        "dobermann",
        "doberman",
        "boxer",
        "collie",
        "maltês",
        "maltese",
        "pitbull",
        "shiba",
        "akita",
        "dálmata",
        "dalmatian",
        "schnauzer",
        "persa",
        "siamês",
        "siames",
        "siamese",
        "angorá",
        "angora",
        "srd",
        "golden",
        "yorkshire",
        "lhasa",
        "lab",
    )
)


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


def _price_key_from_db_size(size_db: str) -> str | None:
    return {"P": "small", "M": "medium", "G": "large", "GG": "xlarge"}.get(size_db)


def _porte_label_for_key(price_key: str | None) -> str | None:
    if not price_key:
        return None
    return {
        "small": "pequeno",
        "medium": "médio",
        "large": "grande",
        "xlarge": "extra grande",
        "extra_large": "extra grande",
    }.get(price_key)


def _services_pricing_snapshot(cur, company_id: int, size_db: str) -> str:
    """Mesma lógica do sales_prompt, para a tool devolver preços na mesma mensagem após set_pet_size."""
    pk = _price_key_from_db_size(size_db)
    plab = _porte_label_for_key(pk)
    cur.execute(
        """
        SELECT name, description, duration_min, price, price_by_size
        FROM petshop_services
        WHERE company_id = %s AND is_active = TRUE
        ORDER BY name
        """,
        (company_id,),
    )
    lines: list[str] = []
    for row in cur.fetchall():
        s = dict(row)
        if s.get("price_by_size"):
            sz = s["price_by_size"]
            if pk:
                val = sz.get(pk)
                price = (
                    f"R${val} (porte {plab})"
                    if val is not None
                    else "consultar (preço por porte)"
                )
            else:
                price = "preço conforme porte"
        elif s.get("price"):
            price = f"R${s['price']}"
        else:
            price = "consultar"
        desc = f" — {s['description']}" if s.get("description") else ""
        lines.append(f"  • {s['name']}: {price} ({s.get('duration_min', '?')} min){desc}")

    cur.execute(
        """
        SELECT hotel_enabled, hotel_daily_rate, hotel_checkin_time, hotel_checkout_time,
               daycare_enabled, daycare_daily_rate, daycare_checkin_time, daycare_checkout_time
        FROM petshop_lodging_config
        WHERE company_id = %s
        """,
        (company_id,),
    )
    lc = cur.fetchone()
    if lc:
        lodging_config = dict(lc)
        for field in (
            "hotel_checkin_time",
            "hotel_checkout_time",
            "daycare_checkin_time",
            "daycare_checkout_time",
        ):
            t = lodging_config.get(field)
            lodging_config[field] = str(t)[:5] if t else None
        if lodging_config.get("hotel_enabled"):
            rate = lodging_config.get("hotel_daily_rate")
            rate_str = f"R${float(rate):.2f}/dia" if rate else "consultar"
            cin = (lodging_config.get("hotel_checkin_time") or "")[:5]
            cout = (lodging_config.get("hotel_checkout_time") or "")[:5]
            hours_str = f" (check-in {cin}, check-out {cout})" if cin and cout else ""
            lines.append(
                f"  • Hotel para pets: {rate_str}{hours_str} — hospedagem noturna com acompanhamento"
            )
        if lodging_config.get("daycare_enabled"):
            rate = lodging_config.get("daycare_daily_rate")
            rate_str = f"R${float(rate):.2f}/dia" if rate else "consultar"
            cin = (lodging_config.get("daycare_checkin_time") or "")[:5]
            cout = (lodging_config.get("daycare_checkout_time") or "")[:5]
            hours_str = f" (entrada {cin}, saída {cout})" if cin and cout else ""
            lines.append(
                f"  • Creche diurna: {rate_str}{hours_str} — cuidado diurno enquanto você trabalha. "
                f"No cadastro, a data de fim do período é o dia seguinte ao último dia na creche (fim exclusivo)."
            )

    return "\n".join(lines) if lines else "  nenhum cadastrado"


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
        if client_id:
            cached = cache_get_client_pets(company_id, str(client_id))
            if cached is not None:
                return {**cached, "from_cache": True}
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
        if client_id:
            cache_set_client_pets(company_id, str(client_id), out)
        return out

    def create_pet(name: str, species: str, breed: str, size: str) -> dict:
        """
        Cadastra um novo pet para o cliente.
        TODOS os 4 campos são OBRIGATÓRIOS — incluindo o porte.
        O porte DEVE ter sido perguntado e informado EXPLICITAMENTE pelo cliente.
        NUNCA deduza o porte pela raça — sempre pergunte antes de chamar esta tool.

        **Obrigatório:** antes de `create_pet`, chame **set_pet_size** com o **mesmo nome** do pet e o porte que o
        **cliente disse**. Sem isso, `create_pet` é **rejeitado** pelo sistema (evita porte inventado pela IA).
        O `size` passado em `create_pet` deve ser **idêntico** ao confirmado em `set_pet_size`.

        ATENÇÃO — RAÇA NÃO É NOME:
        Raças são palavras como: "Bull Terrier", "Golden Retriever", "Labrador", "Poodle",
        "Shih Tzu", "Yorkshire", "Bulldog", "Beagle", "Dachshund", "Husky", "Pastor Alemão",
        "Lhasa Apso", "Maltês", "Rottweiler", "Chihuahua", "Pug", "Dobermann", "Sem raça definida" etc.
        Se o cliente mencionar apenas uma raça, NÃO use a raça como nome — pergunte qual é
        o nome/apelido do pet antes de prosseguir. O nome é o apelido dado pelo dono
        (ex: "Rex", "Bolinha", "Max", "Luna", "Mel", "Toby").

        PROIBIDO inventar dados: nome genérico (gato, cachorro 1), raça "Sem raça definida"
        sem o cliente ter dito que não sabe, ou porte padrão — o sistema rejeita nomes inválidos.

        Se o cliente **já informou** os quatro campos em mensagens anteriores (mesmo em várias linhas),
        **chame esta tool** em vez de perguntar de novo o mesmo dado — repetir pergunta já respondida é erro.

        Args:
            name: Nome/apelido do pet dado pelo dono (NÃO pode ser uma raça)
            species: Espécie — 'cachorro' ou 'gato'
            breed: Raça real (ex.: Persa, Labrador, SRD) — **não** use só "gato" ou "cachorro" como raça;
                   'Sem raça definida' somente se o cliente disser explicitamente que não sabe (a API rejeita raça = espécie).
            size: Porte — 'P', 'M', 'G' ou 'GG' (DEVE ter sido PERGUNTADO ao cliente)
        """
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

        name_err = _pet_display_name_error(name)
        if name_err:
            return {
                "success": False,
                "name_is_breed": True,
                "message": name_err,
            }

        if breed_l not in ("srd", "sem raça definida", "sem raca definida") and _norm_comp(
            name
        ) == _norm_comp(breed_raw):
            return {
                "success": False,
                "message": (
                    "Nome e raça não podem ser iguais. "
                    "Pergunte o nome ou apelido que o dono usa no dia a dia."
                ),
            }

        species_norm = species.lower().strip()
        size_norm = size.lower().strip()

        if species_norm not in ("cachorro", "gato"):
            return {
                "success": False,
                "message": "Espécie inválida. Use 'cachorro' ou 'gato'.",
            }

        if breed_l not in ("srd", "sem raça definida", "sem raca definida"):
            bn = _norm_comp(breed_raw)
            if bn in _BREED_CANNOT_BE_SPECIES_WORD or bn == _norm_comp(species_norm):
                return {
                    "success": False,
                    "message": (
                        "A raça precisa descrever o animal (ex.: Persa, Siames, Labrador, SRD), "
                        "não pode ser só 'gato' ou 'cachorro'. Pergunte de forma natural; "
                        "se o cliente não souber a raça, confirme e use 'Sem raça definida'."
                    ),
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

        name_key = (name or "").strip()
        if client_id:
            gated, redis_ok = _pet_size_gate_get(company_id, client_id, name_key)
            if redis_ok:
                if gated is None:
                    return {
                        "success": False,
                        "porte_nao_confirmado": True,
                        "message": (
                            "Porte ainda não foi confirmado via set_pet_size para este nome. "
                            "Pergunte ao cliente o porte, chame set_pet_size com o mesmo nome do pet, "
                            "depois create_pet com o mesmo porte — não assuma P/M/G."
                        ),
                    }
                if gated != size_db:
                    return {
                        "success": False,
                        "message": (
                            f"O porte em create_pet ({size_db}) difere do confirmado em set_pet_size ({gated}). "
                            "Use o mesmo valor ou chame set_pet_size de novo se o cliente corrigir."
                        ),
                    }

        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id FROM petshop_pets
                WHERE company_id = %s AND client_id = %s
                  AND LOWER(name) = LOWER(%s) AND is_active = TRUE
            """,
                (company_id, client_id, name_key),
            )
            if cur.fetchone():
                return {
                    "success": False,
                    "message": f"Já existe um pet chamado {name_key} cadastrado.",
                }

            cur.execute(
                """
                INSERT INTO petshop_pets (company_id, client_id, name, species, breed, size)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
            """,
                (company_id, client_id, name_key, species_norm, breed_for_db, size_db),
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

        _pet_size_gate_delete(company_id, client_id, name_key)

        cache_invalidate_client_pets(company_id, str(client_id))
        return {
            "success": True,
            "pet_id": str(pet_id),
            "message": f"{name_key} cadastrado com sucesso!",
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
        if not pet_name or not pet_name.strip():
            return {
                "success": False,
                "message": "Informe o nome do pet para confirmar o porte (o mesmo nome que usará em create_pet).",
            }

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

        updated = None
        services_pricing_for_reply = ""
        with get_connection() as conn:
            cur = conn.cursor()
            if client_id and pet_name and pet_name.strip():
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
            if not updated and client_id:
                cur.execute(
                    """
                    SELECT id FROM petshop_pets
                    WHERE company_id = %s AND client_id = %s AND is_active = TRUE
                    """,
                    (company_id, client_id),
                )
                pet_rows = cur.fetchall()
                if len(pet_rows) == 1:
                    cur.execute(
                        """
                        UPDATE petshop_pets
                        SET size = %s
                        WHERE id = %s AND company_id = %s AND client_id = %s AND is_active = TRUE
                        RETURNING id, name
                        """,
                        (size_db, pet_rows[0]["id"], company_id, client_id),
                    )
                    updated = cur.fetchone()
            services_pricing_for_reply = _services_pricing_snapshot(cur, company_id, size_db)

        if not updated and pet_name and pet_name.strip():
            pn_err = _pet_display_name_error(pet_name)
            if pn_err:
                return {"success": False, "message": pn_err}

        base_out = {
            "success": True,
            "size": size_db,
            "size_label": size_label,
            "services_pricing_for_reply": services_pricing_for_reply,
        }
        if client_id and pet_name and pet_name.strip():
            _pet_size_gate_set(company_id, client_id, pet_name.strip(), size_db)

        if updated:
            cache_invalidate_client_pets(company_id, str(client_id))
            return {
                **base_out,
                "pet_updated": True,
                "message": f"Porte de {updated['name']} confirmado como {size_label}!",
            }
        return {
            **base_out,
            "pet_updated": False,
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

    return [
        get_client_pets,
        create_pet,
        set_pet_size,
        advance_stage,
        get_upcoming_appointments,
    ]
