import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from context.loader import load_context
from memory.redis_memory import get_history, save_message, clear_history
from agents.router import run_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("ai-service")

app = FastAPI(title="Petshop AI Service")


# ─────────────────────────────────────────
# Schema da requisição
# ─────────────────────────────────────────
class AgentRequest(BaseModel):
    company_id: int
    client_phone: str
    message: str


class AgentResponse(BaseModel):
    reply: str
    agent_used: str
    stage: Optional[str] = None


class ReactivateRequest(BaseModel):
    company_id: int
    client_phone: str


# ─────────────────────────────────────────
# POST /run
# Recebe mensagem do api-node e retorna resposta do agente
# ─────────────────────────────────────────
@app.post("/run", response_model=AgentResponse)
async def run_agent(req: AgentRequest):
    logger.info(
        "Requisição recebida | company_id=%s | phone=%s | message=%.80r",
        req.company_id,
        req.client_phone,
        req.message,
    )
    try:
        # 1. Carrega contexto da company + petshop + cliente
        context = await load_context(req.company_id, req.client_phone)

        # Injeta data atual no fuso de Brasília (UTC-3)
        _BRASILIA = timezone(timedelta(hours=-3))
        _PT_WEEKDAYS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"]
        _today_brt = datetime.now(_BRASILIA).date()
        context["today"] = _today_brt.strftime("%d/%m/%Y")          # formato BR para exibição
        context["today_iso"] = _today_brt.isoformat()                # YYYY-MM-DD para cálculos internos
        context["today_weekday"] = _PT_WEEKDAYS[_today_brt.weekday()]

        # 2. Carrega histórico do Redis
        history = await get_history(req.company_id, req.client_phone)

        # 3. Salva mensagem do usuário no histórico
        await save_message(req.company_id, req.client_phone, "user", req.message)

        # 4. Executa o router agent
        result = await run_router(
            message=req.message,
            context=context,
            history=history,
        )

        logger.info(
            "Resposta gerada | agent_used=%s | stage=%s | reply=%.80r",
            result["agent_used"],
            result.get("router_ctx", {}).get("stage"),
            result["reply"],
        )

        # 5. Salva resposta do agente no histórico
        await save_message(
            req.company_id, req.client_phone, "assistant", result["reply"]
        )

        return AgentResponse(
            reply=result["reply"],
            agent_used=result["agent_used"],
            stage=result.get("router_ctx", {}).get("stage"),
        )

    except Exception as e:
        logger.exception("Erro ao processar mensagem | company_id=%s | phone=%s", req.company_id, req.client_phone)
        raise HTTPException(status_code=500, detail=str(e))


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
