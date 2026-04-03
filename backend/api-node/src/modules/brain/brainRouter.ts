import type { BrainChatMode, BrainMessage } from './brain.types'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

function compactHistory(history: BrainMessage[], max: number): BrainMessage[] {
  return history
    .filter((m) => m && typeof m.content === 'string')
    .slice(-max)
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
}

/**
 * Atalho sem LLM: cumprimentos curtos sem pedido de dado ou ação.
 */
export function heuristicBrainMode(message: string): BrainChatMode | null {
  const t = message.trim()
  if (t.length > 120) return null

  const asksData =
    /\b(quantos|quantas|quanto|liste|listar|total|faturamento|receita|ticket|relatório|relatorio|ranking|média|media|estatística|estatistica|últim|ultim|quantidade de|gráfico|grafico|mostrar|exibir|buscar no sistema|dados de)\b/i.test(
      t,
    )
  const asksAction =
    /\b(agendar|agendamento|marcar|horário|horarios|disponível|disponiveis|vagas|slot|campanha|cadastrar cliente|criar cliente|novo cliente|reativação|reativacao|mensagem em massa|draft de campanha|horários livres|horarios livres)\b/i.test(
      t,
    )

  if (asksData || asksAction) return null

  const lower = t.toLowerCase()
  if (
    /^(oi|olá|ola|hey|hi|hello|bom dia|boa tarde|boa noite|e aí\??|e ai\??|salve)\b/i.test(lower) ||
    /^(obrigad|valeu|thanks|thank you)\b/i.test(lower) ||
    /^oi[\s,!.]*pessoal/i.test(lower)
  ) {
    return 'converse'
  }

  return null
}

export async function classifyBrainMode(params: {
  apiKey: string
  model: string
  message: string
  history: BrainMessage[]
  petshopName: string
}): Promise<BrainChatMode> {
  const quick = heuristicBrainMode(params.message)
  if (quick) return quick

  const hist = compactHistory(params.history, 8)
  const histText = hist.map((m) => `${m.role}: ${m.content}`).join('\n')

  const system = `Classifique a intenção da última mensagem do dono do petshop "${params.petshopName}" no painel.

Responda só com JSON: {"mode":"converse"|"sql"|"action"}

- converse: cumprimentos, agradecimentos, despedidas, conversa social, meta ("o que você faz?", "como funciona?"), opinião sem pedir número nem ação no sistema.
- sql: perguntas de dados em leitura — quantos/quem/quanto, listagens, relatórios, faturamento, histórico de clientes/agenda/conversas, estatísticas, rankings. Tudo que exige consultar o banco em SELECT.
- action: operações — agendar manualmente, ver horários livres, criar cliente, buscar cliente para marcar, campanha de reativação, rascunho de mensagem para vários clientes. Qualquer fluxo que use ferramentas de agendamento ou campanha.

Se a mensagem misturar relatório + agendar, prefira action se o foco imediato for agendar; prefira sql se for só análise de dados.`

  const user = `Histórico recente:\n${histText || '(vazio)'}\n\nÚltima mensagem:\n${params.message}`

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0,
      max_completion_tokens: 80,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })

  if (!res.ok) {
    return 'sql'
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const raw = data.choices?.[0]?.message?.content?.trim() ?? ''
  try {
    const parsed = JSON.parse(raw) as { mode?: string }
    if (parsed.mode === 'converse' || parsed.mode === 'sql' || parsed.mode === 'action') {
      return parsed.mode
    }
  } catch {
    /* fallback */
  }
  return 'sql'
}
