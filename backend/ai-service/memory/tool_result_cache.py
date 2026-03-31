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


def build_booking_tool_cache_hint(context: dict) -> str:
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
        return ""

    lines = [
        "",
        "",
        "━━━ CACHE RECENTE (servidor — TTL curto) ━━━",
        "Só **get_services** abaixo. **Não** há cache de pets na entrada — para pets (lista, UUID, porte, "
        "confirmar se um **nome** existe) chame **get_client_pets** neste turno quando o fluxo exigir.",
        "Se a mensagem atual não exige catálogo novo (ex.: confirmação com mesmo serviço), pode usar o JSON "
        "de serviços **sem** chamar get_services de novo. Chame get_services de novo se mudou o serviço ou houver dúvida.",
    ]
    lines.append("Último get_services:")
    lines.append(_json_dumps(svc))
    return "\n".join(lines)
