/**
 * Remove trechos que não devem voltar ao LLM nem aparecer para o usuário (SQL vazada, blocos de código).
 */

const BRAIN_UI_JSON_TYPES = new Set([
  'campaign_draft',
  'appointment_created',
  'appointment_draft',
  'manual_schedule_draft',
  'manual_schedule_batch_draft',
  'cancel_appointment_draft',
  'cancel_appointments_batch_draft',
  'reschedule_appointments_batch_draft',
])

/**
 * Remove objetos JSON de cartão do painel (brain) do texto. Ignora `{` que não abrem esse JSON
 * (ex.: placeholder **{{nome_cliente}}**), para não abortar antes dos blocos reais.
 */
export function stripBrainUiJsonFromText(text: string): string {
  let s = text ?? ''
  let searchFrom = 0
  while (true) {
    const i = s.indexOf('{', searchFrom)
    if (i < 0) break
    let found = false
    for (let j = s.length; j > i; j--) {
      try {
        const slice = s.slice(i, j)
        const parsed = JSON.parse(slice) as { type?: string }
        if (parsed?.type && BRAIN_UI_JSON_TYPES.has(parsed.type)) {
          s = (s.slice(0, i) + s.slice(j)).replace(/\n{3,}/g, '\n\n').trim()
          found = true
          searchFrom = 0
          break
        }
      } catch {
        /* continuar */
      }
    }
    if (!found) searchFrom = i + 1
  }
  return s.trim()
}

export function sanitizeAssistantHistoryContent(content: string): string {
  let s = content.replace(/```(?:sql)?[\s\S]*?```/gi, '')
  s = stripBrainUiJsonFromText(s)
  s = s
    .split('\n')
    .filter((line) => !lineLooksLikeSqlLine(line) && !lineLooksLikeBrainUiDraftJson(line))
    .join('\n')
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

/** JSON de cartão do painel (uma linha) não deve voltar no histórico para o LLM. */
function lineLooksLikeBrainUiDraftJson(line: string): boolean {
  const t = line.trim()
  if (!t.startsWith('{') || !t.endsWith('}') || t.includes('\n')) return false
  return /"type"\s*:\s*"(campaign_draft|appointment_created|appointment_draft|manual_schedule_draft|manual_schedule_batch_draft|cancel_appointment_draft|cancel_appointments_batch_draft|reschedule_appointments_batch_draft)"/.test(
    t,
  )
}

function lineLooksLikeSqlLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (/^SELECT\s+/i.test(t)) return true
  if (/^WITH\s+\w+\s+AS\s*\(/i.test(t)) return true
  if (/^LIMIT\s+\d+\s*;?$/i.test(t)) return true
  return false
}

/** Última camada: resposta do modelo ainda não pode conter SQL accidental. Não remove JSON de cartão do brain — o frontend extrai e o backend pode reapendar lastStructuredLine. */
export function sanitizeUserFacingReply(text: string): string {
  let s = text.replace(/```(?:sql)?[\s\S]*?```/gi, '')
  const lines = s.split('\n').filter((line) => !lineLooksLikeSqlLine(line))
  s = lines.join('\n').trim()
  return s.replace(/\n{3,}/g, '\n\n').trim() || 'Não consegui formular a resposta. Tente de novo com outra pergunta.'
}
