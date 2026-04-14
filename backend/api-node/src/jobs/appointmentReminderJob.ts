/**
 * Orquestrador: apenas importa e inicia os 3 follow-ups.
 * Cada follow-up vive no seu próprio arquivo com lógica independente.
 */

import { startFollowUpReminder } from './followUpReminder'
import { startFollowUpPostService } from './followUpPostService'
import { startFollowUpReactivation } from './followUpReactivation'

export function startAppointmentReminderJob(): void {
  console.log('[Jobs] Iniciando follow-ups...')
  startFollowUpReminder()
  startFollowUpPostService()
  startFollowUpReactivation()
}
