"""Blocos de prompt com cadastro dinâmico (banco): serviços e tipos de quarto de hospedagem."""

from __future__ import annotations

import json

# Limite de caracteres por descrição nos agentes que ainda enviam texto longo (evita CRM com romances).
DEFAULT_MAX_CADASTRO_DESCRIPTION_CHARS = 900

CADASTRO_SERVICOS_INTRO = (
    "Use o texto abaixo como fonte de verdade ao explicar o que cada serviço inclui, "
    "restrições, encaminhamento a humano ou canal. Pode parafrasear sem alterar o sentido."
)

CADASTRO_SERVICOS_INTRO_COMPACT = (
    "Resumo operacional (sem descrições longas): use para listar nomes, bloqueios e pré-requisitos. "
    "Para o que cada serviço inclui no detalhe, o cliente pode perguntar e você responde com o que souber do histórico "
    "ou indique o especialista — o agente de agendamento/vendas recebe o cadastro completo quando aplicável."
)

CADASTRO_HOSPEDAGEM_INTRO = (
    "Use o texto abaixo como fonte de verdade para regras de hospedagem/creche, planos, "
    "encaminhamento a humano e o que pode ser combinado por este canal."
)

CADASTRO_HOSPEDAGEM_INTRO_COMPACT = (
    "Resumo operacional de tipos de quarto (sem textos longos duplicados). "
    "Detalhes completos de planos e políticas vão ao lodging_agent / faq quando o fluxo for hospedagem."
)


def _truncate_text(text: str, max_len: int | None) -> str:
    if not max_len or len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def _normalize_desc_for_dedupe(desc: str) -> str:
    return " ".join(desc.split())


def build_petshop_services_cadastro_block(
    services: list | None,
    *,
    include_descriptions: bool = True,
    max_description_chars: int | None = None,
) -> str:
    """Descrições e flags de `petshop_services` — vazio se não houver serviços."""
    rows = services or []
    if not rows:
        return ""

    intro = CADASTRO_SERVICOS_INTRO if include_descriptions else CADASTRO_SERVICOS_INTRO_COMPACT
    lines = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "CADASTRO DO PETSHOP — SERVIÇOS (banco de dados)",
        intro,
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
        if not include_descriptions:
            continue
        desc = (s.get("description") or "").strip()
        if desc:
            out = _truncate_text(desc, max_description_chars)
            lines.append(f"  Descrição cadastrada:\n  {out}")
    lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    return "\n".join(lines)


def _append_room_type_lines(
    lines: list,
    r: dict,
    *,
    include_descriptions: bool,
    max_description_chars: int | None,
    dedupe_descriptions: bool,
    prev_desc_norm: str | None,
    prev_room_label: str,
) -> tuple[str | None, str]:
    """Acrescenta linhas de um room type; devolve (novo prev_desc_norm, novo prev_room_label)."""
    name = r.get("name") or ""
    dr = r.get("daily_rate")
    dr_s = f"{float(dr):.2f}" if dr is not None else "—"
    lt = (r.get("lodging_type") or "").lower()
    label = "Hotel" if lt == "hotel" else "Creche" if lt == "daycare" else lt or "?"
    room_label = f"[{label}] {name}"
    lines.append(f"\n• {room_label} — diária R$ {dr_s}")

    new_prev_norm = prev_desc_norm
    new_prev_label = prev_room_label

    if include_descriptions:
        desc = (r.get("description") or "").strip()
        if desc:
            dn = _normalize_desc_for_dedupe(desc)
            if (
                dedupe_descriptions
                and prev_desc_norm is not None
                and dn == prev_desc_norm
                and prev_room_label
            ):
                lines.append(
                    f"  (Mesma descrição cadastrada que «{prev_room_label}» — omitida aqui para evitar repetição.)"
                )
                new_prev_norm = prev_desc_norm
                new_prev_label = prev_room_label
            else:
                out = _truncate_text(desc, max_description_chars)
                lines.append(f"  Descrição cadastrada:\n  {out}")
                new_prev_norm = dn
                new_prev_label = room_label
        else:
            new_prev_norm = None
            new_prev_label = room_label

    if include_descriptions:
        feats = r.get("features")
        if feats not in (None, {}, []):
            try:
                feat_str = json.dumps(feats, ensure_ascii=False)
            except (TypeError, ValueError):
                feat_str = str(feats)
            if max_description_chars and len(feat_str) > max_description_chars:
                feat_str = _truncate_text(feat_str, max_description_chars)
            lines.append(f"  Features (cadastro): {feat_str}")

    return new_prev_norm, new_prev_label


def build_lodging_room_types_cadastro_block(
    lodging_room_types: list | None,
    *,
    filter_lodging_type: str | None = None,
    title: str = "CADASTRO DO PETSHOP — HOSPEDAGEM (tipos de quarto / espaço)",
    intro: str | None = None,
    include_descriptions: bool = True,
    max_description_chars: int | None = None,
    dedupe_descriptions: bool = True,
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

    if intro is None:
        intro = CADASTRO_HOSPEDAGEM_INTRO if include_descriptions else CADASTRO_HOSPEDAGEM_INTRO_COMPACT

    lines = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        title,
        intro,
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ]

    prev_desc_norm: str | None = None
    prev_room_label = ""

    if filter_lodging_type:
        for r in rows:
            prev_desc_norm, prev_room_label = _append_room_type_lines(
                lines,
                r,
                include_descriptions=include_descriptions,
                max_description_chars=max_description_chars,
                dedupe_descriptions=dedupe_descriptions,
                prev_desc_norm=prev_desc_norm,
                prev_room_label=prev_room_label,
            )
    else:
        last_lt = None
        for r in rows:
            lt = (r.get("lodging_type") or "").lower()
            if lt != last_lt:
                sub = "Hotel (hospedagem)" if lt == "hotel" else "Creche (daycare)" if lt == "daycare" else lt
                lines.append(f"\n── {sub} ──")
                last_lt = lt
                prev_desc_norm = None
                prev_room_label = ""
            prev_desc_norm, prev_room_label = _append_room_type_lines(
                lines,
                r,
                include_descriptions=include_descriptions,
                max_description_chars=max_description_chars,
                dedupe_descriptions=dedupe_descriptions,
                prev_desc_norm=prev_desc_norm,
                prev_room_label=prev_room_label,
            )

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
        "\n\nSERVIÇOS BLOQUEADOS (O «FILHO» NÃO FECHA PELA IA):\n"
        + "\n".join(lines)
        + "\n\nFluxo quando o cliente pedir o serviço **bloqueado** (ex.: aula, nome alinhado ao cadastro):\n"
        "1. Explique: esse serviço **não** pode ser agendado por você (IA); **PROIBIDO** `get_available_times` / `create_appointment` com o **service_id** dele — a tool recusa; não insista.\n"
        "2. Se existir **pré-requisito** no cadastro (nome em dependent_service_name / lista acima): **ofereça e conduza o agendamento normal** desse pré-requisito — `get_services` para achar o **id** correto do pré-requisito, depois `get_available_times` + `create_appointment` como em qualquer serviço liberado. Esse caminho **é** permitido e desejável.\n"
        "3. Só quando o cliente disser que **já fez** o pré-requisito (avaliação etc.) e **insistir** em marcar **o serviço bloqueado** de fato: **não** tente de novo slots/create para o bloqueado; ofereça **encaminhamento para um humano** da loja conferir e marcar.\n"
        "4. Com **aceite explícito** ao encaminhamento (sim, quero falar com alguém, pode encaminhar, etc.): chame **escalate_to_human** **nesta mesma rodada**. `summary`: serviço bloqueado pedido, que já fez pré-requisito (e data se citou), pet; `last_message`: texto literal da mensagem atual do cliente.\n"
        "5. **PROIBIDO** «vou verificar / retorno em breve / já passei pra equipe» **sem** `escalate_to_human` com success após o aceite do encaminhamento.\n"
        f"6. Sem pré-requisito cadastrado: explique o bloqueio e ofereça encaminhamento humano (ou telefone{phone_hint}) — com aceite → **escalate_to_human**."
    )
