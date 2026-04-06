/**
 * Converte erro do Prisma/Postgres em instrução curta para o LLM corrigir a SQL
 * (sem repassar stack nem query ao usuário).
 */
export function postgresErrorHintForLlm(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)

  const col = raw.match(/column\s+"([^"]+)"\s+does not exist/i)
  if (col) {
    const name = col[1]
    return (
      `A coluna "${name}" não existe na tabela que você usou. ` +
      `Use somente nomes que aparecem na linha "Colunas:" do TABLE correspondente no catálogo. ` +
      `Exemplos: em clients não existe last_visit — use last_message_at (WhatsApp) ou agregue última data em petshop_appointments.scheduled_date, ou use dashboard_client_recurrence para last_visit agregado.`
    )
  }

  if (/relation\s+"([^"]+)"\s+does not exist/i.test(raw)) {
    return 'Tabela ou view não encontrada com esse nome. Use exatamente os nomes da allowlist e do catálogo (TABLE / VIEW).'
  }

  if (/Code:\s*42703/i.test(raw) || /does not exist/i.test(raw)) {
    return 'Objeto ou coluna inexistente no PostgreSQL. Releia o catálogo TABLE/Colunas e views; não invente nomes.'
  }

  return 'A consulta falhou no PostgreSQL. Reescreva usando estritamente tabelas e colunas do catálogo do system prompt.'
}
