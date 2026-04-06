import { getBrainDateContextPromptLine, getBrainTodayIsoInTz, getBrainTimezone } from '../clockContext'
import { OPENAI_RESPONSES_URL, extractResponsesAssistantText, responsesUserMessage } from '../openaiResponses'
import { buildSchemaContext } from '../schema/buildSchemaContext'
import type { AnalyticsBrainMessage } from '../types'

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

  const isoToday = getBrainTodayIsoInTz()
  const tz = getBrainTimezone()

  const system = `Você gera apenas consultas SQL PostgreSQL para o dono de um petshop (somente leitura).
${schemaBlock}

COMPANY_ID fixo desta sessão: ${params.companyId}
Nome do petshop: ${params.petshopName}
${getBrainDateContextPromptLine()}

Antes de escrever cada coluna, confira se ela aparece em "Colunas:" do TABLE correspondente. Se o usuário pedir "última visita" e a tabela for clients, lembre: clients não tem last_visit — veja as Notas e use petshop_appointments ou dashboard_client_recurrence.

Boas práticas:
- **Isolamento por empresa (obrigatório):** use sempre \`company_id = ${params.companyId}\` para cada tabela permitida envolvida: no WHERE (AND) e/ou no ON de **INNER JOIN** com coluna qualificada (ex.: \`pa.company_id = ${params.companyId}\` e \`c.company_id = ${params.companyId}\`). Evite LEFT JOIN só com filtro de empresa no lado anulável sem WHERE equivalente.
- Proibido SELECT *; colunas finais devem ser legíveis para o dono (nomes, valores, datas) — nunca exponha service_id, client_id, company_id na lista final se puder evitar (use JOIN e traga ps.name, c.name, etc.).
- Ranking "serviço mais usado": JOIN petshop_services ps ON ps.id = pa.service_id AND ps.company_id = pa.company_id; SELECT ps.name, COUNT(*)::int AS total — não retorne só service_id.
- Preço ou detalhe de um serviço pelo nome citado pelo usuário: filtre com ps.name ILIKE '%trecho%' (case insensitive); inclua price e price_by_size (json) quando existirem. Não use igualdade exata '=Banho Simples' se o cadastro puder variar maiúsculas.
- Perguntas sobre conversas: JOIN agent_conversations com clients para clients.name; se precisar exibir telefone ao dono, use clients.manual_phone (rótulo amigável), não clients.phone (canal técnico). Se manual_phone for NULL/vazio, mostre «Numero nao identificado».
- Agendamentos: scheduled_date em petshop_appointments (não existe appointment_date).
- "Próximos agendamentos", "agenda futura", "o que vem pela frente", "hoje e adiante": inclua o dia de hoje — use pa.scheduled_date >= DATE '${isoToday}' (ou equivalente com (CURRENT_TIMESTAMP AT TIME ZONE '${tz}')::date). Não exclua hoje salvo o dono pedir explicitamente "a partir de amanhã" ou "só dias futuros sem hoje".
- Listagens operacionais de agenda (não histórico fechado): por padrão AND pa.status NOT IN ('cancelled', 'no_show') salvo pedido explícito para incluir cancelados.
- Inclua pa.id AS appointment_id quando a lista for útil para o dono remarcar/cancelar depois (UUID do agendamento).
- Ordene por data ou contagem quando fizer sentido (ORDER BY ... DESC).

Retorne um JSON com a chave "sql" contendo uma única string com a consulta completa.
Não use markdown. Não explique. Apenas o JSON.${fixBlock}`

  // Responses API: text.format json_object exige a palavra "json" no conteúdo das mensagens de input (veja doc OpenAI).
  const user = `Sua saída deve ser exclusivamente um objeto json com a chave "sql" (string da consulta SQL), sem markdown.

Histórico recente:
${histText || '(vazio)'}

Pergunta atual:
${params.userMessage}`

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
      temperature: 0.1,
      max_output_tokens: 1200,
      text: { format: { type: 'json_object' } },
      store: false,
    }),
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`OpenAI (sql): ${t}`)
  }

  const data = (await res.json()) as { output?: unknown[]; output_text?: string }
  let raw = extractResponsesAssistantText(data)
  raw = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  let parsed: { sql?: string }
  try {
    parsed = JSON.parse(raw) as { sql?: string }
  } catch {
    throw new Error(
      raw.length === 0
        ? 'Resposta do modelo vazia (verifique modelo compatível com /v1/responses e max_output_tokens).'
        : 'Resposta do modelo não é JSON válido.',
    )
  }
  const sql = typeof parsed.sql === 'string' ? parsed.sql.trim() : ''
  if (!sql) throw new Error('JSON sem campo sql.')
  return sql
}
