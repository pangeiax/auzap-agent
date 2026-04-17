/**
 * ════════════════════════════════════════════════════════════════
 * FILA DE LEMBRETES (REDIS)
 * ════════════════════════════════════════════════════════════════
 *
 * Gerencia os envios agendados usando Redis Sorted Set.
 *
 * Estrutura:
 *   Sorted Set "followup:reminder:queue"
 *     - score = timestamp (ms) de quando enviar
 *     - value = JSON { companyId, clientId, retryCount, scheduledFor }
 *
 *   String "followup:reminder:scheduled:YYYY-MM-DD"
 *     - Flag para garantir que o agendamento diário não rode duplicado
 *     - TTL de 36h para auto-limpar
 *
 * Por que Sorted Set?
 *   Redis mantém os itens ordenados pelo score. A query "ZRANGEBYSCORE 0 now"
 *   retorna todos os itens que já estão prontos para enviar.
 *
 * Resiliência:
 *   - Se o servidor reiniciar, os itens permanecem no Redis
 *   - O worker verifica a fila a cada minuto e processa o que estiver pronto
 *   - Tentativas falhadas são re-agendadas com retry (max 3 vezes)
 */

import redis from '../lib/redis'

const QUEUE_KEY = 'followup:reminder:queue'
const DEDUPE_KEY_PREFIX = 'followup:reminder:scheduled:'
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 5 * 60 * 1000 // 5 minutos
const WAIT_CONNECTION_DELAY_MS = 3 * 60 * 1000 // 3 minutos — re-check rápido quando WhatsApp está offline

export interface ReminderJob {
  companyId: number
  clientId: string
  retryCount: number
  scheduledFor: string // YYYY-MM-DD do agendamento que será notificado
}

// ─── Adiciona um envio agendado à fila ─────────────────────────
export async function enqueueReminder(
  job: ReminderJob,
  scheduledAtMs: number
): Promise<void> {
  await redis.zadd(QUEUE_KEY, scheduledAtMs, JSON.stringify(job))
}

// ─── Marca que o agendamento diário já rodou para a data ───────
// Evita que um restart acidental gere envios duplicados no mesmo dia
export async function markDailyScheduled(date: string): Promise<boolean> {
  const key = `${DEDUPE_KEY_PREFIX}${date}`
  // SET NX (só seta se não existir) + EX (TTL de 36h)
  const result = await redis.set(key, '1', 'EX', 36 * 60 * 60, 'NX')
  return result === 'OK'
}

// ─── Pega todos os envios prontos (score <= now) ───────────────
export async function getDueReminders(): Promise<ReminderJob[]> {
  const now = Date.now()
  const items = await redis.zrangebyscore(QUEUE_KEY, 0, now)

  const jobs: ReminderJob[] = []
  for (const raw of items) {
    try {
      jobs.push(JSON.parse(raw))
    } catch (err) {
      console.error('[ReminderQueue] Falha ao parsear job:', raw, err)
    }
  }
  return jobs
}

// ─── Remove um job específico da fila ──────────────────────────
export async function removeReminder(job: ReminderJob): Promise<void> {
  await redis.zrem(QUEUE_KEY, JSON.stringify(job))
}

// ─── Re-agenda um job após falha (retry) ───────────────────────
// Retorna true se foi re-agendado, false se excedeu limite de retries
export async function retryReminder(job: ReminderJob): Promise<boolean> {
  await removeReminder(job)

  if (job.retryCount >= MAX_RETRIES) {
    console.error(
      `[ReminderQueue] Job excedeu ${MAX_RETRIES} tentativas — abortando. Company ${job.companyId}, Client ${job.clientId}`
    )
    return false
  }

  const updated: ReminderJob = { ...job, retryCount: job.retryCount + 1 }
  const nextAttempt = Date.now() + RETRY_DELAY_MS
  await enqueueReminder(updated, nextAttempt)
  console.log(
    `[ReminderQueue] Retry ${updated.retryCount}/${MAX_RETRIES} agendado para company ${job.companyId}, client ${job.clientId} em 5 min.`
  )
  return true
}

// ─── Re-enfileira sem consumir retry (WhatsApp offline) ────────
// Usado quando a sessão do WhatsApp não está conectada no momento do tick:
// não faz sentido gastar uma das 3 tentativas, apenas adia o envio.
export async function requeueWaitingConnection(job: ReminderJob): Promise<void> {
  await removeReminder(job)
  const nextAttempt = Date.now() + WAIT_CONNECTION_DELAY_MS
  await enqueueReminder(job, nextAttempt)
}

// ─── Conta quantos itens ainda estão pendentes ─────────────────
export async function countPendingReminders(): Promise<number> {
  return await redis.zcard(QUEUE_KEY)
}
