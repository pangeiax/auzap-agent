import { getBrainDateContextPromptLine } from '../../secondBrain/clockContext'
import { sanitizeAssistantHistoryContent, sanitizeUserFacingReply } from '../../secondBrain/sanitize'
import type { BrainMessage } from './brain.types'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

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
  const prior = toMessages(params.history, 10)
  const system = `Você é ${params.assistantName}, assistente do petshop ${params.petshopName} no painel do dono.
${getBrainDateContextPromptLine()}
Responda em português brasileiro, de forma breve, calorosa e natural.
Esta é uma conversa geral: cumprimente, agradeça ou explique de forma curta o que você pode fazer (responder perguntas sobre os dados do petshop, ajudar a agendar ou montar campanhas) sem inventar números.
Não gere SQL nem JSON estruturado. Não use blocos de código.`

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: system },
    ...prior.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: params.message },
  ]

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.5,
      max_completion_tokens: 400,
      messages,
    }),
  })

  if (!res.ok) {
    return {
      reply: `Oi! Sou o assistente do ${params.petshopName}. Posso ajudar com dados do negócio, agendamentos ou campanhas — é só dizer o que precisa.`,
    }
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) {
    return {
      reply: `Oi! Tudo certo por aqui. Se quiser ver números do ${params.petshopName} ou agendar um cliente, me avise.`,
    }
  }

  return { reply: sanitizeUserFacingReply(text) }
}
