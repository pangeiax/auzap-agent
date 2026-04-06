import { getBrainDateContextPromptLine } from '../../secondBrain/clockContext'
import {
  OPENAI_RESPONSES_URL,
  extractResponsesAssistantText,
  responsesChatMessage,
} from '../../secondBrain/openaiResponses'
import { sanitizeAssistantHistoryContent, sanitizeUserFacingReply } from '../../secondBrain/sanitize'
import { BRAIN_CONVERSE_HISTORY_LIMIT } from './brainPlanConstants'
import type { BrainMessage } from './brain.types'

function toMessages(history: BrainMessage[], max: number): Array<{ role: 'user' | 'assistant'; content: string }> {
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

export async function runBrainConverse(params: {
  apiKey: string
  model: string
  petshopName: string
  assistantName: string
  message: string
  history: BrainMessage[]
}): Promise<{ reply: string }> {
  const prior = toMessages(params.history, BRAIN_CONVERSE_HISTORY_LIMIT)
  const system = `Você é ${params.assistantName}, assistente do petshop ${params.petshopName} no painel do dono.
${getBrainDateContextPromptLine()}
Responda em português brasileiro, de forma breve, calorosa e natural.
Esta é uma conversa geral: cumprimente, agradeça ou explique de forma curta o que você pode fazer (responder perguntas sobre os dados do petshop, ajudar a agendar ou montar campanhas) sem inventar números.
Não gere SQL nem JSON estruturado. Não use blocos de código.
Se o dono pedir números, listagens ou relatórios do negócio, diga que para isso ele pode perguntar direto (ex.: "quantos clientes tenho?") e o painel aciona a consulta de dados; se pedir agendar/cancelar/remarcar ou campanha, que use um pedido explícito nesse sentido para o assistente acionar as ferramentas certas.`

  const input = [
    ...prior.map((m) => responsesChatMessage(m.role, m.content)),
    responsesChatMessage('user', params.message),
  ]

  const res = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      instructions: system,
      input,
      temperature: 0.5,
      max_output_tokens: 400,
      store: false,
    }),
  })

  if (!res.ok) {
    return {
      reply: `Oi! Sou o assistente do ${params.petshopName}. Posso ajudar com dados do negócio, agendamentos ou campanhas — é só dizer o que precisa.`,
    }
  }

  const data = (await res.json()) as { output?: unknown[]; output_text?: string }
  const text = extractResponsesAssistantText(data) || undefined
  if (!text) {
    return {
      reply: `Oi! Tudo certo por aqui. Se quiser ver números do ${params.petshopName} ou agendar um cliente, me avise.`,
    }
  }

  return { reply: sanitizeUserFacingReply(text) }
}
