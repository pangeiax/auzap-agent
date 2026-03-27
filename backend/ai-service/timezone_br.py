"""
Referência única de fuso para o ai-service: America/Sao_Paulo (horário de Brasília).

Usar sempre estas funções em vez de date.today() ou UTC-3 fixo, para alinhar com DST e regras IANA.
"""
from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

SAO_PAULO = ZoneInfo("America/Sao_Paulo")


def today_sao_paulo() -> date:
    """Data civil de hoje em São Paulo."""
    return datetime.now(SAO_PAULO).date()


def now_sao_paulo() -> datetime:
    """Agora com tzinfo=America/Sao_Paulo."""
    return datetime.now(SAO_PAULO)


def now_sao_paulo_naive() -> datetime:
    """Hora local de SP sem tzinfo (útil para comparar com TIME do Postgres legado)."""
    return datetime.now(SAO_PAULO).replace(tzinfo=None)
