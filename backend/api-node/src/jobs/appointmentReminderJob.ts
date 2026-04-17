/**
 * Orquestrador de follow-ups.
 *
 * Agenda o lembrete de agendamento para rodar automaticamente
 * todos os dias às 12:00 BRT (15:00 UTC).
 *
 * Os outros dois follow-ups (pós-atendimento e reativação) estão
 * desativados por enquanto.
 */

import { runReminderJobDaily } from './followUpReminder'
import { startReminderWorker } from './reminderWorker'
// import { startFollowUpPostService } from './followUpPostService'     // DESATIVADO
// import { startFollowUpReactivation } from './followUpReactivation'   // DESATIVADO

// Horário do disparo diário em UTC (12:00 BRT = 15:00 UTC)
const DAILY_RUN_HOUR_UTC = 15

// Calcula quantos ms faltam até o próximo horário-alvo em UTC
function msUntilNextRun(hourUTC: number): number {
  const now = new Date()
  const next = new Date(now)
  next.setUTCHours(hourUTC, 0, 0, 0)
  // Se o horário de hoje já passou, agenda para amanhã
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return next.getTime() - now.getTime()
}

// Agenda a próxima execução do job diário (recursivo)
function scheduleNextDailyRun(): void {
  const ms = msUntilNextRun(DAILY_RUN_HOUR_UTC)
  const nextRunDate = new Date(Date.now() + ms)
  console.log(`[Jobs] Próximo lembrete automático: ${nextRunDate.toISOString()} (em ${Math.round(ms / 1000 / 60)} min)`)

  setTimeout(async () => {
    try {
      await runReminderJobDaily()
    } catch (err) {
      console.error('[Jobs] Erro ao executar runReminderJobDaily:', err)
    }
    // Re-agenda para o próximo dia
    scheduleNextDailyRun()
  }, ms)
}

export function startAppointmentReminderJob(): void {
  console.log('[Jobs] Iniciando orquestrador de follow-ups...')

  // Inicia o worker que consome a fila Redis (a cada 1 min)
  startReminderWorker()

  // Agenda o disparo diário do job que enfileira os lembretes
  scheduleNextDailyRun()

  // DESATIVADOS — descomentar quando quiser ativar:
  // startFollowUpPostService()
  // startFollowUpReactivation()
}
