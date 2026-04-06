import { readFileSync } from 'fs'
import { join } from 'path'
import { getDMMF } from '@prisma/internals'
import { ALLOWED_RELATIONS } from './allowedRelations'

/** Campos de relação Prisma (object) — não são colunas; FKs vêm dos escalares listados em relationFromFields. */
type DmmfField = {
  name: string
  kind: string
  type: string
  dbName?: string | null
  relationFromFields?: string[]
}

type DmmfModel = {
  name: string
  dbName?: string | null
  fields: DmmfField[]
}

let cachedBlock: string | null = null

function schemaPath(): string {
  return join(__dirname, '../../../prisma/schema.prisma')
}

function sqlColumnName(field: DmmfField): string {
  if (field.kind !== 'scalar' && field.kind !== 'enum') return ''
  return field.dbName ?? field.name
}

function targetTableName(models: DmmfModel[], prismaModelName: string): string {
  const m = models.find((x) => x.name === prismaModelName)
  return m?.dbName ?? prismaModelName
}

/** Dicas quando o modelo confunde conceitos (colunas que não existem). Derivado do domínio + DMMF. */
function semanticHintForTable(table: string): string | null {
  if (table === 'clients') {
    return 'Conceitos: NÃO existe last_visit. Última mensagem WhatsApp: last_message_at. Para última visita ao petshop / ausência há meses → agregue petshop_appointments (ex.: MAX(scheduled_date) por client_id) ou use a view dashboard_client_recurrence (tem last_visit, days_absent, etc.). Telefone para exibir ao dono: manual_phone (se vazio na consulta, trate como «Numero nao identificado» na resposta); phone é identificador técnico do canal (não usar como “número de contato” na resposta).'
  }
  if (table === 'petshop_appointments') {
    return 'Data do agendamento: scheduled_date (tipo date). NÃO existe appointment_date.'
  }
  if (table === 'petshop_services') {
    return 'Preço tabelado: price; preços por porte: price_by_size (jsonb).'
  }
  return null
}

function relationHints(model: DmmfModel, models: DmmfModel[]): string[] {
  const hints: string[] = []
  for (const field of model.fields) {
    if (field.kind !== 'object' || !field.relationFromFields?.length) continue
    const fromName = field.relationFromFields[0]
    const fromField = model.fields.find((f) => f.name === fromName)
    if (!fromField || (fromField.kind !== 'scalar' && fromField.kind !== 'enum')) continue
    const fromCol = sqlColumnName(fromField)
    if (!fromCol) continue
    const targetTable = targetTableName(models, field.type)
    hints.push(`${fromCol} → ${targetTable}`)
  }
  return hints
}

/**
 * Texto derivado do schema.prisma via DMMF: tabelas @@map permitidas em ALLOWED_RELATIONS,
 * com colunas reais do PostgreSQL e dicas de FK.
 */
export async function buildPrismaModelsSchemaBlock(): Promise<string> {
  if (cachedBlock) return cachedBlock

  let datamodel: string
  try {
    datamodel = readFileSync(schemaPath(), 'utf8')
  } catch (e) {
    console.error('[SecondBrain] não leu prisma/schema.prisma:', e)
    return '(Schema Prisma indisponível — verifique o deploy.)'
  }

  const dmmf = await getDMMF({ datamodel })
  const models = dmmf.datamodel.models as unknown as DmmfModel[]

  const lines: string[] = [
    '=== Modelos Prisma → tabelas PostgreSQL (use APENAS estes nomes de coluna; não invente) ===',
    '',
  ]

  const sorted = [...models].sort((a, b) => {
    const ta = a.dbName ?? a.name
    const tb = b.dbName ?? b.name
    return ta.localeCompare(tb)
  })

  for (const model of sorted) {
    const table = model.dbName ?? model.name
    if (!ALLOWED_RELATIONS.has(table)) continue

    const cols = model.fields
      .filter((f) => f.kind === 'scalar' || f.kind === 'enum')
      .map(sqlColumnName)
      .filter(Boolean)

    lines.push(`TABLE ${table}`)
    lines.push(`  Colunas: ${cols.join(', ')}`)
    const rh = relationHints(model, models)
    if (rh.length) lines.push(`  Relações (FK): ${rh.join('; ')}`)
    const sem = semanticHintForTable(table)
    if (sem) lines.push(`  Nota: ${sem}`)
    lines.push('')
  }

  cachedBlock = lines.join('\n').trimEnd()
  return cachedBlock
}
