import { prisma } from '../../lib/prisma'
import type { BrainAlert } from './brain.types'

function todayBR(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10)
}

function futureDateBR(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10)
}

export async function buildAlerts(companyId: number): Promise<BrainAlert[]> {
  const alerts: BrainAlert[] = []
  const today = todayBR()
  const in14days = futureDateBR(14)

  const since7d = new Date()
  since7d.setDate(since7d.getDate() - 7)
  const since7dIso = since7d.toISOString()

  const [
    pendingConf,
    petBirthdays,
    churnRisk,
    hotelAlmostFull,
    lostClients,
    unchargedAppointments,
    cancellationSpree,
    absentHighValue,
  ] = await Promise.allSettled([

    // 1. Confirmações pendentes hoje
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM petshop_appointments
      WHERE company_id = ${companyId}
        AND scheduled_date::text = ${today}
        AND confirmed = false
        AND status <> 'cancelled'
    `,

    // 2. Aniversários de pets nos próximos 7 dias
    prisma.$queryRaw<Array<{ pet_name: string; client_name: string }>>`
      SELECT * FROM get_pet_birthdays_next_days(${companyId}::int, 7)
    `,

    // 3. Clientes com risco alto de churn (mês atual)
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM client_sentiment_analysis
      WHERE company_id = ${companyId}
        AND risco_churn = 'alto'
        AND analyzed_month >= date_trunc('month', now())::date
    `,

    // 4. Hotel/creche com 1 ou menos vagas nos próximos 14 dias
    prisma.$queryRaw<Array<{ check_date: string; type: string; available_capacity: number }>>`
      SELECT check_date, type, available_capacity
      FROM vw_lodging_availability
      WHERE company_id = ${companyId}
        AND available_capacity <= 1
        AND check_date >= ${today}::date
        AND check_date <= ${in14days}::date
    `,

    // 5. Clientes sumidos há mais de 60 dias
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM dashboard_client_recurrence
      WHERE company_id = ${companyId}
        AND recurrence_status = 'lost'
    `,

    // 6. Agendamentos concluídos sem valor registrado
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM petshop_appointments
      WHERE company_id = ${companyId}
        AND status = 'completed'
        AND price_charged IS NULL
    `,

    // 7. Cancelamentos em série (últimos 7 dias)
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM petshop_appointments
      WHERE company_id = ${companyId}
        AND status = 'cancelled'
        AND cancelled_at IS NOT NULL
        AND cancelled_at >= ${since7dIso}::timestamptz
    `,

    // 8. Clientes ausentes há 30+ dias (reativação)
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM dashboard_client_recurrence
      WHERE company_id = ${companyId}
        AND days_absent >= 30
    `,
  ])

  // Alerta 1 — confirmações pendentes
  if (pendingConf.status === 'fulfilled') {
    const count = Number(pendingConf.value[0]?.count ?? 0)
    if (count > 0) {
      alerts.push({
        type: 'warning',
        message: `${count} cliente${count > 1 ? 's' : ''} não confirmou o agendamento de hoje.`,
        action: 'Quem não confirmou presença hoje?',
      })
    }
  }

  // Alerta 2 — aniversários de pets
  if (petBirthdays.status === 'fulfilled' && petBirthdays.value.length > 0) {
    const pets = petBirthdays.value
    alerts.push({
      type: 'info',
      message: `${pets.length} pet${pets.length > 1 ? 's fazem' : ' faz'} aniversário nos próximos 7 dias: ${pets.map((p: any) => `${p.pet_name} (${p.client_name})`).join(', ')}.`,
      action: 'Quais pets fazem aniversário essa semana?',
    })
  }

  // Alerta 3 — churn
  if (churnRisk.status === 'fulfilled') {
    const count = Number(churnRisk.value[0]?.count ?? 0)
    if (count > 0) {
      alerts.push({
        type: 'critical',
        message: `${count} cliente${count > 1 ? 's' : ''} com risco alto de churn neste mês.`,
        action: 'Quais clientes têm risco alto de churn?',
      })
    }
  }

  // Alerta 4 — hotel quase cheio
  if (hotelAlmostFull.status === 'fulfilled' && hotelAlmostFull.value.length > 0) {
    const days = hotelAlmostFull.value
    const byType: Record<string, string[]> = {}
    for (const d of days) {
      const key = d.type === 'hotel' ? 'Hotel' : 'Creche'
      if (!byType[key]) byType[key] = []
      byType[key].push(new Date(String(d.check_date) + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }))
    }
    const msg = Object.entries(byType).map(([type, dates]) => `${type}: ${dates.slice(0, 3).join(', ')}`).join(' | ')
    alerts.push({
      type: 'warning',
      message: `Vagas limitadas nos próximos 14 dias — ${msg}.`,
      action: 'Como está a disponibilidade do hotel e da creche nos próximos dias?',
    })
  }

  // Alerta 5 — clientes sumidos
  if (lostClients.status === 'fulfilled') {
    const count = Number(lostClients.value[0]?.count ?? 0)
    if (count > 0) {
      alerts.push({
        type: 'info',
        message: `${count} cliente${count > 1 ? 's' : ''} não volta${count > 1 ? 'm' : ''} há mais de 60 dias.`,
        action: 'Quem são os clientes sumidos?',
      })
    }
  }

  // Alerta 6 — atendimentos sem valor
  if (unchargedAppointments.status === 'fulfilled') {
    const count = Number(unchargedAppointments.value[0]?.count ?? 0)
    if (count > 0) {
      alerts.push({
        type: 'warning',
        message: `${count} atendimento${count > 1 ? 's' : ''} finalizado${count > 1 ? 's' : ''} sem valor registrado — isso afeta o faturamento do dashboard.`,
        action: 'Quais atendimentos estão sem valor registrado?',
      })
    }
  }

  // Alerta 7 — cancelamentos em série (7 dias)
  if (cancellationSpree.status === 'fulfilled') {
    const count = Number(cancellationSpree.value[0]?.count ?? 0)
    if (count >= 3) {
      alerts.push({
        type: 'warning',
        message: `${count} cancelamentos nos últimos 7 dias — acima do normal.`,
        action: 'Analisar os cancelamentos recentes',
      })
    }
  }

  // Alerta 8 — clientes ausentes 30+ dias
  if (absentHighValue.status === 'fulfilled') {
    const count = Number(absentHighValue.value[0]?.count ?? 0)
    if (count > 0) {
      alerts.push({
        type: 'critical',
        message: `${count} cliente(s) com mais de 30 dias sem comparecer — priorize reativação.`,
        action: 'Ver clientes de alto valor sumidos',
      })
    }
  }

  return alerts
}

export const BRAIN_SUGGESTION_FALLBACKS = [
  'Quem está na minha agenda hoje e o que já está confirmado?',
  'Quais agendamentos pendentes nos próximos 7 dias?',
  'Como foi meu faturamento mês a mês nos últimos 6 meses?',
  'Quais serviços mais puxam o faturamento e qual o ticket médio?',
  'Tem vaga de hotel e creche nos próximos 14 dias?',
  'Quais tutores sumiram há mais de 45 dias para eu planejar reativação?',
  'Quais pets fazem aniversário nos próximos 7 dias?',
  'Quem aparece com risco alto de churn neste mês segundo o sentimento?',
  'Tenho atendimentos concluídos sem valor registrado no caixa?',
  'Qual minha conversão pelo WhatsApp e quantos clientes ativos eu tenho?',
] as const

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}

/**
 * Duas perguntas para a home: prioriza ações dos alertas proativos, completa com fallbacks.
 */
export async function buildBrainSuggestionPrompts(companyId: number): Promise<string[]> {
  const alerts = await buildAlerts(companyId)
  const fromAlerts = alerts
    .map((a) => a.action?.trim())
    .filter((s): s is string => Boolean(s))
  const unique = [...new Set(fromAlerts)]

  const picked: string[] = []
  for (const s of unique) {
    if (picked.length >= 2) break
    picked.push(s)
  }

  if (picked.length < 2) {
    const rest = shuffle(
      BRAIN_SUGGESTION_FALLBACKS.filter((s) => !picked.includes(s)),
    )
    for (const s of rest) {
      if (picked.length >= 2) break
      picked.push(s)
    }
  }
  if (picked.length < 2) {
    for (const s of BRAIN_SUGGESTION_FALLBACKS) {
      if (picked.length >= 2) break
      if (!picked.includes(s)) picked.push(s)
    }
  }

  return picked.slice(0, 2)
}
