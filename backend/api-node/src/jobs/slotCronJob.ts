import { generateSlotsForCompany } from '../services/slotGeneratorService'

/**
 * Cron job semanal — gera slots para TODAS as empresas ativas.
 * Roda toda segunda-feira às 06:00 (UTC-3 = 09:00 UTC).
 *
 * Usa setInterval simples para evitar dependência de node-cron.
 * O timer verifica a cada minuto se é segunda-feira 09:00 UTC.
 */

const CRON_HOUR_UTC = 9 // 06:00 BRT = 09:00 UTC
const CRON_DAY = 1 // Monday

let lastRun = ''

async function tick() {
  const now = new Date()
  const dayKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`

  if (
    now.getUTCDay() === CRON_DAY &&
    now.getUTCHours() === CRON_HOUR_UTC &&
    lastRun !== dayKey
  ) {
    lastRun = dayKey
    console.log('[SlotCron] Iniciando geração semanal de slots...')
    try {
      const result = await generateSlotsForCompany(undefined, 60)
      console.log(
        `[SlotCron] Concluído: ${result.companies} empresas, ${result.slots_processed} slots processados.`,
      )
    } catch (err) {
      console.error('[SlotCron] Erro na geração semanal:', err)
    }
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null

export function startSlotCron() {
  if (intervalId) return
  console.log('[SlotCron] Cron job registrado — segunda-feira 06:00 BRT')
  // Verifica a cada 60 segundos
  intervalId = setInterval(tick, 60_000)
}

export function stopSlotCron() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}
