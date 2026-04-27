import { prisma } from '../../lib/prisma'
import { postgresErrorHintForLlm } from '../postgresErrorHint'
import { formatAnalyticsReply } from '../response/responseFormatter'
import { executeValidatedSelect } from '../sql/queryExecutor'
import { generateSqlWithLlm } from '../sql/sqlGenerator'
import { validatePetshopReadOnlySql } from '../sql/sqlValidator'
import { getMaxSqlLimit } from '../schema/buildSchemaContext'
import { sanitizeAssistantHistoryContent, sanitizeUserFacingReply } from '../sanitize'
import type { AnalyticsBrainMessage, AnalyticsBrainResult } from '../types'

function brainModel(companyId?: number): string {
  if (companyId != null) {
    const perCompany = process.env[`OPENAI_MODEL_COMPANY_${companyId}`]?.trim()
    if (perCompany) return perCompany
  }
  return (
    process.env.OPENAI_SECOND_BRAIN_MODEL?.trim() ||
    process.env.OPENAI_BRAIN_MODEL?.trim() ||
    'gpt-4o-mini'
  )
}

/** Só envia `meta.sql` na API se explicitamente habilitado (debug). Padrão: não expor. */
function exposeSql(): boolean {
  const v = process.env.SECOND_BRAIN_EXPOSE_SQL?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

async function fetchCompanyLabels(companyId: number): Promise<{ petshopName: string; assistantName: string }> {
  const rows = await prisma.$queryRaw<Array<{ name: string; assistant_name: string | null }>>`
    SELECT c.name, p.assistant_name
    FROM saas_companies c
    LEFT JOIN petshop_profile p ON p.company_id = c.id
    WHERE c.id = ${companyId}
    LIMIT 1
  `
  return {
    petshopName: rows[0]?.name ?? 'Petshop',
    assistantName: rows[0]?.assistant_name ?? 'Assistente',
  }
}

function normalizeHistory(history: AnalyticsBrainMessage[]): AnalyticsBrainMessage[] {
  return history
    .filter((m) => m && typeof m.content === 'string')
    .map((m) => {
      const role: 'user' | 'assistant' = m.role === 'assistant' ? 'assistant' : 'user'
      const content = role === 'assistant' ? sanitizeAssistantHistoryContent(m.content) : m.content
      return { role, content }
    })
    .filter((m) => m.content.length > 0)
}

function humanizeValidationFailure(petshopName: string, code?: string): string {
  if (code === 'TENANT') {
    return `Só tenho acesso aos dados do ${petshopName}. Não consigo consultar outras empresas nem informações gerais do sistema — só o que é do seu petshop.`
  }
  return `Não consegui montar essa consulta de forma segura. Tente reformular, ou pergunte sobre os dados do ${petshopName} (agenda, clientes, serviços, faturamento).`
}

export async function runAnalyticsBrainChat(params: {
  companyId: number
  message: string
  history: AnalyticsBrainMessage[]
  /** Evita segunda query à empresa quando o caller já carregou nome/assistente. */
  companyLabels?: { petshopName: string; assistantName: string }
}): Promise<AnalyticsBrainResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return { reply: 'O assistente não está configurado corretamente no servidor. Avise o suporte.' }
  }

  const model = brainModel(params.companyId)
  const maxLimit = getMaxSqlLimit()
  const { petshopName, assistantName } =
    params.companyLabels ?? (await fetchCompanyLabels(params.companyId))
  const hist = normalizeHistory(params.history)

  const maxAttempts = 4
  let validationError: string | undefined
  let executionErrorHint: string | undefined
  let lastValidationCode: string | undefined
  let sqlOut: string | undefined
  let lastFailureWasExecution = false

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let sql: string
    try {
      sql = await generateSqlWithLlm({
        apiKey,
        model,
        companyId: params.companyId,
        petshopName,
        userMessage: params.message,
        history: hist,
        validationError,
        executionErrorHint,
      })
    } catch (e) {
      console.error('[SecondBrain] generateSqlWithLlm:', e instanceof Error ? e.message : e)
      return {
        reply: `Não consegui processar essa pergunta agora. Tente de novo em instantes ou reformule o que você quer saber sobre o ${petshopName}.`,
      }
    }

    const v = validatePetshopReadOnlySql(sql, params.companyId, maxLimit)
    if (!v.ok) {
      lastFailureWasExecution = false
      validationError = v.message
      lastValidationCode = v.code
      executionErrorHint = undefined
      sqlOut = sql
      continue
    }

    validationError = undefined
    executionErrorHint = undefined
    sqlOut = v.normalizedSql
    let rows: unknown[]
    try {
      rows = await executeValidatedSelect(v.normalizedSql)
    } catch (err) {
      lastFailureWasExecution = true
      executionErrorHint = postgresErrorHintForLlm(err)
      validationError = undefined
      console.error('[SecondBrain] query execution failed (sanitized log; no SQL)')
      continue
    }

    try {
      const reply = await formatAnalyticsReply({
        apiKey,
        model,
        petshopName,
        assistantName,
        userMessage: params.message,
        history: hist,
        sqlExecuted: v.normalizedSql,
        rows,
      })
      return {
        reply: sanitizeUserFacingReply(reply),
        meta: exposeSql() ? { sql: v.normalizedSql } : undefined,
      }
    } catch {
      return {
        reply: `Consegui buscar os dados, mas não consegui montar a resposta em texto. Tente perguntar de outro jeito.`,
        meta: exposeSql() ? { sql: v.normalizedSql } : undefined,
      }
    }
  }

  if (lastFailureWasExecution) {
    return {
      reply:
        'Não consegui buscar esses dados após ajustar a consulta. Tente reformular (ex.: “clientes sem agendamento há 6 meses”) ou perguntar de outro jeito.',
      meta: exposeSql() && sqlOut ? { sql: sqlOut } : undefined,
    }
  }

  return {
    reply: humanizeValidationFailure(petshopName, lastValidationCode),
    meta: exposeSql() && sqlOut ? { sql: sqlOut } : undefined,
  }
}
