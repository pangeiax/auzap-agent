"""
Categorias de ferramentas/dados que o router declara para o turno atual.
None = compatibilidade: especialista mantém prompt completo (comportamento legado).
Lista explícita = o modelo deve priorizar só o que foi indicado; «none» sozinho = sem tools de catálogo/agenda.
"""

from __future__ import annotations

import logging

logger = logging.getLogger("ai-service.router_tool_plan")

# Valores que o router deve retornar em required_tools (minúsculos após normalizar)
VALID_CATEGORIES = frozenset(
    {
        "none",
        "pets",
        "services",
        "slots",
        "appointments",
        "lodging",
    }
)


def normalize_required_tools(raw) -> list[str] | None:
    """
    None → ausência no JSON (especialista em modo completo).
    [] ou ['none'] → turno só conversa, sem get_services / get_client_pets / etc.
    """
    if raw is None:
        return None
    if not isinstance(raw, list):
        logger.warning("required_tools não é lista — ignorando: %r", raw)
        return None
    out: list[str] = []
    for x in raw:
        t = str(x).strip().lower()
        if not t:
            continue
        if t not in VALID_CATEGORIES:
            logger.warning("required_tools token desconhecido ignorado: %r", x)
            continue
        out.append(t)
    if not out:
        return ["none"]
    if "none" in out and len(out) > 1:
        out = [x for x in out if x != "none"]
    if not out:
        return ["none"]
    return out


def router_says_conversation_only(router_ctx: dict) -> bool:
    """Turno explícito sem tools de dados (saudação, agradecimento, etc.)."""
    rt = router_ctx.get("required_tools")
    if rt is None:
        return False
    return rt == ["none"]


def router_wants_category(router_ctx: dict, category: str) -> bool:
    """True se o router pediu essa categoria ou não restringiu o turno (None)."""
    if category not in VALID_CATEGORIES:
        return True
    rt = router_ctx.get("required_tools")
    if rt is None:
        return True
    if rt == ["none"]:
        return False
    return category in rt


def format_required_tools_for_log(router_ctx: dict) -> str:
    rt = router_ctx.get("required_tools")
    if rt is None:
        return "full_legacy"
    return ",".join(rt) if rt else "none"


def build_router_tools_instruction_block(router_ctx: dict) -> str:
    """Bloco curto no input do especialista + explicação das categorias."""
    rt = router_ctx.get("required_tools")
    if rt is None:
        return (
            "\n\n━━━ ROTEADOR — FERRAMENTAS DESTE TURNO ━━━\n"
            "required_tools: (não enviado — use o fluxo completo do seu prompt e chame tools quando precisar de dados do sistema.)\n"
        )
    if rt == ["none"]:
        return (
            "\n\n━━━ ROTEADOR — FERRAMENTAS DESTE TURNO ━━━\n"
            "required_tools: [none]\n"
            "Regra: NÃO chame get_services, get_client_pets, get_available_times, get_specialties, "
            "get_upcoming_appointments nem ferramentas de hospedagem/vagas neste turno. "
            "Responda com cumprimento, encerramento ou conversa curta usando só histórico e contexto já dito. "
            "Exceções: (1) escalate_to_human se o cliente pedir atendente/humano de forma clara, "
            "ou após aceite de encaminhamento (já fez pré-requisito e quer serviço block_ai_schedule). "
            "(2) **booking_agent** e **health_agent**: se a mensagem atual citar **nome de pet** a validar, "
            "chame **get_client_pets** mesmo com [none] — o prompt do agente manda.\n"
        )
    legend = (
        "pets=get_client_pets/create_pet/update_pet_size | services=get_services | "
        "slots=get_available_times | appointments=compromissos futuros/cancel/remarcar | "
        "lodging=ferramentas de hotel/creche"
    )
    return (
        f"\n\n━━━ ROTEADOR — FERRAMENTAS DESTE TURNO ━━━\n"
        f"required_tools: {rt}\n"
        f"({legend})\n"
        "Regra: priorize chamar só o que este turno exige; não dispare leituras de catálogo ou agenda "
        "que não sejam coerentes com a lista. Se faltar um dado e a lista não incluir a categoria, "
        "pergunte ao cliente ou responda o que couber sem inventar números/datas/preços.\n"
        "Exceção: escalate_to_human se o cliente pedir humano, ou (booking/health) após **aceite** ao encaminhamento "
        "quando **já fez pré-requisito** e quer serviço **block_ai_schedule** (fluxo SERVIÇOS BLOQUEADOS).\n"
    )
