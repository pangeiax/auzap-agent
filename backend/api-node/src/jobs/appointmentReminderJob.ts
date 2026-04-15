/**
 * Orquestrador de follow-ups.
 *
 * Atualmente apenas o lembrete de agendamento está ativo,
 * e funciona sob demanda (endpoint), não automático.
 *
 * Os outros dois follow-ups estão desativados por enquanto.
 */

// import { startFollowUpPostService } from './followUpPostService'     // DESATIVADO
// import { startFollowUpReactivation } from './followUpReactivation'   // DESATIVADO

export function startAppointmentReminderJob(): void {
  console.log('[Jobs] Follow-ups carregados (lembrete de agendamento disponível via endpoint)')

  // DESATIVADOS — descomentar quando quiser ativar:
  // startFollowUpPostService()
  // startFollowUpReactivation()
}
