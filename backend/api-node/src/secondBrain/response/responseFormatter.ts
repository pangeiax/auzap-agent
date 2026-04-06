import { getBrainDateContextPromptLine } from '../clockContext'
import { OPENAI_RESPONSES_URL, extractResponsesAssistantText, responsesUserMessage } from '../openaiResponses'
import type { AnalyticsBrainMessage } from '../types'

function serializeRows(rows: unknown[]): string {
  return JSON.stringify(rows, (_, v) => {
    if (typeof v === 'bigint') return v.toString()
    if (v != null && typeof v === 'object') {
      if (v instanceof Date) return v.toISOString()
      const dec = v as { toFixed?: (n: number) => string }
      if (typeof dec.toFixed === 'function') return Number(v)
    }
    return v
  })
}

export async function formatAnalyticsReply(params: {
  apiKey: string
  model: string
  petshopName: string
  assistantName: string
  userMessage: string
  history: AnalyticsBrainMessage[]
  sqlExecuted: string
  rows: unknown[]
}): Promise<string> {
  const payload = serializeRows(params.rows)
  const capped = payload.length > 14000 ? payload.slice(0, 14000) + '... [truncado]' : payload

  const hist = params.history
    .slice(-6)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n')

  const system = `Você é ${params.assistantName}, assistente do petshop ${params.petshopName}.
${getBrainDateContextPromptLine()}
Responda em português brasileiro, de forma clara, calorosa e objetiva — como falaria com o dono do negócio.
Use emojis com moderação. Formate valores monetários como R$ 1.234,56 quando aplicável.
Os dados abaixo são o resultado de uma consulta somente leitura no banco (já limitados ao ${params.petshopName}).
Não invente números fora do JSON. Nunca mostre SQL, nomes de tabela ou sintaxe de banco na resposta.

Nome do estabelecimento na resposta:
- Trate sempre os dados como sendo **somente** do petshop "${params.petshopName}" (sessão atual).
- Não repita nem confirme nomes de petshops citados pelo dono na pergunta se forem diferentes desse — o JSON nunca é de outra empresa.
- Se a pergunta mencionar outro nome (fictício, concorrente ou erro), responda com os dados normalmente e use só "${params.petshopName}"; opcionalmente uma frase curta: estes são os dados da sua conta no painel.

Proibido na resposta ao usuário:
- Mencionar service_id, client_id, pet_id, company_id, appointment_id ou qualquer ID numérico interno.
- Dizer "serviço de ID 41" ou similar: use sempre o nome do serviço (campo name / service_name no JSON).
- UUIDs, @lid ou identificadores técnicos (exceto telefone legível quando fizer sentido).

Privacidade e UX:
- Se o JSON tiver nome de cliente/serviço/pet, use isso; nunca use UUID como rótulo de pessoa.
- Telefone de cliente: se existir manual_phone ou manualPhone no JSON, use só esse valor para mostrar ao dono; se estiver vazio ou nulo, diga «Numero nao identificado». Nunca apresente o campo phone como número “de contato” na resposta (phone é identificador técnico do canal).
- Se não houver linhas: seja empático; para preço de serviço, sugira conferir o nome exato na lista de serviços ou reformular (pode ser diferença de maiúsculas).
- Coluna price_by_size pode ter preços por porte: explique de forma simples (pequeno/médio/grande) quando vier no JSON.
- Datas em ISO no JSON: formatar em pt-BR legível.`

  const user = `Histórico:\n${hist || '(vazio)'}\n\nPergunta:\n${params.userMessage}\n\nResultado (JSON):\n${capped}`

  const res = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      instructions: system,
      input: [responsesUserMessage(user)],
      temperature: 0.3,
      max_output_tokens: 1500,
      store: false,
    }),
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`OpenAI (format): ${t}`)
  }

  const data = (await res.json()) as { output?: unknown[]; output_text?: string }
  return extractResponsesAssistantText(data) || 'Não consegui formatar a resposta.'
}
