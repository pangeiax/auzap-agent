import { buildContext, contextToSystemPrompt } from './brain.context'
import { TOOLS, executeTool } from './brain.tools'
import { BrainMessage, BrainAlert } from './brain.types'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const MAX_TOOL_ROUNDS = 5

export class BrainService {

  async chat(
    companyId: number,
    message: string,
    history: BrainMessage[]
  ): Promise<{ reply: string; alerts: BrainAlert[] }> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY não configurada')

    const ctx = await buildContext(companyId)
    const systemPrompt = contextToSystemPrompt(ctx)
    const recentHistory = history.slice(-10)

    let messages: any[] = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: message },
    ]

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 1000,
          temperature: 0.3,
          messages,
          tools: TOOLS,
          tool_choice: 'auto',
        }),
      })

      if (!response.ok) {
        const err = await response.text()
        throw new Error(`OpenAI error: ${err}`)
      }

      const data = await response.json()
      const choice = data.choices?.[0]

      if (choice?.finish_reason === 'stop') {
        return {
          reply: choice.message.content ?? 'Não consegui gerar uma resposta.',
          alerts: ctx.alerts,
        }
      }

      if (choice?.finish_reason === 'tool_calls') {
        const assistantMessage = choice.message
        messages.push(assistantMessage)

        for (const toolCall of assistantMessage.tool_calls ?? []) {
          const toolName = toolCall.function.name
          const toolArgs = JSON.parse(toolCall.function.arguments ?? '{}')
          const toolResult = await executeTool(toolName, toolArgs, companyId)
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult,
          })
        }
        continue
      }

      break
    }

    return {
      reply: 'Não consegui processar sua pergunta. Tente novamente.',
      alerts: ctx.alerts,
    }
  }
}
