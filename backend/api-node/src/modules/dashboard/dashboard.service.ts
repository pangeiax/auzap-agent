import { prisma } from '../../lib/prisma'
import type {
  AiTimeWorked,
  AfterHoursStats,
  AppointmentsToday,
  RevenueByMonth,
  AppointmentsByWeekday,
  TopService,
  TopServiceThisMonth,
  WhatsappConversion,
  ClientRecurrenceSummary,
  LostClient,
} from './dashboard.types'

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function startOfCurrentMonth(): Date {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

export class DashboardService {
  async getAiTimeWorked(companyId: number): Promise<AiTimeWorked> {
    const startOfMonth = startOfCurrentMonth()

    const rows = await prisma.$queryRaw<Array<{ duration_minutes: number | null }>>`
      SELECT duration_minutes
      FROM dashboard_ai_time_worked
      WHERE company_id = ${companyId}
        AND first_message_at >= ${startOfMonth}
    `

    const totalMinutes = rows.reduce((sum, r) => sum + Number(r.duration_minutes ?? 0), 0)
    return {
      hours: parseFloat((totalMinutes / 60).toFixed(1)),
      total_conversations: rows.length,
    }
  }

  async getAfterHoursStats(companyId: number): Promise<AfterHoursStats> {
    const startOfMonth = startOfCurrentMonth()

    const rows = await prisma.$queryRaw<Array<{ is_after_hours: boolean; is_weekend: boolean }>>`
      SELECT is_after_hours, is_weekend
      FROM dashboard_after_hours
      WHERE company_id = ${companyId}
        AND created_at >= ${startOfMonth}
    `

    const total = rows.length
    const afterHours = rows.filter(r => r.is_after_hours).length
    const weekend = rows.filter(r => r.is_weekend).length

    return {
      total,
      pct_after_hours: total ? parseFloat(((afterHours / total) * 100).toFixed(1)) : 0,
      pct_weekend: total ? parseFloat(((weekend / total) * 100).toFixed(1)) : 0,
    }
  }

  async getAppointmentsToday(companyId: number): Promise<AppointmentsToday> {
    const today = new Date().toISOString().slice(0, 10)

    const rows = await prisma.$queryRaw<Array<{ confirmed: boolean; status: string }>>`
      SELECT confirmed, status
      FROM dashboard_appointment_metrics
      WHERE company_id = ${companyId}
        AND scheduled_date::text = ${today}
        AND status <> 'cancelled'
    `

    const total = rows.length
    const confirmed = rows.filter(r => r.confirmed).length

    return { total, confirmed, pending: total - confirmed }
  }

  async getRevenueByMonth(companyId: number): Promise<RevenueByMonth[]> {
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
    sixMonthsAgo.setDate(1)
    sixMonthsAgo.setHours(0, 0, 0, 0)
    const dateStr = sixMonthsAgo.toISOString().slice(0, 10)

    const rows = await prisma.$queryRaw<Array<{ month: string | Date; revenue: number | null }>>`
      SELECT month, revenue
      FROM dashboard_appointment_metrics
      WHERE company_id = ${companyId}
        AND status = 'completed'
        AND scheduled_date >= ${dateStr}::date
    `

    const grouped: Record<string, number[]> = {}
    for (const row of rows) {
      const rawMonth = String(row.month)
      const key = rawMonth.slice(0, 7)
      if (!grouped[key]) grouped[key] = []
      if (row.revenue != null) grouped[key]!.push(Number(row.revenue))
    }

    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, values]) => ({
        month,
        total_revenue: parseFloat(values.reduce((s, v) => s + v, 0).toFixed(2)),
        avg_ticket: values.length ? parseFloat((values.reduce((s, v) => s + v, 0) / values.length).toFixed(2)) : 0,
      }))
  }

  async getAppointmentsByWeekday(companyId: number, serviceId?: number): Promise<AppointmentsByWeekday[]> {
    const startOfMonth = startOfCurrentMonth()
    const dateStr = startOfMonth.toISOString().slice(0, 10)

    type Row = { day_of_week: number; service_name: string; status: string }
    let rows: Row[]

    if (serviceId) {
      rows = await prisma.$queryRaw<Row[]>`
        SELECT day_of_week, service_name, status
        FROM dashboard_appointment_metrics
        WHERE company_id = ${companyId}
          AND status <> 'cancelled'
          AND scheduled_date >= ${dateStr}::date
          AND service_id = ${serviceId}
      `
    } else {
      rows = await prisma.$queryRaw<Row[]>`
        SELECT day_of_week, service_name, status
        FROM dashboard_appointment_metrics
        WHERE company_id = ${companyId}
          AND status <> 'cancelled'
          AND scheduled_date >= ${dateStr}::date
      `
    }

    const grouped: Record<string, { day_of_week: number; day_name: string; service_name: string; total: number }> = {}
    for (const row of rows) {
      const key = `${row.day_of_week}_${row.service_name}`
      if (!grouped[key]) {
        grouped[key] = {
          day_of_week: row.day_of_week,
          day_name: DAY_NAMES[row.day_of_week] ?? String(row.day_of_week),
          service_name: row.service_name,
          total: 0,
        }
      }
      grouped[key]!.total++
    }

    return Object.values(grouped).sort((a, b) => a.day_of_week - b.day_of_week)
  }

  async getTopServices(companyId: number): Promise<TopService[]> {
    const rows = await prisma.$queryRaw<Array<{ service_name: string; revenue: number | null }>>`
      SELECT service_name, revenue
      FROM dashboard_appointment_metrics
      WHERE company_id = ${companyId}
        AND status = 'completed'
    `

    const grouped: Record<string, { total: number; revenue: number }> = {}
    let grandTotal = 0

    for (const row of rows) {
      if (!grouped[row.service_name]) grouped[row.service_name] = { total: 0, revenue: 0 }
      grouped[row.service_name]!.total++
      const rev = Number(row.revenue ?? 0)
      grouped[row.service_name]!.revenue += rev
      grandTotal += rev
    }

    return Object.entries(grouped)
      .map(([service_name, v]) => ({
        service_name,
        total_appointments: v.total,
        total_revenue: parseFloat(v.revenue.toFixed(2)),
        avg_ticket: v.total ? parseFloat((v.revenue / v.total).toFixed(2)) : 0,
        revenue_pct: grandTotal ? parseFloat(((v.revenue / grandTotal) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.total_revenue - a.total_revenue)
  }

  async getTopServiceThisMonth(companyId: number): Promise<TopServiceThisMonth | null> {
    const now = new Date()
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10)

    const rows = await prisma.$queryRaw<Array<{ service_name: string; scheduled_date: string | Date }>>`
      SELECT service_name, scheduled_date
      FROM dashboard_appointment_metrics
      WHERE company_id = ${companyId}
        AND status <> 'cancelled'
        AND scheduled_date >= ${lastMonthStart}::date
    `

    const thisMonth: Record<string, number> = {}
    const lastMonth: Record<string, number> = {}

    for (const row of rows) {
      const dateStr = String(row.scheduled_date).slice(0, 10)
      const isThis = dateStr >= thisMonthStart
      const target = isThis ? thisMonth : lastMonth
      target[row.service_name] = (target[row.service_name] ?? 0) + 1
    }

    let best: TopServiceThisMonth | null = null
    for (const [name, thisCount] of Object.entries(thisMonth)) {
      const lastCount = lastMonth[name] ?? 0
      if (lastCount === 0) continue
      const growth = ((thisCount - lastCount) / lastCount) * 100
      if (!best || growth > best.growth_pct) {
        best = { service_name: name, growth_pct: parseFloat(growth.toFixed(1)) }
      }
    }

    return best
  }

  async getWhatsappConversion(companyId: number): Promise<WhatsappConversion> {
    const rows = await prisma.$queryRaw<Array<{
      total_conversations: number
      total_appointments: number
      conversion_rate: number
      revenue_generated: number
    }>>`
      SELECT total_conversations, total_appointments, conversion_rate, revenue_generated
      FROM dashboard_whatsapp_conversion
      WHERE company_id = ${companyId}
      ORDER BY month DESC
      LIMIT 1
    `

    const data = rows[0]
    return {
      total_conversations: Number(data?.total_conversations ?? 0),
      total_appointments: Number(data?.total_appointments ?? 0),
      conversion_rate: Number(data?.conversion_rate ?? 0),
      revenue_generated: Number(data?.revenue_generated ?? 0),
    }
  }

  async getClientRecurrence(companyId: number): Promise<ClientRecurrenceSummary> {
    const rows = await prisma.$queryRaw<Array<{ recurrence_status: string; days_absent: number | null }>>`
      SELECT recurrence_status, days_absent
      FROM dashboard_client_recurrence
      WHERE company_id = ${companyId}
    `

    const counts = { active: 0, at_risk: 0, lost: 0, never: 0 }
    const returnDays: number[] = []

    for (const row of rows) {
      const status = row.recurrence_status as keyof typeof counts
      if (status in counts) counts[status]++
      if (row.days_absent != null && row.recurrence_status !== 'never') {
        returnDays.push(Number(row.days_absent))
      }
    }

    const avg = returnDays.length
      ? Math.round(returnDays.reduce((s, v) => s + v, 0) / returnDays.length)
      : 0

    return { ...counts, avg_return_days: avg }
  }

  async getLostClients(companyId: number, minDays = 45): Promise<LostClient[]> {
    const rows = await prisma.$queryRaw<LostClient[]>`
      SELECT client_id, client_name, pet_name, pet_species, last_visit, days_absent, phone
      FROM dashboard_client_recurrence
      WHERE company_id = ${companyId}
        AND days_absent > ${minDays}
      ORDER BY days_absent DESC
    `

    // Dedup por client_id, mantém maior days_absent
    const seen = new Map<string, LostClient>()
    for (const row of rows) {
      const existing = seen.get(row.client_id)
      if (!existing || row.days_absent > existing.days_absent) {
        seen.set(row.client_id, row)
      }
    }

    return Array.from(seen.values())
  }
}
