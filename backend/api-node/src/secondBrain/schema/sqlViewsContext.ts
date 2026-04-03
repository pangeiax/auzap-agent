import { ALLOWED_RELATIONS } from './allowedRelations'

/**
 * Views/materializações usadas no app mas não declaradas como `model` no Prisma.
 * Colunas inferidas do uso em queries — não invente outras.
 */
const VIEW_DOCS: Record<string, string> = {
  dashboard_appointment_metrics:
    'company_id, scheduled_date, status, confirmed, service_id, service_name, client_id, revenue, month, day_of_week (e outras colunas da view; sempre filtrar company_id). Não existe appointment_date.',
  dashboard_client_recurrence:
    'company_id, client_id, client_name, pet_name, last_visit, days_absent, recurrence_status, phone (se existir na view; filtrar company_id).',
  dashboard_revenue_realtime:
    'company_id, revenue_today, revenue_yesterday, revenue_this_week',
  dashboard_whatsapp_conversion:
    'company_id, month, conversion_rate',
  dashboard_sentiment_kpi:
    'company_id, month, total_analyzed, positive, neutral, negative, high_churn_risk, medium_churn_risk, positive_pct',
  dashboard_ai_time_worked:
    'company_id, duration_minutes, first_message_at',
  dashboard_after_hours:
    'company_id, is_after_hours, is_weekend, created_at',
  vw_lodging_availability:
    'company_id, check_date, type, max_capacity, occupied_capacity, available_capacity',
  vw_room_type_availability:
    'company_id, check_date, lodging_type, room_type_id, room_type_name, daily_rate, total_capacity, available_capacity',
  client_sentiment_analysis:
    'company_id, client_id, risco_churn, analyzed_month, tom_cliente, motivo_principal',
}

/** Bloco de texto só para views na allowlist que não vêm do Prisma. */
export function buildSqlViewsSupplement(): string {
  const names = [...ALLOWED_RELATIONS].filter((n) => VIEW_DOCS[n]).sort()
  if (!names.length) return ''

  const lines = [
    '=== Views SQL (não são models Prisma; colunas conhecidas pelo uso no sistema) ===',
    '',
  ]
  for (const n of names) {
    lines.push(`VIEW ${n}`)
    lines.push(`  Colunas (referência): ${VIEW_DOCS[n]}`)
    lines.push('')
  }
  lines.push(
    'Se precisar de uma coluna não listada, prefira JOIN com tabelas base do bloco Prisma acima em vez de adivinhar na view.',
  )
  return lines.join('\n')
}
