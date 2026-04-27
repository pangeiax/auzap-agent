import logging
import os
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()

from config import resolve_model_for_company
from context.loader import load_context
from memory.history_summary import ensure_rolling_summary, summary_prefix_for_prompt
from memory.message_sanitize import sanitize_assistant_for_history
from memory.redis_memory import (
    clear_history,
    delete_summary_state,
    get_history,
    get_router_ctx,
    save_message,
    save_router_ctx,
)
from agents.router import run_router
from identity_migration_flow import try_handle_identity_migration
from timezone_br import calendar_dates_reference_pt, today_sao_paulo, weekday_label_pt

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("ai-service")

app = FastAPI(title="Petshop AI Service")

_OPENAI_ERROR_PATTERNS = [
    "Could not finish the message",
    "max_tokens or model output limit was reached",
    "max_completion_tokens",
    "context length exceeded",
    "rate limit reached",
    "too many requests",
    "the model produced invalid content",
    "content_filter",
]


def _is_openai_error_message(reply: str) -> bool:
    if not reply:
        return False
    return any(p.lower() in reply.lower() for p in _OPENAI_ERROR_PATTERNS)


def _connection_fallback_reply(context: dict) -> str:
    """
    Mensagem ao cliente quando a IA falha (OpenAI/timeout/erro do agente).
    Inclui telefone do petshop quando cadastrado.
    """
    phone = (context.get("petshop_phone") or "").strip()
    company = (context.get("company_name") or "o estabelecimento").strip()
    base = (
        "Estamos com uma instabilidade na conexão por aqui e não consegui seguir com seu atendimento agora. "
        f"O ideal é falar direto com {company}"
    )
    if phone:
        return f"{base} pelo telefone {phone}."
    return f"{base} pelos canais oficiais da loja."

_openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))


# ─────────────────────────────────────────
# Schema da requisição
# ─────────────────────────────────────────
class AgentRequest(BaseModel):
    company_id: int
    client_phone: str
    message: str
    image_base64: Optional[str] = None


class AgentResponse(BaseModel):
    reply: str
    agent_used: str
    stage: Optional[str] = None


class ReactivateRequest(BaseModel):
    company_id: int
    client_phone: str


# ─────────────────────────────────────────
# Descreve imagem via visão (modelo em OPENAI_MODEL, default gpt-5)
# ─────────────────────────────────────────
async def describe_image(image_base64: str, caption: str = "", company_id: int | None = None) -> str:
    prompt = (
        "Descreva o conteúdo desta imagem em detalhes. "
        "Se houver texto, transcreva-o integralmente. "
        "Responda em português."
    )
    if caption:
        prompt += f"\n\nO usuário também enviou a seguinte legenda: '{caption}'"

    try:
        vision_model = resolve_model_for_company(os.getenv("OPENAI_MODEL", "gpt-5"), company_id)
        response = await _openai_client.chat.completions.create(
            model=vision_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_base64}",
                                "detail": "low",
                            },
                        },
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
            max_completion_tokens=500,
        )
        resolved = getattr(response, "model", None) or vision_model
        logger.info(
            "Vision concluída | requested_model=%s | response_model=%s",
            vision_model,
            resolved,
        )
        return (
            response.choices[0].message.content
            or "Imagem recebida, mas não foi possível descrever o conteúdo."
        )
    except Exception as e:
        logger.error("Erro ao descrever imagem via vision: %s", e)
        return "Imagem recebida, mas não foi possível descrever o conteúdo."


# ─────────────────────────────────────────
# POST /run
# Recebe mensagem do api-node e retorna resposta do agente
# ─────────────────────────────────────────
@app.post("/run", response_model=AgentResponse)
async def run_agent(req: AgentRequest):
    logger.info(
        "Requisição recebida | company_id=%s | phone=%s | has_image=%s | message=%.80r",
        req.company_id,
        req.client_phone,
        bool(req.image_base64),
        req.message,
    )
    try:
        # 1. Carrega contexto da company + petshop + cliente
        context = await load_context(req.company_id, req.client_phone)

        # Injeta data atual em America/Sao_Paulo
        _today_brt = today_sao_paulo()
        context["today"] = _today_brt.strftime("%d/%m/%Y")
        context["today_iso"] = _today_brt.isoformat()
        context["today_weekday"] = weekday_label_pt(_today_brt)
        context["calendar_dates_reference"] = calendar_dates_reference_pt(_today_brt, 10)
        context["calendar_router_reference"] = calendar_dates_reference_pt(_today_brt, 7)

        # 2. Se houver imagem, descreve via vision e monta mensagem enriquecida
        message_for_agent = req.message
        if req.image_base64:
            logger.info(
                "Descrevendo imagem via vision | company_id=%s | phone=%s",
                req.company_id,
                req.client_phone,
            )
            image_description = await describe_image(req.image_base64, req.message, req.company_id)
            logger.info("Descrição da imagem: %.120r", image_description)
            message_for_agent = (
                f"[📷 O usuário enviou uma imagem. Descrição: {image_description}]"
            )
            if req.message:
                message_for_agent += f"\n\nLegenda enviada pelo usuário: {req.message}"

        # 3. Grava user; atualiza resumo rolante; monta histórico (últimas N cruas + resumo estruturado)
        await save_message(req.company_id, req.client_phone, "user", message_for_agent)
        await ensure_rolling_summary(req.company_id, req.client_phone)

        if not req.image_base64:
            mig = await try_handle_identity_migration(
                company_id=req.company_id,
                client_phone=req.client_phone,
                user_message=message_for_agent,
                context=context,
            )
            if mig is not None:
                reply_m = mig["reply"]
                if _is_openai_error_message(reply_m):
                    reply_m = _connection_fallback_reply(context)
                else:
                    await save_message(
                        req.company_id,
                        req.client_phone,
                        "assistant",
                        sanitize_assistant_for_history(reply_m),
                    )
                    rc_m = mig.get("router_ctx")
                    if rc_m:
                        await save_router_ctx(
                            req.company_id,
                            req.client_phone,
                            rc_m,
                        )
                return AgentResponse(
                    reply=reply_m,
                    agent_used=str(mig.get("agent_used") or "identity_migration"),
                    stage=mig.get("stage"),
                )

        previous_router_ctx = await get_router_ctx(req.company_id, req.client_phone)

        tail = await get_history(req.company_id, req.client_phone)
        if tail and tail[-1].get("role") == "user":
            tail = tail[:-1]

        summary_txt = await summary_prefix_for_prompt(req.company_id, req.client_phone)
        history = (
            [{"role": "system", "content": summary_txt}] + tail
            if summary_txt
            else tail
        )

        # 4. Executa o router agent
        try:
            result = await run_router(
                message=message_for_agent,
                context=context,
                history=history,
                previous_router_ctx=previous_router_ctx,
            )
        except Exception:
            logger.exception(
                "run_router falhou | company_id=%s | phone=%s",
                req.company_id,
                req.client_phone,
            )
            fallback = _connection_fallback_reply(context)
            return AgentResponse(
                reply=fallback,
                agent_used="system",
                stage=None,
            )

        models = result.get("llm_models") or {}
        logger.info(
            "Resposta gerada | agent_used=%s | models=%s | stage=%s | reply=%.80r",
            result["agent_used"],
            models,
            result.get("router_ctx", {}).get("stage"),
            result["reply"],
        )

        # 6. Salva resposta do agente no histórico
        reply = result["reply"]
        if _is_openai_error_message(reply):
            logger.warning(
                "Resposta de erro da OpenAI não salva | agent=%s | reply=%.120r",
                result["agent_used"],
                reply,
            )
            reply = _connection_fallback_reply(context)
        else:
            await save_message(
                req.company_id,
                req.client_phone,
                "assistant",
                sanitize_assistant_for_history(reply),
            )
            await save_router_ctx(
                req.company_id,
                req.client_phone,
                result.get("router_ctx"),
            )

        return AgentResponse(
            reply=reply,
            agent_used=result["agent_used"],
            stage=result.get("router_ctx", {}).get("stage"),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            "Erro ao processar mensagem | company_id=%s | phone=%s",
            req.company_id,
            req.client_phone,
        )
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────
# POST /history/pop
# Remove as últimas N mensagens do Redis
# Usado para descartar resposta invalidada pela concorrência
# ─────────────────────────────────────────
class PopMessagesRequest(BaseModel):
    company_id: int
    client_phone: str
    count: int = 1


@app.post("/history/pop")
async def pop_from_history(req: PopMessagesRequest):
    from memory.redis_memory import _redis_client, _key

    r = _redis_client()
    try:
        key = _key(req.company_id, req.client_phone)
        for _ in range(req.count):
            await r.rpop(key)
        await delete_summary_state(req.company_id, req.client_phone)
        logger.info(
            "Removidas %d mensagem(ns) do Redis | company_id=%s | phone=%s",
            req.count,
            req.company_id,
            req.client_phone,
        )
    finally:
        await r.aclose()
    return {"success": True}


# ─────────────────────────────────────────
# POST /reactivate
# Chamado pelo api-node quando a IA é reativada manualmente
# Limpa histórico Redis e loga o retorno da IA para o número
# ─────────────────────────────────────────
@app.post("/reactivate")
async def reactivate_agent(req: ReactivateRequest):
    logger.info(
        "🔄 IA REATIVADA | company_id=%s | phone=%s — IA voltando a atender este número",
        req.company_id,
        req.client_phone,
    )
    await clear_history(req.company_id, req.client_phone)
    logger.info(
        "Histórico Redis limpo após reativação | company_id=%s | phone=%s",
        req.company_id,
        req.client_phone,
    )
    return {"success": True, "phone": req.client_phone}


# ─────────────────────────────────────────
# Health check
# ─────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}
