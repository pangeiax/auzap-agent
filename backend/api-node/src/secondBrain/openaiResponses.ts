/**
 * OpenAI Responses API (/v1/responses) — usado pelo Second Brain no lugar de Chat Completions.
 * @see https://platform.openai.com/docs/guides/migrate-to-responses
 */

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

/**
 * Mensagem no formato da Responses API.
 * - user: partes `input_text` (entrada do dono).
 * - assistant: partes `output_text` — a API rejeita `input_text` em role assistant
 *   ("Supported values are: 'output_text' and 'refusal'").
 */
export function responsesChatMessage(
  role: 'user' | 'assistant',
  text: string,
): {
  type: 'message'
  role: typeof role
  content: Array<{ type: 'input_text' | 'output_text'; text: string }>
} {
  return {
    type: 'message',
    role,
    content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
  }
}

export function responsesUserMessage(text: string) {
  return responsesChatMessage('user', text)
}

/** Ferramentas no formato Chat Completions (type + function aninhado). */
export type ChatStyleFunctionTool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

/** Converte para o formato interno da Responses API (strict false: schemas atuais do brain não são strict). */
export function chatFunctionToolsToResponsesTools(
  tools: readonly ChatStyleFunctionTool[],
): Array<Record<string, unknown>> {
  return tools.map((t) => {
    const f = t.function
    return {
      type: 'function',
      name: f.name,
      ...(f.description != null && f.description !== '' ? { description: f.description } : {}),
      parameters: f.parameters,
      strict: false,
    }
  })
}

type ParsedResponse = {
  output?: unknown[]
  output_text?: string | null
}

function appendMessageContentParts(content: unknown, parts: string[]): void {
  if (typeof content === 'string' && content.trim()) {
    parts.push(content)
    return
  }
  if (!Array.isArray(content)) return
  for (const c of content) {
    if (typeof c === 'string' && c.trim()) {
      parts.push(c)
      continue
    }
    if (!c || typeof c !== 'object') continue
    const p = c as Record<string, unknown>
    if (p.type === 'output_text' && typeof p.text === 'string') parts.push(p.text)
    else if (p.type === 'text' && typeof p.text === 'string') parts.push(p.text)
    else if (
      (p.type === 'output_json' || p.type === 'json') &&
      p.json != null &&
      typeof (p.json as object) === 'object'
    ) {
      parts.push(JSON.stringify(p.json))
    } else if (p.type === 'output_json' && typeof p.text === 'string') parts.push(p.text)
  }
}

/** Texto do assistente: campo output_text ou itens message/output_text em output. */
export function extractResponsesAssistantText(data: ParsedResponse): string {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim()
  }
  const out = data.output
  if (!Array.isArray(out)) return ''
  const parts: string[] = []
  for (const item of out) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (o.type !== 'message' || o.role !== 'assistant') continue
    appendMessageContentParts(o.content, parts)
  }
  return parts.join('').trim()
}

export function extractResponsesFunctionCalls(
  data: ParsedResponse,
): Array<{ call_id: string; name: string; arguments: string }> {
  const out = data.output
  if (!Array.isArray(out)) return []
  const calls: Array<{ call_id: string; name: string; arguments: string }> = []
  for (const item of out) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (o.type !== 'function_call') continue
    const call_id = typeof o.call_id === 'string' ? o.call_id : ''
    const name = typeof o.name === 'string' ? o.name : ''
    const args = typeof o.arguments === 'string' ? o.arguments : '{}'
    if (call_id) calls.push({ call_id, name, arguments: args })
  }
  return calls
}
