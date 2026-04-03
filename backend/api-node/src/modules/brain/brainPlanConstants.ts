/**
 * Limites do Second Brain / campanhas por plano — ajuste aqui conforme o produto evolui.
 * Chaves = valor de `saas_companies.plan` em minúsculas (ex.: "pro", "free").
 */

/** Quantos tutores podem aparecer no rascunho de campanha (lista para o usuário escolher). */
export const SECOND_BRAIN_CAMPAIGN_DRAFT_MAX_TARGETS = 10

// ─── Plano Pro (ajuste números aqui) ─────────────────────────────────────────

/** Mensagens do usuário ao Second Brain por dia (contador por empresa; fuso em BRAIN_TIMEZONE). */
export const SECOND_BRAIN_PRO_DAILY_MESSAGE_LIMIT = 10

/** Destinatários por clique em “Enviar campanha” no plano Pro. */
export const SECOND_BRAIN_PRO_CAMPAIGN_SEND_MAX = 3

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
