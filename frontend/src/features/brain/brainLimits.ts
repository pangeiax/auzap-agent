/**
 * Fallback se o rascunho de campanha (JSON antigo) não incluir `max_recipients_per_send`.
 * Alinhe com `SECOND_BRAIN_PRO_CAMPAIGN_SEND_MAX` em `brainPlanConstants.ts` (backend).
 */
export const BRAIN_CAMPAIGN_SEND_FALLBACK = 3
