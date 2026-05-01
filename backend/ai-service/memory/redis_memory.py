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
IDENTITY_PARTIAL_TTL = HISTORY_TTL


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
    """Chave legada do antigo fluxo de recadastro determinístico. Mantida apenas
    para que `clear_history` continue removendo o estado de clientes que estavam
    no meio do fluxo antigo no momento do deploy."""
    return f"identity_mig:{company_id}:{client_phone}"


def _identity_partial_key(company_id: int, client_phone: str) -> str:
    """Chave dos dados parciais de cadastro acumulados pelo identity_agent
    entre turnos (nome, e-mail, telefone, CPF). Limpa após save_identity OK."""
    return f"identity_partial:{company_id}:{client_phone}"


async def get_identity_partial(company_id: int, client_phone: str) -> dict:
    r = _redis_client()
    try:
        raw = await r.get(_identity_partial_key(company_id, client_phone))
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return data if isinstance(data, dict) else {}
    finally:
        await r.aclose()


async def set_identity_partial(
    company_id: int, client_phone: str, partial: dict
) -> None:
    r = _redis_client()
    try:
        payload = json.dumps(partial or {}, ensure_ascii=False)
        await r.set(
            _identity_partial_key(company_id, client_phone),
            payload,
            ex=IDENTITY_PARTIAL_TTL,
        )
    finally:
        await r.aclose()


async def clear_identity_partial(company_id: int, client_phone: str) -> None:
    r = _redis_client()
    try:
        await r.delete(_identity_partial_key(company_id, client_phone))
    finally:
        await r.aclose()


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
            _identity_partial_key(company_id, client_phone),
        )
    finally:
        await r.aclose()


