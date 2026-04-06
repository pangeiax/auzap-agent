/**
 * Limites do Second Brain / campanhas por plano.
 * Chaves = valor de `saas_companies.plan` em minúsculas (ex.: "pro", "free").
 *
 * Mensagens diárias e destinatários por campanha no **Pro** vêm do `.env` (api-node):
 * `SECOND_BRAIN_PRO_DAILY_MESSAGE_LIMIT`, `SECOND_BRAIN_PRO_CAMPAIGN_SEND_MAX`.
 */

function parseEnvNonNegativeInt(envName: string, fallback: number): number {
  const raw = process.env[envName]?.trim()
  if (raw === undefined || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return fallback
  return n
}

/** Quantos tutores podem aparecer no rascunho de campanha (lista para o usuário escolher). */
export const SECOND_BRAIN_CAMPAIGN_DRAFT_MAX_TARGETS = 10

// ─── Plano Pro (override via .env) ───────────────────────────────────────────

/** Mensagens do usuário ao Second Brain por dia (contador por empresa; fuso em BRAIN_TIMEZONE). */
export const SECOND_BRAIN_PRO_DAILY_MESSAGE_LIMIT = parseEnvNonNegativeInt(
  'SECOND_BRAIN_PRO_DAILY_MESSAGE_LIMIT',
  100,
)

/** Quantas mensagens (user+assistant) entram no contexto do agente de ações (agendamento, campanha, cancelamento). */
export const BRAIN_ACTION_HISTORY_LIMIT = 100

/** Idem modo conversa livre (sem ferramentas). */
export const BRAIN_CONVERSE_HISTORY_LIMIT = 1000

/** Idem classificador que escolhe sql vs action vs converse. */
export const BRAIN_ROUTER_HISTORY_LIMIT = 8

/** Máximo de itens por chamada às tools em lote (criar / remarcar / cancelar agendamentos). */
export const BRAIN_BATCH_APPOINTMENTS_MAX = 10

/** Máximo de agendamentos retornados em search_appointments. */
export const BRAIN_SEARCH_APPOINTMENTS_MAX = 25

/** Destinatários por clique em “Enviar campanha” no plano Pro. */
export const SECOND_BRAIN_PRO_CAMPAIGN_SEND_MAX = parseEnvNonNegativeInt('SECOND_BRAIN_PRO_CAMPAIGN_SEND_MAX', 3)

// ─── Mensagens fixas ao usuário ─────────────────────────────────────────────

/** Plano sem acesso ao assistente do painel (free / desconhecido sem upgrade). */
export const SECOND_BRAIN_MESSAGE_PLAN_NOT_AVAILABLE =
  'O assistente AuZap.IA neste painel (dados, agendamentos e campanhas guiadas) não está disponível no seu plano atual. Faça upgrade para o plano Pro para liberar esse recurso.'

export function secondBrainMessageDailyLimitReached(dailyLimit: number): string {
  return `Você atingiu o limite de ${dailyLimit} mensagens ao assistente hoje. Tente de novo amanhã (contagem pelo fuso configurado no servidor, padrão Brasília).`
}

// ─── Tabela por plano ───────────────────────────────────────────────────────

export type SecondBrainPlanLimits = {
  secondBrainEnabled: boolean
  /** 0 = sem uso / plano desligado */
  dailyMessageLimit: number
  /** Máximo de destinatários por envio de campanha (WhatsApp). */
  campaignSendMaxRecipients: number
}

const FREE_LIMITS: SecondBrainPlanLimits = {
  secondBrainEnabled: false,
  dailyMessageLimit: 0,
  campaignSendMaxRecipients: 0,
}

const PRO_LIMITS: SecondBrainPlanLimits = {
  secondBrainEnabled: true,
  dailyMessageLimit: SECOND_BRAIN_PRO_DAILY_MESSAGE_LIMIT,
  campaignSendMaxRecipients: SECOND_BRAIN_PRO_CAMPAIGN_SEND_MAX,
}

/** Mapeamento plan → limites. Inclua novos planos (ex.: enterprise) conforme necessário. */
export const SECOND_BRAIN_PLAN_LIMITS_BY_SLUG: Record<string, SecondBrainPlanLimits> = {
  free: FREE_LIMITS,
  pro: PRO_LIMITS,
}

export function resolveSecondBrainPlanLimits(plan: string | null | undefined): SecondBrainPlanLimits {
  const slug = (plan ?? 'free').trim().toLowerCase()
  return SECOND_BRAIN_PLAN_LIMITS_BY_SLUG[slug] ?? FREE_LIMITS
}
