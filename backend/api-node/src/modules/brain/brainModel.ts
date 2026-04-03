/** Modelo OpenAI compartilhado pelo cérebro (router, conversa, SQL, tools). */
export function getBrainOpenAiModel(): string {
  return (
    process.env.OPENAI_SECOND_BRAIN_MODEL?.trim() ||
    process.env.OPENAI_BRAIN_MODEL?.trim() ||
    'gpt-4o-mini'
  )
}
