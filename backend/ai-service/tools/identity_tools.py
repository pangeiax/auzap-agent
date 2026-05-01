"""
Utilitários puros para identidade do cliente — validação de CPF, normalização
de telefone BR, extração via LLM, busca de duplicata e merge silencioso.

Este módulo contém apenas funções utilitárias / acesso a banco. A camada de
conversa (perguntar dados ao cliente, decidir o que falta etc.) fica a cargo
do agente LLM em `agents/team/identity_agent.py`, que consome estas funções
via `tools/identity_agent_tools.py`.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from openai import AsyncOpenAI

from config import resolve_model_for_company
from db import get_connection

logger = logging.getLogger("ai-service.tools.identity")


# ─────────────────────────────────────────
# Telefone — normalização BR
# ─────────────────────────────────────────

# DDDs válidos no Brasil. Usado pra distinguir "11 dígitos que parecem celular"
# de "11 dígitos que são CPF inválido".
_VALID_BR_DDDS = frozenset({
    "11", "12", "13", "14", "15", "16", "17", "18", "19",
    "21", "22", "24", "27", "28",
    "31", "32", "33", "34", "35", "37", "38",
    "41", "42", "43", "44", "45", "46", "47", "48", "49",
    "51", "53", "54", "55",
    "61", "62", "63", "64", "65", "66", "67", "68", "69",
    "71", "73", "74", "75", "77", "79",
    "81", "82", "83", "84", "85", "86", "87", "88", "89",
    "91", "92", "93", "94", "95", "96", "97", "98", "99",
})


def digits_only(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def normalize_br_phone(digits: str) -> str:
    """Telefone BR com 55 + DDD + número (12 ou 13 dígitos totais). Vazio se inválido."""
    d = digits_only(digits)
    if not d:
        return ""
    if d.startswith("55") and len(d) in (12, 13):
        return d
    if len(d) in (10, 11):
        return "55" + d
    return ""


def is_valid_normalized_br_phone(phone_norm: str) -> bool:
    return bool(normalize_br_phone(phone_norm))


def looks_like_br_mobile(digits: str) -> bool:
    """True se o número bate com padrão de celular BR: DDD válido + 9 inicial após DDD."""
    d = digits_only(digits)
    if d.startswith("55") and len(d) == 13:
        d = d[2:]
    if len(d) != 11:
        return False
    return d[:2] in _VALID_BR_DDDS and d[2] == "9"


# ─────────────────────────────────────────
# CPF — validação dos dígitos verificadores
# ─────────────────────────────────────────

def valid_cpf(cpf: str) -> bool:
    if len(cpf) != 11 or cpf == cpf[0] * 11:
        return False

    def _d(base: str, factor: int) -> int:
        s = sum(int(base[i]) * (factor - i) for i in range(len(base)))
        m = (s * 10) % 11
        return 0 if m == 10 else m

    if _d(cpf[:9], 10) != int(cpf[9]):
        return False
    if _d(cpf[:10], 11) != int(cpf[10]):
        return False
    return True


def phone_norm_collides_with_cpf(phone_norm: str, cpf: str) -> bool:
    """Evita salvar o CPF (ou 55+CPF) como telefone."""
    if len(cpf) != 11 or not phone_norm:
        return False
    d = digits_only(phone_norm)
    if d == "55" + cpf:
        return True
    if len(d) == 11 and d == cpf:
        return True
    return False


def text_scrub_cpf(msg: str, cpf: str) -> str:
    """Remove ocorrências do CPF (puro e formatado) do texto antes de extrair telefone."""
    if len(cpf) != 11:
        return msg
    t = msg
    t = t.replace(cpf, " ")
    t = t.replace(f"{cpf[:3]}.{cpf[3:6]}.{cpf[6:9]}-{cpf[9:]}", " ")
    t = t.replace(f"{cpf[:3]}.{cpf[3:6]}.{cpf[6:9]}.{cpf[9:]}", " ")
    return t


def extract_phone_from_message(msg: str, cpf: str) -> tuple[str, str]:
    """
    Tenta achar telefone na mensagem sem juntar todos os dígitos (evita CPF + e-mail).
    Retorna (phone_norm, texto_para_manual_phone) ou ('', '').
    """
    scrubbed = text_scrub_cpf(msg, cpf)
    # 1. Label explícito: "telefone: ..."
    m = re.search(
        r"(?:telefone|celular|whatsapp|fone)\s*[:.]?\s*([\d\s().\-+]{10,22})",
        scrubbed,
        re.I,
    )
    if m:
        raw = m.group(1).strip()
        n = normalize_br_phone(raw)
        if is_valid_normalized_br_phone(n) and not phone_norm_collides_with_cpf(n, cpf):
            return n, raw
    # 2. Linha isolada que parece telefone
    for line in scrubbed.splitlines():
        line = line.strip()
        if not line or "@" in line:
            continue
        if re.match(r"^(?:e-?mail|email|cpf|nome\s*completo)\s*:", line, re.I):
            continue
        n = normalize_br_phone(line)
        if is_valid_normalized_br_phone(n) and not phone_norm_collides_with_cpf(n, cpf):
            return n, line
    # 3. Número solto no meio do texto
    for m in re.finditer(r"(?<!\d)([\d\s().\-]{10,16})(?!\d)", scrubbed):
        raw = m.group(1).strip()
        n = normalize_br_phone(raw)
        if is_valid_normalized_br_phone(n) and not phone_norm_collides_with_cpf(n, cpf):
            return n, raw
    return "", ""


def resolve_identity_phone(phone_raw: str, user_message: str, cpf: str) -> tuple[str, str]:
    """Define telefone normalizado (55...) e valor amigável para `manual_phone`."""
    pr = (phone_raw or "").strip()
    if pr:
        n = normalize_br_phone(pr)
        if is_valid_normalized_br_phone(n) and not phone_norm_collides_with_cpf(n, cpf):
            return n, pr
    n2, raw2 = extract_phone_from_message(user_message, cpf)
    if n2:
        return n2, raw2.strip() if raw2.strip() else n2
    return "", ""


# ─────────────────────────────────────────
# Extração via LLM
# ─────────────────────────────────────────

_NAME_BLOCKLIST = frozenset({
    "tutor", "cliente", "pessoa", "texto", "cpf", "telefone",
    "email", "nome", "usuario", "usuário",
})

# Palavras (lower) que não podem aparecer SOZINHAS num "full_name" extraído.
# Cobre comandos / respostas curtas / partes do dia / dias da semana / serviços
# que o LLM às vezes classifica como nome em mensagens de continuação.
_NAME_STOPWORDS = frozenset({
    # tempo
    "manha", "manhã", "tarde", "noite", "hoje", "amanha", "amanhã", "ontem",
    "sabado", "sábado", "domingo", "segunda", "terça", "terca", "quarta",
    "quinta", "sexta",
    # confirmação / negação
    "sim", "nao", "não", "ok", "okay", "claro", "beleza", "show", "perfeito",
    "isso", "pode", "manda", "envia", "envie", "confirmo", "concordo",
    # serviços (raramente nome)
    "banho", "tosa", "consulta", "vacina", "hidratacao", "hidratação",
    "corte", "unhas", "creche", "hotel", "hospedagem",
    # preposições / conectivos
    "de", "da", "do", "para", "pra", "com", "no", "na", "em", "um", "uma",
    "meu", "minha", "vou", "vai", "ir",
})


def _name_is_meaningful(candidate: str) -> bool:
    """True se o candidato a nome contém ao menos uma palavra que NÃO é stopword."""
    tokens = [t for t in re.split(r"\s+", (candidate or "").strip()) if t]
    if not tokens:
        return False
    for t in tokens:
        # Pelo menos 1 token deve ter > 2 chars E não estar em stopwords.
        low = t.lower()
        if len(t) > 2 and low not in _NAME_STOPWORDS:
            return True
    return False


def _supplement_identity_from_text(raw: str, data: dict[str, Any]) -> dict[str, Any]:
    """Completa campos quando o LLM falhou mas o texto tem padrões óbvios."""
    out = dict(data)
    text = raw or ""
    if not (out.get("email") or "").strip():
        m = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text)
        if m:
            out["email"] = m.group(0).strip()
    if not (out.get("cpf_digits") or "").strip():
        m = re.search(r"(?:cpf|CPF)\s*[:.]?\s*([\d.\-\s]{11,18})", text)
        if m:
            out["cpf_digits"] = digits_only(m.group(1))
    if not (out.get("phone_raw") or "").strip():
        m = re.search(
            r"(?:telefone|celular|whatsapp|fone)\s*[:.]?\s*([\d\s().\-+]{10,22})",
            text,
            re.I,
        )
        if m:
            out["phone_raw"] = m.group(1).strip()
    if not (out.get("full_name") or "").strip():
        label_only = re.compile(
            r"^(?:nome\s*completo|e-?mail|telefone|cpf)\s*:?\s*$", re.I
        )
        for raw_line in (text or "").strip().splitlines():
            line = raw_line.strip()
            if not line or label_only.match(line):
                continue
            m = re.match(r"^nome\s*completo\s*:\s*(.+)$", line, re.I)
            if m and m.group(1).strip():
                out["full_name"] = m.group(1).strip()
                break
            if "@" in line:
                continue
            if len(line) < 120 and not re.match(
                r"^(?:cpf|telefone|email|e-mail)\b", line, re.I
            ):
                if len(digits_only(line)) == 11 and digits_only(line).isdigit():
                    continue
                out["full_name"] = line
                break
    return out


async def extract_identity_llm(text: str, company_id: int | None = None) -> dict[str, Any]:
    """
    Extrai (full_name, cpf_digits, email, phone_raw) de um texto livre do cliente.
    Sempre retorna um dict — campos não encontrados ficam vazios.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return _supplement_identity_from_text(text, {})
    base_model = os.getenv("OPENAI_IDENTITY_EXTRACT_MODEL", "gpt-4o-mini")
    model = resolve_model_for_company(base_model, company_id)
    client = AsyncOpenAI(api_key=api_key)
    prompt = (
        "Extraia dados pessoais do cliente para cadastro em petshop. Não peça nem invente dados de pet. "
        "Retorne apenas o que estiver EXPLICITAMENTE no texto do cliente — se algo não aparecer, deixe o campo vazio. "
        "NUNCA use palavras deste enunciado (como 'cliente', 'pessoa', 'texto', 'cpf', 'telefone') como valor de full_name. "
        "Responda só JSON com chaves: full_name (só se houver nome próprio claro), cpf_digits (11 dígitos ou vazio), "
        "email, phone_raw (apenas o trecho do TELEFONE com DDD, nunca o CPF; vazio se não houver telefone).\n"
        f"Texto do cliente:\n{text}"
    )
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            max_completion_tokens=400,
        )
        raw = (resp.choices[0].message.content or "").strip()
        data = json.loads(raw)
        base = data if isinstance(data, dict) else {}
        return _supplement_identity_from_text(text, base)
    except Exception:
        logger.exception("extract_identity_llm falhou")
        return _supplement_identity_from_text(text, {})
    finally:
        # Fecha o AsyncOpenAI antes do coroutine terminar — evita o
        # `RuntimeError: Event loop is closed` quando esta função é chamada
        # via _run_sync (thread descartável com asyncio.run).
        try:
            await client.close()
        except Exception:
            pass


def sanitize_extracted_name(new_name: str, prev_name: str | None) -> str:
    """Anti-placeholder: rejeita 'nomes' que são palavras de prompt, comandos
    do dia-a-dia, partes do dia, dias da semana ou nomes de serviços."""
    if not new_name:
        return ""
    low = new_name.lower().strip()
    if low in _NAME_BLOCKLIST:
        return ""
    # Nome composto SÓ por stopwords (ex: "de manha", "na sexta") → rejeita.
    if not _name_is_meaningful(new_name):
        return ""
    if len(new_name.split()) < 2 and prev_name:
        # Só substitui prev se tiver pelo menos 2 palavras (nome completo).
        return ""
    return new_name


# ─────────────────────────────────────────
# Banco — busca, merge e persistência
# ─────────────────────────────────────────

def find_other_client_by_identity(
    company_id: int,
    current_id: str,
    cpf: str,
    phone_norm: str,
) -> str | None:
    """Procura outro cliente da mesma company com mesmo CPF ou telefone."""
    has_cpf = bool(cpf)
    has_phone = bool(phone_norm)
    if not has_cpf and not has_phone:
        return None
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id::text AS id
            FROM clients
            WHERE company_id = %s
              AND id <> %s::uuid
              AND (
                (%s AND cpf IS NOT NULL AND TRIM(cpf) <> '' AND cpf = %s)
                OR (
                  %s
                  AND regexp_replace(COALESCE(manual_phone, ''), '[^0-9]', '', 'g') = %s
                )
                OR (
                  %s
                  AND phone ~ '^[0-9]+$'
                  AND regexp_replace(phone, '[^0-9]', '', 'g') = %s
                )
              )
            LIMIT 1
            """,
            (
                company_id,
                current_id,
                has_cpf,
                cpf,
                has_phone,
                phone_norm,
                has_phone,
                phone_norm,
            ),
        )
        row = cur.fetchone()
        return row["id"] if row else None


def client_has_active_appointments_or_lodgings(company_id: int, client_id: str) -> bool:
    """
    True se o cliente tem agendamentos futuros NÃO cancelados ou hospedagens
    ativas. É o sinal mais forte de "cadastro vivo" — usado pelo silent merge
    pra bloquear destruição acidental (ex.: testes com CPF colidindo, ou um
    futuro caso de fraude). NÃO inclui pets, porque um cliente que migra de
    plataforma legitimamente terá pets antigos a herdar.
    """
    if not client_id:
        return False
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
              EXISTS (
                SELECT 1 FROM petshop_appointments
                WHERE client_id = %s::uuid
                  AND cancelled_at IS NULL
                  AND scheduled_date >= CURRENT_DATE
              ) AS has_appts,
              EXISTS (
                SELECT 1 FROM petshop_lodging_reservations
                WHERE client_id = %s::uuid
                  AND status NOT IN ('cancelled', 'no_show', 'completed')
              ) AS has_lodgings
            """,
            (client_id, client_id),
        )
        row = cur.fetchone() or {}
        return bool(row.get("has_appts") or row.get("has_lodgings"))


def merge_clients(company_id: int, keep_id: str, remove_id: str) -> None:
    """Move pets/agendamentos/conversas/contatos de `remove_id` para `keep_id` e apaga o duplicado."""
    updates: list[tuple[str, str]] = [
        ("petshop_pets", "client_id"),
        ("petshop_appointments", "client_id"),
        ("petshop_lodgings", "client_id"),
        ("petshop_lodging_reservations", "client_id"),
        ("agent_conversations", "client_id"),
        ("whatsapp_contacts", "client_id"),
    ]
    with get_connection() as conn:
        cur = conn.cursor()
        for table, col in updates:
            cur.execute(
                f"UPDATE {table} SET {col} = %s WHERE {col} = %s::uuid AND company_id = %s",
                (keep_id, remove_id, company_id),
            )
        cur.execute(
            "DELETE FROM clients WHERE id = %s::uuid AND company_id = %s",
            (remove_id, company_id),
        )


def update_client_identity(
    company_id: int,
    client_id: str,
    *,
    name: str | None,
    email: str | None,
    cpf: str,
    manual_phone: str,
) -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE clients
            SET name = COALESCE(%s, name),
                email = COALESCE(%s, email),
                cpf = %s,
                manual_phone = %s,
                updated_at = NOW()
            WHERE id = %s::uuid AND company_id = %s
            """,
            (name, email, cpf, manual_phone, client_id, company_id),
        )


def fetch_pets_and_upcoming(
    company_id: int, client_id: str
) -> tuple[list[dict], list[dict]]:
    """Pets ativos + próximos agendamentos (até 8) do cliente."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT name, species, breed
            FROM petshop_pets
            WHERE company_id = %s AND client_id = %s::uuid AND is_active = TRUE
            ORDER BY name
            """,
            (company_id, client_id),
        )
        pets = [dict(r) for r in cur.fetchall()]
        cur.execute(
            """
            SELECT a.scheduled_date, a.status, s.name AS service_name
            FROM petshop_appointments a
            JOIN petshop_services s ON s.id = a.service_id
            WHERE a.client_id = %s::uuid
              AND a.cancelled_at IS NULL
              AND a.scheduled_date >= CURRENT_DATE
            ORDER BY a.scheduled_date ASC
            LIMIT 8
            """,
            (client_id,),
        )
        appts = [dict(r) for r in cur.fetchall()]
    return pets, appts


def find_client_by_manual_phone(
    company_id: int, manual_phone: str, exclude_client_id: str | None = None,
) -> str | None:
    """
    Procura outro cliente da mesma company com `manual_phone` igual (formato de
    dígitos puros). Usado pelo silent enrich logo no carregamento de contexto.
    Retorna o id do duplicado ou None.
    """
    digits = digits_only(manual_phone)
    if not digits:
        return None
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id::text AS id
            FROM clients
            WHERE company_id = %s
              AND (%s = '' OR id <> %s::uuid)
              AND regexp_replace(COALESCE(manual_phone, ''), '[^0-9]', '', 'g') = %s
            ORDER BY created_at ASC NULLS LAST
            LIMIT 1
            """,
            (
                company_id,
                exclude_client_id or "",
                exclude_client_id or "00000000-0000-0000-0000-000000000000",
                digits,
            ),
        )
        row = cur.fetchone()
        return row["id"] if row else None
