/**
 * Remove trechos que não devem voltar ao LLM nem aparecer para o usuário (SQL vazada, blocos de código).
 */

export function sanitizeAssistantHistoryContent(content: string): string {
  let s = content.replace(/```(?:sql)?[\s\S]*?```/gi, '')
  s = s
    .split('\n')
    .filter((line) => !lineLooksLikeSqlLine(line))
    .join('\n')
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

function lineLooksLikeSqlLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (/^SELECT\s+/i.test(t)) return true
  if (/^WITH\s+\w+\s+AS\s*\(/i.test(t)) return true
  if (/^LIMIT\s+\d+\s*;?$/i.test(t)) return true
  return false
}

/** Última camada: resposta do modelo ainda não pode conter SQL accidental. */
export function sanitizeUserFacingReply(text: string): string {
  let s = text.replace(/```(?:sql)?[\s\S]*?```/gi, '')
  const lines = s.split('\n').filter((line) => !lineLooksLikeSqlLine(line))
  s = lines.join('\n').trim()
  return s.replace(/\n{3,}/g, '\n\n').trim() || 'Não consegui formular a resposta. Tente de novo com outra pergunta.'
}
