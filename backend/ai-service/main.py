from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from context.loader import load_context
from memory.redis_memory import get_history, save_message
from agents.router import run_router

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


# ─────────────────────────────────────────
# POST /run
# Recebe mensagem do api-node e retorna resposta do agente
# ─────────────────────────────────────────
@app.post("/run", response_model=AgentResponse)
async def run_agent(req: AgentRequest):
    try:
        # 1. Carrega contexto da company + petshop + cliente
        context = await load_context(req.company_id, req.client_phone)

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

        # 5. Salva resposta do agente no histórico
        await save_message(
            req.company_id, req.client_phone, "assistant", result["reply"]
        )

        return AgentResponse(reply=result["reply"], agent_used=result["agent_used"])

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────
# Health check
# ─────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}
