import os
import json
import redis.asyncio as aioredis
from typing import List

# TTL do histórico: 24 horas
HISTORY_TTL = 60 * 60 * 24

# Máximo de mensagens mantidas no contexto do agente
MAX_HISTORY_MESSAGES = 20


def _redis_client():
    return aioredis.Redis(
        host=os.getenv("REDIS_HOST", "localhost"),
        port=int(os.getenv("REDIS_PORT", 6379)),
        password=os.getenv("REDIS_PASSWORD") or None,
        decode_responses=True,
    )


def _key(company_id: int, client_phone: str) -> str:
    """Chave única por tenant + cliente."""
    return f"chat:{company_id}:{client_phone}"


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


async def clear_history(company_id: int, client_phone: str):
    """
    Limpa o histórico de uma conversa (útil após conclusão ou timeout).
    """
    r = _redis_client()
    try:
        await r.delete(_key(company_id, client_phone))
    finally:
        await r.aclose()
