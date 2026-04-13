"""
Cache curto em Redis para resultados de tools de agendamento (menos round-trips ao DB
e menos repetição de chamadas pelo modelo quando o bloco CACHE é injetado no input).
"""

from __future__ import annotations

import json
import logging

import redis as sync_redis

from config import REDIS_HOST, REDIS_PORT, REDIS_PASSWORD

logger = logging.getLogger("ai-service.tool_result_cache")

_PREFIX = "auzap:tc"
SERVICES_TTL_SEC = 300
CLIENT_PETS_TTL_SEC = 180


def _redis() -> sync_redis.Redis:
    return sync_redis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        password=REDIS_PASSWORD or None,
        decode_responses=True,
    )


def _json_dumps(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str)


def cache_get_services(company_id: int) -> dict | None:
    try:
        r = _redis()
        raw = r.get(f"{_PREFIX}:svc:{company_id}")
        r.close()
        if not raw:
            return None
        return json.loads(raw)
    except Exception as e:
        logger.warning("cache_get_services falhou: %s", e)
        return None


def cache_set_services(company_id: int, payload: dict) -> None:
    to_store = {k: v for k, v in payload.items() if k != "from_cache"}
    try:
        r = _redis()
        r.setex(
            f"{_PREFIX}:svc:{company_id}",
            SERVICES_TTL_SEC,
            _json_dumps(to_store),
        )
        r.close()
    except Exception as e:
        logger.warning("cache_set_services falhou: %s", e)


def cache_get_client_pets(company_id: int, client_id: str) -> dict | None:
    if not client_id or not str(client_id).strip():
        return None
    key = f"{_PREFIX}:pets:{company_id}:{client_id}"
    try:
        r = _redis()
        raw = r.get(key)
        r.close()
        if not raw:
            return None
        return json.loads(raw)
    except Exception as e:
        logger.warning("cache_get_client_pets falhou: %s", e)
        return None


def cache_set_client_pets(company_id: int, client_id: str, payload: dict) -> None:
    if not client_id or not str(client_id).strip():
        return
    to_store = {k: v for k, v in payload.items() if k != "from_cache"}
    key = f"{_PREFIX}:pets:{company_id}:{client_id}"
    try:
        r = _redis()
        r.setex(key, CLIENT_PETS_TTL_SEC, _json_dumps(to_store))
        r.close()
    except Exception as e:
        logger.warning("cache_set_client_pets falhou: %s", e)


def cache_invalidate_client_pets(company_id: int, client_id: str) -> None:
    if not client_id or not str(client_id).strip():
        return
    key = f"{_PREFIX}:pets:{company_id}:{client_id}"
    try:
        r = _redis()
        r.delete(key)
        r.close()
    except Exception as e:
        logger.warning("cache_invalidate_client_pets falhou: %s", e)


SLOT_TTL_SEC = 600  # 10 minutos


def cache_set_slots(company_id: int, client_id: str, slots: list) -> None:
    """Armazena slots retornados por get_available_times no Redis (TTL 10 min)."""
    if not client_id or not slots:
        return
    try:
        r = _redis()
        for slot in slots:
            sid = slot.get("slot_id")
            if not sid:
                continue
            key = f"{_PREFIX}:slot:{company_id}:{client_id}:{sid}"
            r.setex(key, SLOT_TTL_SEC, _json_dumps(slot))
        r.close()
    except Exception as e:
        logger.warning("cache_set_slots falhou: %s", e)


def cache_get_slot(company_id: int, client_id: str, slot_id: str) -> dict | None:
    """Recupera um slot do cache pelo slot_id temporário."""
    if not client_id or not slot_id:
        return None
    key = f"{_PREFIX}:slot:{company_id}:{client_id}:{slot_id}"
    try:
        r = _redis()
        raw = r.get(key)
        r.close()
        if not raw:
            return None
        return json.loads(raw)
    except Exception as e:
        logger.warning("cache_get_slot falhou: %s", e)
        return None


def build_booking_tool_cache_hint(context: dict, router_ctx: dict | None = None) -> str:
    """
    Texto opcional anexado ao input do booking_agent com último snapshot válido no Redis.

    Não inclui snapshot de get_client_pets: listas antigas levavam o modelo a afirmar que um pet
    novo na mensagem «já estava cadastrado» sem chamar a tool neste turno.
    """
    cid = context.get("company_id")
    if cid is None:
        return ""
    try:
        company_id = int(cid)
    except (TypeError, ValueError):
        return ""

    svc = cache_get_services(company_id)
    if not svc:
        try:
            from tools.booking_tools import fetch_services_snapshot

            warmed = fetch_services_snapshot(company_id)
            cache_set_services(
                company_id,
                {"services": warmed["services"], "count": warmed["count"]},
            )
            svc = cache_get_services(company_id) or {
                "services": warmed["services"],
                "count": warmed["count"],
                "lodging_offerings": warmed.get("lodging_offerings", []),
                "lodging_offerings_count": warmed.get("lodging_offerings_count", 0),
            }
            logger.info(
                "CACHE | get_services aquecido antes do especialista | company_id=%s count=%s",
                company_id,
                warmed["count"],
            )
        except Exception as exc:
            logger.warning("CACHE | falha ao aquecer get_services: %s", exc)
            svc = None

    if not svc:
        return ""

    services_data = dict(svc)
    agent_name = (router_ctx or {}).get("agent", "")
    if agent_name != "lodging_agent":
        services_data.pop("lodging_offerings", None)
        services_data.pop("lodging_offerings_count", None)

    lines = [
        "",
        "",
        "━━━ CACHE RECENTE (servidor — TTL curto) ━━━",
        "Abaixo pode haver dados recentes do servidor para reduzir tool calls repetidas neste turno.",
        "Para pets (lista, UUID, porte, confirmar se um **nome** existe), siga usando **get_client_pets** "
        "quando o fluxo exigir ou quando o cliente citar um pet novo.",
        "Se a mensagem atual não exige catálogo novo (ex.: confirmação com mesmo serviço), pode usar o JSON "
        "de serviços **sem** chamar get_services de novo. **Exceção:** pedido de **lista completa** / **tudo que o petshop oferece** / **quais serviços** → chame **get_services** neste turno (o JSON abaixo pode não trazer `lodging_offerings`; a tool devolve hotel/creche quando existir).",
    ]
    lines.append("Último get_services:")
    lines.append(_json_dumps(services_data))
    return "\n".join(lines)


def build_pets_cache_hint(context: dict) -> str:
    """Pré-executa get_client_pets e injeta o snapshot no input do especialista."""
    cid = context.get("company_id")
    client = context.get("client") or {}
    client_id = client.get("id")
    if cid is None or not client_id:
        return ""
    try:
        company_id = int(cid)
    except (TypeError, ValueError):
        return ""

    try:
        from tools.client_tools import fetch_client_pets_snapshot

        result = fetch_client_pets_snapshot(company_id, str(client_id))
        if not result:
            return ""
        logger.info(
            "CACHE | get_client_pets pré-executado | company_id=%s client_id=%s pets=%s",
            company_id,
            client_id,
            result.get("count", 0),
        )
        return (
            "\n\n━━━ CACHE RECENTE — PETS (servidor) ━━━\n"
            "Resultado de get_client_pets executado agora. Use estes dados para os pets já conhecidos.\n"
            "Se o cliente mencionar um pet novo ou trocar o pet em foco, chame get_client_pets de novo neste turno.\n"
            f"Último get_client_pets: {_json_dumps(result)}"
        )
    except Exception as exc:
        logger.warning("CACHE | falha ao pré-executar get_client_pets: %s", exc)
        return ""


def build_upcoming_appointments_hint(context: dict, router_ctx: dict) -> str:
    """Pré-executa get_upcoming_appointments quando o turno tende a precisar da lista."""
    stage = (router_ctx.get("stage") or "").upper()
    agent = router_ctx.get("agent", "")
    if stage not in {"SCHEDULING", "AWAITING_CONFIRMATION"} and agent not in {
        "booking_agent",
        "health_agent",
    }:
        return ""

    cid = context.get("company_id")
    client = context.get("client") or {}
    client_id = client.get("id")
    if cid is None or not client_id:
        return ""
    try:
        company_id = int(cid)
    except (TypeError, ValueError):
        return ""

    try:
        from tools.client_tools import fetch_upcoming_appointments_snapshot

        result = fetch_upcoming_appointments_snapshot(company_id, str(client_id))
        if result is None:
            return ""
        logger.info(
            "CACHE | get_upcoming_appointments pré-executado | company_id=%s client_id=%s count=%s",
            company_id,
            client_id,
            len(result),
        )
        return (
            "\n\n━━━ CACHE RECENTE — AGENDAMENTOS FUTUROS (servidor) ━━━\n"
            "Resultado de get_upcoming_appointments executado agora. Use estes dados para confirmar, remarcar ou cancelar sem repetir a leitura se nada mudou neste turno.\n"
            f"Último get_upcoming_appointments: {_json_dumps(result)}"
        )
    except Exception as exc:
        logger.warning("CACHE | falha ao pré-executar get_upcoming_appointments: %s", exc)
        return ""
