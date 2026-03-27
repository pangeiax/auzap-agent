import logging
import os
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()

from context.loader import load_context
from memory.redis_memory import get_history, save_message, clear_history
from agents.router import run_router
from timezone_br import today_sao_paulo

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("ai-service")

app = FastAPI(title="Petshop AI Service")

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
# Descreve imagem via GPT-4o-mini vision
# ─────────────────────────────────────────
async def describe_image(image_base64: str, caption: str = "") -> str:
    prompt = (
        "Descreva o conteúdo desta imagem em detalhes. "
        "Se houver texto, transcreva-o integralmente. "
        "Responda em português."
    )
    if caption:
        prompt += f"\n\nO usuário também enviou a seguinte legenda: '{caption}'"

    try:
        response = await _openai_client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
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
            max_tokens=500,
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
        _PT_WEEKDAYS = [
            "Segunda-feira",
            "Terça-feira",
            "Quarta-feira",
            "Quinta-feira",
            "Sexta-feira",
            "Sábado",
            "Domingo",
        ]
        _today_brt = today_sao_paulo()
        context["today"] = _today_brt.strftime("%d/%m/%Y")
        context["today_iso"] = _today_brt.isoformat()
        context["today_weekday"] = _PT_WEEKDAYS[_today_brt.weekday()]

        # 2. Se houver imagem, descreve via vision e monta mensagem enriquecida
        message_for_agent = req.message
        if req.image_base64:
            logger.info(
                "Descrevendo imagem via vision | company_id=%s | phone=%s",
                req.company_id,
                req.client_phone,
            )
            image_description = await describe_image(req.image_base64, req.message)
            logger.info("Descrição da imagem: %.120r", image_description)
            message_for_agent = (
                f"[📷 O usuário enviou uma imagem. Descrição: {image_description}]"
            )
            if req.message:
                message_for_agent += f"\n\nLegenda enviada pelo usuário: {req.message}"

        # 3. Carrega histórico do Redis
        history = await get_history(req.company_id, req.client_phone)

        # 4. Salva mensagem do usuário no histórico (versão enriquecida se houver imagem)
        await save_message(req.company_id, req.client_phone, "user", message_for_agent)

        # 5. Executa o router agent
        result = await run_router(
            message=message_for_agent,
            context=context,
            history=history,
        )

        logger.info(
            "Resposta gerada | agent_used=%s | stage=%s | reply=%.80r",
            result["agent_used"],
            result.get("router_ctx", {}).get("stage"),
            result["reply"],
        )

        # 6. Salva resposta do agente no histórico
        await save_message(
            req.company_id, req.client_phone, "assistant", result["reply"]
        )

        return AgentResponse(
            reply=result["reply"],
            agent_used=result["agent_used"],
            stage=result.get("router_ctx", {}).get("stage"),
        )

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
