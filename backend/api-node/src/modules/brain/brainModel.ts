/** Modelo OpenAI compartilhado pelo cérebro (router, conversa, SQL, tools). */
export function getBrainOpenAiModel(companyId?: number): string {
  // Override por company (ex.: company 11 com modelo mais robusto para Second Brain).
  if (companyId != null) {
    const perCompany = process.env[`OPENAI_MODEL_COMPANY_${companyId}`]?.trim()
    if (perCompany) return perCompany
  }
  return (
    process.env.OPENAI_SECOND_BRAIN_MODEL?.trim() ||
    process.env.OPENAI_BRAIN_MODEL?.trim() ||
    'gpt-4o-mini'
  )
}
