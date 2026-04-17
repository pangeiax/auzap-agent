/**
 * Endpoint TEMPORÁRIO de teste para disparar o job diário de lembretes
 * sem esperar o horário de 12:00 BRT.
 *
 * Uso: POST /internal/trigger-daily-reminder
 *
 * Remover quando não precisar mais para testes.
 */

import { Request, Response } from 'express'
import { runReminderJobDaily } from '../../jobs/followUpReminder'
import { countPendingReminders } from '../../jobs/reminderQueue'

export async function triggerDailyReminder(_req: Request, res: Response) {
  try {
    console.log('[TriggerReminder] Disparando job manualmente (endpoint de teste)...')
    await runReminderJobDaily()
    const pending = await countPendingReminders()
    res.json({
      success: true,
      message: 'Job disparado. Verifique a fila Redis e os logs.',
      pendingInQueue: pending,
    })
  } catch (error: any) {
    console.error('[TriggerReminder] Erro:', error)
    res.status(500).json({ error: error?.message || 'Erro ao disparar job' })
  }
}
