"""
Resumo rolante: mensagens além das últimas MAX_HISTORY_MESSAGES viram texto estruturado.
Atualização em blocos de 6 mensagens (HISTORY_SUMMARY_CHUNK), modelo gpt-4o-mini.
"""

import json
import logging
import os

from openai import AsyncOpenAI

from memory.redis_memory import (
    MAX_HISTORY_MESSAGES,
    delete_summary_state,
    get_summary_state,
    set_summary_state,
    _key,
    _redis_client,
)

logger = logging.getLogger("ai-service.history_summary")

_SUMMARY_MODEL_DEFAULT = "gpt-4o-mini"
_MAX_MSG_CHARS = 3500


def _summary_enabled() -> bool:
    v = (os.getenv("HISTORY_SUMMARY_ENABLED") or "true").strip().lower()
    return v not in ("0", "false", "no", "off")


def _chunk_size() -> int:
    try:
        return max(1, int(os.getenv("HISTORY_SUMMARY_CHUNK", "6")))
    except ValueError:
        return 6


def _summary_model() -> str:
    return (os.getenv("OPENAI_MODEL_SUMMARY") or _SUMMARY_MODEL_DEFAULT).strip()


def _format_messages_block(messages: list[dict]) -> str:
    lines: list[str] = []
    for m in messages:
        role = m.get("role") or "user"
        raw = (m.get("content") or "").strip()
        if len(raw) > _MAX_MSG_CHARS:
            raw = raw[:_MAX_MSG_CHARS] + " […]"
        label = "Cliente" if role == "user" else "Assistente"
        lines.append(f"{label}: {raw}")
    return "\n".join(lines)


_STRUCTURE_INSTRUCTIONS = """Use SEMPRE este esqueleto (omitir linhas cuja informação não exista):

**Cliente / tom:**
**Pets:**
**Serviço ou intenção:**
**Datas e horários:**
**Estado do fluxo:** (ex.: aguardando confirmação, escolheu horário, encerramento)
**Observações:**

Regras: frases curtas; português do Brasil; fatos só das mensagens; sem inventar preços ou horários.
Se houver lista enorme de serviços/preços, resuma numa linha (ex.: «viu catálogo de serviços») sem copiar tabela.
"""


async def _llm_merge_summary(previous: str, messages: list[dict]) -> str:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        logger.warning("history_summary | OPENAI_API_KEY ausente — pulando merge")
        return previous

    block = _format_messages_block(messages)
    if not block.strip():
        return previous

    client = AsyncOpenAI(api_key=api_key)
    model = _summary_model()
    sys_prompt = (
        "Você atualiza o resumo estruturado de um atendimento WhatsApp de petshop. "
        "Mescle o resumo anterior com as novas mensagens num único texto coerente. "
        + _STRUCTURE_INSTRUCTIONS
    )
    user_prompt = (
        f"RESUMO ANTERIOR:\n{previous.strip() or '(nenhum)'}\n\n"
        f"NOVAS MENSAGENS ({len(messages)} trocas):\n{block}\n\n"
        "Resumo estruturado unificado:"
    )
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_completion_tokens=700,
            temperature=0.15,
        )
        out = (resp.choices[0].message.content or "").strip()
        return out if out else previous
    except Exception:
        logger.exception("history_summary | falha ao chamar modelo %s", model)
        return previous


async def ensure_rolling_summary(company_id: int, client_phone: str) -> None:
    if not _summary_enabled():
        return

    r = _redis_client()
    try:
        key = _key(company_id, client_phone)
        L = await r.llen(key)
        if L <= MAX_HISTORY_MESSAGES:
            await delete_summary_state(company_id, client_phone)
            return

        start_recent = L - MAX_HISTORY_MESSAGES
        state = await get_summary_state(company_id, client_phone)
        text = (state or {}).get("text") or ""
        covered = int((state or {}).get("covered") or 0)

        if covered > start_recent:
            text, covered = "", 0
            await set_summary_state(company_id, client_phone, text, covered)

        chunk = _chunk_size()
        while covered < start_recent:
            chunk_end = min(covered + chunk, start_recent)
            raw_msgs = await r.lrange(key, covered, chunk_end - 1)
            msgs = [json.loads(m) for m in raw_msgs]
            text = await _llm_merge_summary(text, msgs)
            covered = chunk_end
            await set_summary_state(company_id, client_phone, text, covered)
            logger.info(
                "history_summary | company=%s phone=%s covered=%s/%s model=%s chars=%s",
                company_id,
                client_phone,
                covered,
                start_recent,
                _summary_model(),
                len(text),
            )
    finally:
        await r.aclose()


async def summary_prefix_for_prompt(company_id: int, client_phone: str) -> str | None:
    if not _summary_enabled():
        return None
    state = await get_summary_state(company_id, client_phone)
    t = (state or {}).get("text") if state else None
    if not t or not str(t).strip():
        return None
    return str(t).strip()
