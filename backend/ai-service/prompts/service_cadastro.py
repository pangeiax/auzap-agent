"""Blocos de prompt com cadastro dinâmico (banco): serviços e tipos de quarto de hospedagem."""

from __future__ import annotations

import json


CADASTRO_SERVICOS_INTRO = (
    "Use o texto abaixo como fonte de verdade ao explicar o que cada serviço inclui, "
    "restrições, encaminhamento a humano ou canal. Pode parafrasear sem alterar o sentido."
)

CADASTRO_HOSPEDAGEM_INTRO = (
    "Use o texto abaixo como fonte de verdade para regras de hospedagem/creche, planos, "
    "encaminhamento a humano e o que pode ser combinado por este canal."
)


def build_petshop_services_cadastro_block(services: list | None) -> str:
    """Descrições e flags de `petshop_services` — vazio se não houver serviços."""
    rows = services or []
    if not rows:
        return ""

    lines = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "CADASTRO DO PETSHOP — SERVIÇOS (banco de dados)",
        CADASTRO_SERVICOS_INTRO,
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ]
    for s in rows:
        name = s.get("name") or ""
        sid = s.get("id")
        dur = s.get("duration_min", "?")
        spec = s.get("specialty_id") or "?"
        blocked = bool(s.get("block_ai_schedule"))
        dep = s.get("dependent_service_name") or s.get("dependent_service_id")
        head = f"\n• {name} (id={sid}, {dur} min, specialty_id={spec})"
        if blocked:
            extra = " — BLOQUEADO para agendamento direto pelo bot"
            if dep:
                extra += f" (pré-requisito: {dep})"
            head += extra
        lines.append(head)
        desc = (s.get("description") or "").strip()
        if desc:
            lines.append(f"  Descrição cadastrada:\n  {desc}")
    lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    return "\n".join(lines)


def _append_room_type_lines(lines: list, r: dict) -> None:
    name = r.get("name") or ""
    dr = r.get("daily_rate")
    dr_s = f"{float(dr):.2f}" if dr is not None else "—"
    lt = (r.get("lodging_type") or "").lower()
    label = "Hotel" if lt == "hotel" else "Creche" if lt == "daycare" else lt or "?"
    lines.append(f"\n• [{label}] {name} — diária R$ {dr_s}")
    desc = (r.get("description") or "").strip()
    if desc:
        lines.append(f"  Descrição cadastrada:\n  {desc}")
    feats = r.get("features")
    if feats not in (None, {}, []):
        try:
            lines.append("  Features (cadastro): " + json.dumps(feats, ensure_ascii=False))
        except (TypeError, ValueError):
            lines.append(f"  Features (cadastro): {feats}")


def build_lodging_room_types_cadastro_block(
    lodging_room_types: list | None,
    *,
    filter_lodging_type: str | None = None,
    title: str = "CADASTRO DO PETSHOP — HOSPEDAGEM (tipos de quarto / espaço)",
    intro: str | None = None,
) -> str:
    rows = list(lodging_room_types or [])
    if filter_lodging_type:
        ft = filter_lodging_type.lower()
        rows = [r for r in rows if (r.get("lodging_type") or "").lower() == ft]
    else:

        def _rate_key(r):
            dr = r.get("daily_rate")
            try:
                return float(dr) if dr is not None else 0.0
            except (TypeError, ValueError):
                return 0.0

        rows = sorted(
            rows,
            key=lambda r: ((r.get("lodging_type") or ""), _rate_key(r), r.get("name") or ""),
        )

    if not rows:
        return ""

    intro = intro or CADASTRO_HOSPEDAGEM_INTRO
    lines = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        title,
        intro,
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ]

    if filter_lodging_type:
        for r in rows:
            _append_room_type_lines(lines, r)
    else:
        last_lt = None
        for r in rows:
            lt = (r.get("lodging_type") or "").lower()
            if lt != last_lt:
                sub = "Hotel (hospedagem)" if lt == "hotel" else "Creche (daycare)" if lt == "daycare" else lt
                lines.append(f"\n── {sub} ──")
                last_lt = lt
            _append_room_type_lines(lines, r)

    lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    return "\n".join(lines)


def build_blocked_services_block(services: list, petshop_phone: str = "") -> str:
    """
    Gera o bloco de serviços bloqueados com instruções de comportamento.
    Usar tanto no health_agent quanto no booking_agent.
    """
    blocked = [s for s in (services or []) if s.get("block_ai_schedule", False)]
    if not blocked:
        return ""

    lines = []
    for s in blocked:
        dep_name = s.get("dependent_service_name") or s.get("dependent_service_id")
        if dep_name:
            lines.append(
                f"  • '{s['name']}' → requer '{dep_name}' como pré-requisito antes de ser agendado"
            )
        else:
            lines.append(
                f"  • '{s['name']}' → não pode ser agendado pelo bot (requer avaliação presencial)"
            )

    phone_hint = f" ({petshop_phone})" if petshop_phone else ""
    return (
        "\n\nSERVIÇOS BLOQUEADOS (NÃO AGENDAR VIA BOT):\n"
        + "\n".join(lines)
        + "\n\nQuando o cliente solicitar um desses serviços:\n"
        "1. Informe que este serviço requer o serviço pré-requisito antes de ser agendado.\n"
        "2. Ofereça agendar o serviço pré-requisito.\n"
        "3. Se o cliente disser que JÁ REALIZOU o serviço pré-requisito anteriormente:\n"
        f"   - Informe o telefone do petshop{phone_hint} para que ele confirme o histórico.\n"
        "   - Ou ofereça encaminhar para um especialista (use escalate_to_human se ele aceitar)."
    )
