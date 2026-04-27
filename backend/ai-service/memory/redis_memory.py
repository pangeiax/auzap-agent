import json
import os
from typing import List

import redis.asyncio as aioredis

# TTL do histórico: 24 horas
HISTORY_TTL = 60 * 60 * 24

# Últimas N mensagens (cruas) enviadas ao modelo; o restante fica no resumo rolante (Redis).
MAX_HISTORY_MESSAGES = 6
ROUTER_CTX_TTL = HISTORY_TTL
SUMMARY_TTL = HISTORY_TTL
IDENTITY_MIG_TTL = HISTORY_TTL


def _redis_client():
    password = os.getenv("REDIS_PASSWORD")

    return aioredis.Redis(
        host=os.getenv("REDIS_HOST", "localhost"),
        port=int(os.getenv("REDIS_PORT", 6379)),
        password=password if password else None,
        decode_responses=True,
    )


def _key(company_id: int, client_phone: str) -> str:
    """Chave única por tenant + cliente."""
    return f"chat:{company_id}:{client_phone}"


def _router_ctx_key(company_id: int, client_phone: str) -> str:
    return f"chat_router_ctx:{company_id}:{client_phone}"


def _summary_key(company_id: int, client_phone: str) -> str:
    return f"chat_summary:{company_id}:{client_phone}"


def _identity_mig_key(company_id: int, client_phone: str) -> str:
    return f"identity_mig:{company_id}:{client_phone}"


async def get_summary_state(company_id: int, client_phone: str) -> dict | None:
    r = _redis_client()
    try:
        raw = await r.get(_summary_key(company_id, client_phone))
        if not raw:
            return None
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None
        if not isinstance(data, dict):
            return None
        return {
            "text": str(data.get("text") or ""),
            "covered": int(data.get("covered") or 0),
        }
    finally:
        await r.aclose()


async def set_summary_state(company_id: int, client_phone: str, text: str, covered: int) -> None:
    r = _redis_client()
    try:
        payload = json.dumps({"text": text, "covered": covered}, ensure_ascii=False)
        await r.set(_summary_key(company_id, client_phone), payload, ex=SUMMARY_TTL)
    finally:
        await r.aclose()


async def delete_summary_state(company_id: int, client_phone: str) -> None:
    r = _redis_client()
    try:
        await r.delete(_summary_key(company_id, client_phone))
    finally:
        await r.aclose()


async def get_history(company_id: int, client_phone: str) -> List[dict]:
    """
    Retorna as últimas MAX_HISTORY_MESSAGES mensagens da conversa.
    Formato: [{"role": "user"|"assistant", "content": "..."}]
    """
    r = _redis_client()
    try:
        key = _key(company_id, client_phone)
        raw = await r.lrange(key, -MAX_HISTORY_MESSAGES, -1)
        return [json.loads(m) for m in raw]
    finally:
        await r.aclose()


async def save_message(company_id: int, client_phone: str, role: str, content: str):
    """
    Salva uma mensagem no histórico e renova o TTL.
    """
    r = _redis_client()
    try:
        key = _key(company_id, client_phone)
        message = json.dumps({"role": role, "content": content}, ensure_ascii=False)
        await r.rpush(key, message)
        await r.expire(key, HISTORY_TTL)
    finally:
        await r.aclose()


async def get_router_ctx(company_id: int, client_phone: str) -> dict | None:
    r = _redis_client()
    try:
        raw = await r.get(_router_ctx_key(company_id, client_phone))
        if not raw:
            return None
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None
        return data if isinstance(data, dict) else None
    finally:
        await r.aclose()


async def save_router_ctx(company_id: int, client_phone: str, router_ctx: dict | None):
    if not router_ctx:
        return
    r = _redis_client()
    try:
        await r.set(
            _router_ctx_key(company_id, client_phone),
            json.dumps(router_ctx, ensure_ascii=False),
            ex=ROUTER_CTX_TTL,
        )
    finally:
        await r.aclose()


async def clear_history(company_id: int, client_phone: str):
    """
    Limpa o histórico de uma conversa (útil após conclusão ou timeout).
    """
    r = _redis_client()
    try:
        await r.delete(
            _key(company_id, client_phone),
            _router_ctx_key(company_id, client_phone),
            _summary_key(company_id, client_phone),
            _identity_mig_key(company_id, client_phone),
        )
    finally:
        await r.aclose()


async def get_identity_migration_phase(company_id: int, client_phone: str) -> str | None:
    """Fase do fluxo de recadastro: None | awaiting_consent | awaiting_details | completed."""
    r = _redis_client()
    try:
        raw = await r.get(_identity_mig_key(company_id, client_phone))
        if not raw:
            return None
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None
        if isinstance(data, dict):
            p = data.get("phase")
            return str(p) if p else None
        return None
    finally:
        await r.aclose()


async def get_identity_migration_data(company_id: int, client_phone: str) -> dict:
    """Retorna dados parciais acumulados do fluxo de recadastro."""
    r = _redis_client()
    try:
        raw = await r.get(_identity_mig_key(company_id, client_phone))
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        if isinstance(data, dict):
            return data.get("partial", {})
        return {}
    finally:
        await r.aclose()


async def set_identity_migration_phase(
    company_id: int, client_phone: str, phase: str | None, partial: dict | None = None
) -> None:
    r = _redis_client()
    try:
        key = _identity_mig_key(company_id, client_phone)
        if not phase:
            await r.delete(key)
            return
        payload = {"phase": phase}
        if partial:
            payload["partial"] = partial
        await r.set(
            key,
            json.dumps(payload, ensure_ascii=False),
            ex=IDENTITY_MIG_TTL,
        )
    finally:
        await r.aclose()


async def clear_identity_migration_phase(company_id: int, client_phone: str) -> None:
    r = _redis_client()
    try:
        await r.delete(_identity_mig_key(company_id, client_phone))
    finally:
        await r.aclose()
