/**
 * Data "hoje" para prompts do cérebro (agendamento, SQL com datas relativas).
 * Use BRAIN_TIMEZONE (ex.: America/Sao_Paulo); padrão America/Sao_Paulo.
 */
export function getBrainTimezone(): string {
  return process.env.BRAIN_TIMEZONE?.trim() || 'America/Sao_Paulo'
}

/** YYYY-MM-DD no fuso configurado. */
export function getBrainTodayIsoInTz(timeZone = getBrainTimezone()): string {
  const now = new Date()
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Texto curto para system prompts (PT-BR + ISO). */
export function getBrainDateContextPromptLine(): string {
  const tz = getBrainTimezone()
  const now = new Date()
  const isoToday = getBrainTodayIsoInTz(tz)
  const longBr = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now)

  return `REFERÊNCIA DE DATA (obrigatória): fuso ${tz}. Hoje é ${longBr} — a data de hoje em YYYY-MM-DD é ${isoToday}. Para get_available_times e agendamentos use sempre datas explícitas nesse calendário: "amanhã" = dia seguinte a ${isoToday}, "próximo dia útil" etc. Não invente mês/ano (ex.: não use outubro se hoje é abril).`
}
