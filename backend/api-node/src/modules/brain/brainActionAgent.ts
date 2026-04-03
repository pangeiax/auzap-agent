import { getBrainDateContextPromptLine } from '../../secondBrain/clockContext'
import { sanitizeAssistantHistoryContent, sanitizeUserFacingReply } from '../../secondBrain/sanitize'
import { ACTION_BRAIN_TOOLS, executeActionBrainTool } from './brainActionTools'
import type { BrainMessage } from './brain.types'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

const MAX_TOOL_STEPS = 12

type OpenAiToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type OpenAiAssistantMessage = {
  role: 'assistant'
  content: string | null
  tool_calls?: OpenAiToolCall[]
}

function tryParseStructuredUiPayload(toolOutput: string): string | null {
  const trimmed = toolOutput.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const p = JSON.parse(trimmed) as { type?: string }
    if (p.type === 'campaign_draft' || p.type === 'appointment_created') {
      return JSON.stringify(p)
    }
  } catch {
    return null
  }
  return null
}

function buildHistoryMessages(history: BrainMessage[], max: number): Array<{ role: 'user' | 'assistant'; content: string }> {
  return history
    .filter((m) => m && typeof m.content === 'string')
    .slice(-max)
    .map((m): { role: 'user' | 'assistant'; content: string } => {
      const role: 'user' | 'assistant' = m.role === 'assistant' ? 'assistant' : 'user'
      const content = role === 'assistant' ? sanitizeAssistantHistoryContent(m.content) : m.content
      return { role, content }
    })
    .filter((m) => m.content.length > 0)
}

export async function runBrainActionAgent(params: {
  apiKey: string
  model: string
  companyId: number
  petshopName: string
  assistantName: string
  message: string
  history: BrainMessage[]
}): Promise<{ reply: string }> {
  const hist = buildHistoryMessages(params.history, 12)

  const system = `Você é ${params.assistantName}, assistente do petshop ${params.petshopName} no painel do dono.
${getBrainDateContextPromptLine()}

Você ajuda com operações: agendamento manual (buscar cliente, pets, serviços, horários livres, confirmar e criar), cadastro de cliente, e rascunho de campanha de reativação (lista de clientes + texto sugerido).

Regras:
- Use as ferramentas; não invente UUIDs nem IDs numéricos. client_id e pet_id vêm de search_clients e get_client_pets_for_scheduling. service_id vem de list_active_services.
- Telefone com DDI em dígitos (ex.: 5511999999999).
- Antes de create_manual_appointment, chame get_available_times e use um slot_id retornado para aquela data.
- Para campanha: use search_clients se precisar; create_campaign_draft pode listar até vários UUIDs no rascunho (o painel mostra todos para o dono escolher); o envio respeita o limite do plano (indicado no JSON).
- Responda ao dono em português brasileiro, caloroso e objetivo. Não cite nomes internos das ferramentas.
- Quando create_campaign_draft ou create_manual_appointment retornarem JSON com "type" campaign_draft ou appointment_created, copie esse objeto JSON inteiro (uma linha, sem markdown) ao final da sua mensagem, depois do texto amigável, para o painel exibir o cartão.`

  const messages: Array<
    | { role: 'system'; content: string }
    | { role: 'user' | 'assistant'; content: string }
    | { role: 'assistant'; content: string | null; tool_calls: OpenAiToolCall[] }
    | { role: 'tool'; tool_call_id: string; content: string }
  > = [
    { role: 'system', content: system },
    ...hist.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: params.message },
  ]

  let lastStructuredLine: string | null = null
  let steps = 0

  while (steps < MAX_TOOL_STEPS) {
    steps += 1

    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        temperature: 0.2,
        max_completion_tokens: 1200,
        tools: ACTION_BRAIN_TOOLS,
        tool_choice: 'auto',
        messages,
      }),
    })

    if (!res.ok) {
      const t = await res.text()
      console.error('[BrainActionAgent] OpenAI error:', t.slice(0, 500))
      return {
        reply: `Não consegui usar as ferramentas agora. Tente de novo em instantes ou reformule o pedido (agendamento ou campanha).`,
      }
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: OpenAiAssistantMessage }>
    }
    const msg = data.choices?.[0]?.message
    if (!msg || msg.role !== 'assistant') {
      return { reply: 'Não obtive resposta do assistente. Tente novamente.' }
    }

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: msg.content,
        tool_calls: msg.tool_calls,
      })
    } else {
      messages.push({
        role: 'assistant',
        content: msg.content ?? '',
      })
    }

    if (!msg.tool_calls?.length) {
      let reply = (msg.content ?? '').trim()
      if (!reply) {
        reply = 'Pronto! Se precisar de mais algum agendamento ou campanha, é só falar.'
      }
      if (lastStructuredLine && !reply.includes(lastStructuredLine)) {
        reply = `${reply}\n\n${lastStructuredLine}`
      }
      return { reply: sanitizeUserFacingReply(reply) }
    }

    for (const tc of msg.tool_calls) {
      const name = tc.function?.name ?? ''
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.function?.arguments || '{}') as Record<string, unknown>
      } catch {
        args = {}
      }

      let output: string
      try {
        output = await executeActionBrainTool(name, args, params.companyId)
      } catch (e) {
        output = e instanceof Error ? e.message : String(e)
      }

      const structured = tryParseStructuredUiPayload(output)
      if (structured) lastStructuredLine = structured

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: output.length > 12000 ? output.slice(0, 12000) + '… [truncado]' : output,
      })
    }
  }

  return {
    reply: `A conversa com as ferramentas ficou longa demais. Tente dividir em um pedido por vez (ex.: primeiro buscar o cliente, depois escolher horário).`,
  }
}
