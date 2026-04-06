import redis from '../../lib/redis'
import { getBrainTodayIsoInTz } from '../../secondBrain/clockContext'

const REDIS_KEY_PREFIX = 'secondbrain:daily-msg'
/** TTL longo o bastante para cobrir o “dia” no fuso usado na chave + folga. */
const REDIS_KEY_TTL_SECONDS = 172800

export type ReserveSecondBrainDailyResult =
  | { ok: true; used: number }
  | { ok: false; used: number }
  /** Redis indisponível: consumo não contabilizado no painel */
  | { ok: true; used: -1 }

function dailyKey(companyId: number): string {
  const day = getBrainTodayIsoInTz()
  return `${REDIS_KEY_PREFIX}:${companyId}:${day}`
}

/**
 * Lê quantas mensagens já foram contadas hoje (sem incrementar).
 */
export async function getSecondBrainDailyUsage(companyId: number): Promise<number> {
  const key = dailyKey(companyId)
  try {
    const raw = await redis.get(key)
    const n = raw ? Number.parseInt(raw, 10) : 0
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch (e) {
    console.error('[SecondBrain] Redis indisponível ao ler uso diário:', e)
    return 0
  }
}

/**
 * Reserva 1 unidade do limite diário (INCR atômico). Se passar do limite, reverte (DECR) e retorna ok: false.
 * Falha do Redis: permite a requisição (fail-open) e registra log — evita derrubar o chat inteiro.
 */
export async function reserveSecondBrainDailyMessage(
  companyId: number,
  dailyLimit: number,
): Promise<ReserveSecondBrainDailyResult> {
  if (dailyLimit <= 0) return { ok: false, used: 0 }

  const key = dailyKey(companyId)

  try {
    const n = await redis.incr(key)
    if (n === 1) {
      await redis.expire(key, REDIS_KEY_TTL_SECONDS)
    }
    if (n > dailyLimit) {
      await redis.decr(key)
      return { ok: false, used: dailyLimit }
    }
    return { ok: true, used: n }
  } catch (e) {
    console.error('[SecondBrain] Redis indisponível para limite diário; permitindo mensagem:', e)
    return { ok: true, used: -1 }
  }
}
