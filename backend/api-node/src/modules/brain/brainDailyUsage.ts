import redis from '../../lib/redis'
import { getBrainTodayIsoInTz } from '../../secondBrain/clockContext'

const REDIS_KEY_PREFIX = 'secondbrain:daily-msg'
/** TTL longo o bastante para cobrir o “dia” no fuso usado na chave + folga. */
const REDIS_KEY_TTL_SECONDS = 172800

/**
 * Reserva 1 unidade do limite diário (INCR atômico). Se passar do limite, reverte (DECR) e retorna false.
 * Falha do Redis: permite a requisição (fail-open) e registra log — evita derrubar o chat inteiro.
 */
export async function reserveSecondBrainDailyMessage(companyId: number, dailyLimit: number): Promise<boolean> {
  if (dailyLimit <= 0) return false

  const day = getBrainTodayIsoInTz()
  const key = `${REDIS_KEY_PREFIX}:${companyId}:${day}`

  try {
    const n = await redis.incr(key)
    if (n === 1) {
      await redis.expire(key, REDIS_KEY_TTL_SECONDS)
    }
    if (n > dailyLimit) {
      await redis.decr(key)
      return false
    }
    return true
  } catch (e) {
    console.error('[SecondBrain] Redis indisponível para limite diário; permitindo mensagem:', e)
    return true
  }
}
