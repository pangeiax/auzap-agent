import { getBrainDateContextPromptLine } from '../clockContext'
import { buildSchemaContext } from '../schema/buildSchemaContext'
import type { AnalyticsBrainMessage } from '../types'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

function compactHistory(history: AnalyticsBrainMessage[], maxMessages: number): AnalyticsBrainMessage[] {
  return history.slice(-maxMessages).filter((m) => m.role === 'user' || m.role === 'assistant')
}

export async function generateSqlWithLlm(params: {
  apiKey: string
  model: string
  companyId: number
  petshopName: string
  userMessage: string
  history: AnalyticsBrainMessage[]
  validationError?: string
  /** Erro do PostgreSQL na tentativa anterior (ex.: coluna inexistente). */
  executionErrorHint?: string
}): Promise<string> {
  const schemaBlock = await buildSchemaContext()
  const hist = compactHistory(params.history, 8)
  const histText = hist.map((m) => `${m.role}: ${m.content}`).join('\n')

  const fixParts: string[] = []
  if (params.executionErrorHint) {
    fixParts.push(`Erro ao executar a SQL anterior no PostgreSQL:\n${params.executionErrorHint}`)
  }
  if (params.validationError) {
    fixParts.push(`Validador interno:\n${params.validationError}`)
  }
  const fixBlock =
    fixParts.length > 0
      ? `\n${fixParts.join('\n\n')}\n\nGere uma nova SQL corrigida e executável, alinhada ao catálogo acima.\n`
      : ''

  const system = `Você gera apenas consultas SQL PostgreSQL para o dono de um petshop (somente leitura).
${schemaBlock}

COMPANY_ID fixo desta sessão: ${params.companyId}
Nome do petshop: ${params.petshopName}
${getBrainDateContextPromptLine()}

Antes de escrever cada coluna, confira se ela aparece em "Colunas:" do TABLE correspondente. Se o usuário pedir "última visita" e a tabela for clients, lembre: clients não tem last_visit — veja as Notas e use petshop_appointments ou dashboard_client_recurrence.

Boas práticas:
- Proibido SELECT *; colunas finais devem ser legíveis para o dono (nomes, valores, datas) — nunca exponha service_id, client_id, company_id na lista final se puder evitar (use JOIN e traga ps.name, c.name, etc.).
- Ranking "serviço mais usado": JOIN petshop_services ps ON ps.id = pa.service_id AND ps.company_id = pa.company_id; SELECT ps.name, COUNT(*)::int AS total — não retorne só service_id.
- Preço ou detalhe de um serviço pelo nome citado pelo usuário: filtre com ps.name ILIKE '%trecho%' (case insensitive); inclua price e price_by_size (json) quando existirem. Não use igualdade exata '=Banho Simples' se o cadastro puder variar maiúsculas.
- Perguntas sobre conversas: JOIN agent_conversations com clients para clients.name e clients.phone.
- Agendamentos: scheduled_date em petshop_appointments (não existe appointment_date).
- Ordene por data ou contagem quando fizer sentido (ORDER BY ... DESC).

Retorne um JSON com a chave "sql" contendo uma única string com a consulta completa.
Não use markdown. Não explique. Apenas o JSON.${fixBlock}`

  const user = `Histórico recente:\n${histText || '(vazio)'}\n\nPergunta atual:\n${params.userMessage}`

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.1,
      max_completion_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`OpenAI (sql): ${t}`)
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const raw = data.choices?.[0]?.message?.content?.trim() ?? ''
  let parsed: { sql?: string }
  try {
    parsed = JSON.parse(raw) as { sql?: string }
  } catch {
    throw new Error('Resposta do modelo não é JSON válido.')
  }
  const sql = typeof parsed.sql === 'string' ? parsed.sql.trim() : ''
  if (!sql) throw new Error('JSON sem campo sql.')
  return sql
}
