import os
from dotenv import load_dotenv

load_dotenv()

# OpenAI Configuration
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5")
OPENAI_MODEL_ADVANCED = os.getenv("OPENAI_MODEL_ADVANCED", "gpt-5")
# Roteador só classifica intenção — modelo menor reduz custo por mensagem.
OPENAI_MODEL_ROUTER = os.getenv("OPENAI_MODEL_ROUTER", "gpt-4o-mini")
# Só aplicado quando o id do modelo começa com gpt-5 (Agno → Chat Completions / reasoning_effort).
OPENAI_REASONING_EFFORT = (os.getenv("OPENAI_REASONING_EFFORT") or "low").strip()
OPENAI_REASONING_EFFORT_ADVANCED = (os.getenv("OPENAI_REASONING_EFFORT_ADVANCED") or "").strip()

# Redis Configuration
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD")

# Database Configuration
DATABASE_URL = os.getenv("DATABASE_URL_AGENT")

# Internal service URLs (ai-service → api-node, ex. POST /internal/generate-slots)
API_NODE_URL = os.getenv("API_NODE_URL", "http://localhost:3000")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
# Mesmo valor que INTERNAL_API_KEY na api-node; header X-Internal-Key nas rotas /internal/*
INTERNAL_API_KEY = (os.getenv("INTERNAL_API_KEY") or "").strip()

if not OPENAI_API_KEY:
    raise ValueError("OPENAI_API_KEY environment variable not set")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable not set")
