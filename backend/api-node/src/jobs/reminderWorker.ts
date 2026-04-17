/**
 * ════════════════════════════════════════════════════════════════
 * WORKER DE LEMBRETES
 * ════════════════════════════════════════════════════════════════
 *
 * Processo que roda continuamente e consome a fila Redis.
 *
 * Fluxo:
 *   A cada 1 minuto:
 *     1. Pega todos os jobs prontos (scheduledAt <= agora) do Redis
 *     2. Para cada um:
 *        - Tenta enviar o lembrete via WhatsApp
 *        - Se sucesso: remove da fila
 *        - Se falha: re-agenda com retry (até 3x)
 *
 * Resiliência:
 *   - Se o servidor cair, os jobs permanecem no Redis
 *   - Quando subir de novo, o worker retoma onde parou
 *   - Itens em retry têm delay de 5 min entre tentativas
 *
 * Anti-concorrência:
 *   - Usa flag em memória para evitar que dois ticks rodem ao mesmo tempo
 *   - Se o processamento demorar mais de 1 min, o próximo tick espera
 */

import {
  getDueReminders,
  removeReminder,
  retryReminder,
  requeueWaitingConnection,
  countPendingReminders,
  type ReminderJob,
} from './reminderQueue'
import { runReminderForClient } from './followUpReminder'
import { isSessionConnected } from '../services/baileysService'

const TICK_INTERVAL_MS = 60 * 1000 // 1 minuto
let isProcessing = false

async function processOne(job: ReminderJob): Promise<void> {
  // Pré-check: só dispara se o WhatsApp da company estiver realmente conectado.
  // Se não estiver, adia sem consumir retry — a sessão pode voltar a qualquer momento.
  if (!isSessionConnected(String(job.companyId))) {
    await requeueWaitingConnection(job)
    console.log(
      `[ReminderWorker] ⏸ WhatsApp offline | company ${job.companyId} | client ${job.clientId} — re-enfileirado em 3 min (sem consumir retry).`
    )
    return
  }

  try {
    const result = await runReminderForClient(job.companyId, job.clientId)

    if (result.sent > 0) {
      // Sucesso: remove da fila
      await removeReminder(job)
      console.log(
        `[ReminderWorker] ✓ Enviado | company ${job.companyId} | client ${job.clientId}`
      )
    } else {
      // Falha no envio: re-agenda com retry
      await retryReminder(job)
    }
  } catch (err) {
    console.error(
      `[ReminderWorker] Erro ao processar job (company ${job.companyId}, client ${job.clientId}):`,
      err
    )
    await retryReminder(job)
  }
}

async function tick(): Promise<void> {
  if (isProcessing) {
    console.log('[ReminderWorker] Tick anterior ainda processando, pulando este.')
    return
  }

  isProcessing = true
  try {
    const jobs = await getDueReminders()
    if (jobs.length === 0) return

    const pending = await countPendingReminders()
    console.log(
      `[ReminderWorker] ${jobs.length} job(s) pronto(s) para envio (${pending} pendentes no total).`
    )

    // Processa sequencialmente para respeitar rate-limit do WhatsApp
    for (const job of jobs) {
      await processOne(job)
    }
  } catch (err) {
    console.error('[ReminderWorker] Erro no tick:', err)
  } finally {
    isProcessing = false
  }
}

export function startReminderWorker(): void {
  console.log('[ReminderWorker] Iniciando — verificando fila a cada 1 min')

  // Roda um tick imediatamente (caso haja jobs acumulados após restart)
  tick()

  // Agenda os ticks periódicos
  setInterval(tick, TICK_INTERVAL_MS)
}
