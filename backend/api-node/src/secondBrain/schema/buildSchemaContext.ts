import { ALLOWED_RELATIONS } from './allowedRelations'
import { buildPrismaModelsSchemaBlock } from './prismaDatamodelContext'
import { buildSqlViewsSupplement } from './sqlViewsContext'

export function getMaxSqlLimit(): number {
  const n = parseInt(process.env.SECOND_BRAIN_MAX_LIMIT?.trim() ?? '100', 10)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 100
}

const UX_RULES = `
Regra de ouro: todo identificador de coluna na SQL deve existir na linha "Colunas:" do TABLE que você está consultando (nome exato). Não presuma nomes de outros CRMs/sistemas.

SQL voltado ao dono:
- Listagens: JOIN em clients / petshop_services / petshop_pets e devolva nomes, não só *_id.
- Contagens por serviço: GROUP BY nome do serviço (via JOIN).
- Agendamentos: scheduled_date em petshop_appointments.
`.trim()

/**
 * Contexto completo para o LLM: tabelas permitidas + schema Prisma (DMMF) + views SQL conhecidas + regras.
 */
export async function buildSchemaContext(): Promise<string> {
  const relations = [...ALLOWED_RELATIONS].sort().join(', ')
  const maxLimit = getMaxSqlLimit()
  const prismaBlock = await buildPrismaModelsSchemaBlock()
  const viewsBlock = buildSqlViewsSupplement()

  return `
PostgreSQL — relações permitidas (allowlist; não use outras):
${relations}

${prismaBlock}

${viewsBlock}

${UX_RULES}

Regras obrigatórias para o SQL gerado:
- Um único comando SELECT (sem ponto e vírgula no meio; sem múltiplas statements).
- NUNCA use SELECT *; selecione colunas explicitamente (lista acima).
- Filtrar sempre com company_id = <COMPANY_ID> usando o número inteiro exato fornecido (tenant).
- Incluir LIMIT no final com valor entre 1 e ${maxLimit}.
- Proibido: INSERT, UPDATE, DELETE, DDL, funções perigosas.
- Usar nomes de tabela/view exatamente como na allowlist (schema public).
`.trim()
}
