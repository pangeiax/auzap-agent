"""Helpers para formatar horários de slots (PostgreSQL time / timedelta)."""

from __future__ import annotations

from datetime import datetime, timedelta, time as dt_time


def slot_time_to_hhmm(slot_time) -> str:
    if slot_time is None:
        return ""
    if isinstance(slot_time, dt_time):
        return slot_time.strftime("%H:%M")
    if isinstance(slot_time, timedelta):
        secs = int(slot_time.total_seconds()) % 86400
        h, m = secs // 3600, (secs % 3600) // 60
        return f"{h:02d}:{m:02d}"
    s = str(slot_time).strip()
    return s[:5] if len(s) >= 5 else s


def hhmm_after_minutes(hhmm: str, add_mins: int) -> str:
    if not hhmm or ":" not in hhmm:
        return hhmm
    parts = hhmm.split(":")
    h, m = int(parts[0]), int(parts[1])
    total = (h * 60 + m + add_mins) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"
