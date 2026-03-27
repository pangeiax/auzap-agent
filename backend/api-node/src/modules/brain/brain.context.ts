import { prisma } from '../../lib/prisma'
import { BrainContext, BrainAlert } from './brain.types'

function todayBR(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10)
}

function futureDateBR(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10)
}

async function buildAlerts(companyId: number): Promise<BrainAlert[]> {
  const alerts: BrainAlert[] = []
  const today = todayBR()
  const in14days = futureDateBR(14)

  const [
    pendingConf,
    petBirthdays,
    churnRisk,
    hotelAlmostFull,
    lostClients,
    unchargedAppointments,
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

  return alerts
}

export async function buildContext(companyId: number): Promise<BrainContext> {
  const today = todayBR()

  const [company, profile, revenueRaw, appointmentsRaw, clientsRaw, conversionRaw, alertsResult] = await Promise.all([
    prisma.$queryRaw<Array<{ name: string; plan: string | null }>>`
      SELECT name, plan FROM saas_companies WHERE id = ${companyId} LIMIT 1
    `,
    prisma.$queryRaw<Array<{ assistant_name: string | null }>>`
      SELECT assistant_name FROM petshop_profile WHERE company_id = ${companyId} LIMIT 1
    `,
    prisma.$queryRaw<Array<{
      revenue_today: number | null
      revenue_yesterday: number | null
      revenue_this_week: number | null
    }>>`
      SELECT revenue_today, revenue_yesterday, revenue_this_week
      FROM dashboard_revenue_realtime
      WHERE company_id = ${companyId}
      LIMIT 1
    `,
    prisma.$queryRaw<Array<{ confirmed: boolean; status: string }>>`
      SELECT confirmed, status
      FROM dashboard_appointment_metrics
      WHERE company_id = ${companyId}
        AND scheduled_date::text = ${today}
        AND status <> 'cancelled'
    `,
    prisma.$queryRaw<Array<{ recurrence_status: string }>>`
      SELECT recurrence_status
      FROM dashboard_client_recurrence
      WHERE company_id = ${companyId}
    `,
    prisma.$queryRaw<Array<{ conversion_rate: number | null }>>`
      SELECT conversion_rate
      FROM dashboard_whatsapp_conversion
      WHERE company_id = ${companyId}
      ORDER BY month DESC
      LIMIT 1
    `,
    buildAlerts(companyId),
  ])

  const revenue = revenueRaw[0]
  const appointments = appointmentsRaw
  const allClients = clientsRaw

  const todayFormatted = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  })

  const revenueToday = Number(revenue?.revenue_today ?? 0)
  const revenueYesterday = Number(revenue?.revenue_yesterday ?? 0)

  return {
    petshop_name:                   company[0]?.name ?? 'Petshop',
    assistant_name:                 profile[0]?.assistant_name ?? 'Assistente',
    plan:                           company[0]?.plan ?? 'free',
    today:                          todayFormatted,
    appointments_today_total:       appointments.length,
    appointments_today_confirmed:   appointments.filter(a => a.confirmed).length,
    appointments_today_pending:     appointments.filter(a => !a.confirmed).length,
    revenue_today:                  revenueToday,
    revenue_this_week:              Number(revenue?.revenue_this_week ?? 0),
    revenue_today_vs_yesterday_pct: revenueYesterday > 0
      ? parseFloat((((revenueToday - revenueYesterday) / revenueYesterday) * 100).toFixed(1))
      : null,
    active_clients:                 allClients.filter(c => c.recurrence_status === 'active' || c.recurrence_status === 'at_risk').length,
    lost_clients_count:             allClients.filter(c => c.recurrence_status === 'lost').length,
    whatsapp_conversion_rate:       Number(conversionRaw[0]?.conversion_rate ?? 0),
    alerts:                         alertsResult,
  }
}

export function contextToSystemPrompt(ctx: BrainContext): string {
  const alertsBlock = ctx.alerts.length === 0
    ? '✅ Nenhum alerta no momento.'
    : ctx.alerts.map(a => {
        const icon = a.type === 'critical' ? '🔴' : a.type === 'warning' ? '⚠️' : 'ℹ️'
        return `${icon} ${a.message}`
      }).join('\n')

  return `Você é ${ctx.assistant_name}, o assistente inteligente do ${ctx.petshop_name}.
Você ajuda o dono do petshop a entender seu negócio respondendo perguntas em linguagem natural.
Seja direto, objetivo e use emojis com moderação. Responda sempre em português brasileiro.
Formate valores como moeda brasileira (R$ 1.234,00). Quando não souber algo, diga honestamente.
Quando houver alertas críticos ou importantes, mencione-os naturalmente na resposta quando for relevante — não force, mas não ignore.

📅 Hoje é ${ctx.today}

📊 RESUMO DO DIA:
- Agendamentos hoje: ${ctx.appointments_today_total} total (${ctx.appointments_today_confirmed} confirmados, ${ctx.appointments_today_pending} pendentes)
- Faturamento hoje: R$ ${ctx.revenue_today.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${ctx.revenue_today_vs_yesterday_pct !== null ? ` (${ctx.revenue_today_vs_yesterday_pct >= 0 ? '↑' : '↓'}${Math.abs(ctx.revenue_today_vs_yesterday_pct)}% vs ontem)` : ''}
- Faturamento esta semana: R$ ${ctx.revenue_this_week.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}

👥 CLIENTES:
- Clientes ativos (últimos 60 dias): ${ctx.active_clients}
- Clientes sumidos (mais de 60 dias): ${ctx.lost_clients_count}
- Conversão WhatsApp: ${ctx.whatsapp_conversion_rate}%

🔔 ALERTAS ATIVOS:
${alertsBlock}

Você tem acesso a ferramentas para buscar informações detalhadas quando o usuário pedir.`
}

/** Frases alinhadas às tools em brain.tools.ts (quando não há alertas suficientes). */
export const BRAIN_SUGGESTION_FALLBACKS = [
  'Como está minha agenda de hoje, com quem já confirmou?',
  'Quais agendamentos estão previstos para os próximos 7 dias?',
  'Quanto faturei mês a mês nos últimos 6 meses?',
  'Quais serviços mais faturam e qual o ticket médio de cada um?',
  'Há vagas no hotel ou na creche nos próximos 14 dias?',
  'Quais clientes estão há mais de 45 dias sem agendar?',
  'Quais pets fazem aniversário nos próximos 7 dias?',
  'Quais clientes aparecem com risco alto de churn neste mês?',
  'Quais atendimentos concluídos estão sem valor registrado?',
  'Liste os clientes que a dashboard marca como sumidos (mais de 60 dias).',
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
