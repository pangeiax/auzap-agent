import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'

// Brasília timezone offset: UTC-3
const BRASILIA_OFFSET_MS = -3 * 60 * 60 * 1000

function getBrasiliaStartOfDay(date: Date): Date {
  const brasiliaTime = new Date(date.getTime() + BRASILIA_OFFSET_MS)
  brasiliaTime.setUTCHours(0, 0, 0, 0)
  return new Date(brasiliaTime.getTime() - BRASILIA_OFFSET_MS)
}

function getBrasiliaDate(date: Date): string {
  const brasiliaTime = new Date(date.getTime() + BRASILIA_OFFSET_MS)
  return brasiliaTime.toISOString().split('T')[0]
}

function getPeriodStart(period: string): Date {
  const now = new Date()
  const days =
    period === 'week' ? 7
    : period === 'month' ? 30
    : period === 'quarter' ? 90
    : period === 'year' ? 365
    : 30
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  start.setHours(0, 0, 0, 0)
  return start
}

// GET /dashboard/stats
export async function getStats(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const now = new Date()

    const todayStart = getBrasiliaStartOfDay(now)
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)

    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    weekStart.setHours(0, 0, 0, 0)

    const [appointmentsToday, appointmentsWeek, totalClients, totalAppointments, completedAppointments] =
      await Promise.all([
        prisma.petshopAppointment.count({
          where: {
            companyId,
            scheduledDate: { gte: todayStart, lt: todayEnd },
          },
        }),
        prisma.petshopAppointment.count({
          where: {
            companyId,
            scheduledDate: { gte: weekStart },
          },
        }),
        prisma.client.count({
          where: { companyId },
        }),
        prisma.petshopAppointment.count({
          where: { companyId },
        }),
        prisma.petshopAppointment.count({
          where: { companyId, status: 'completed' },
        }),
      ])

    const conversionRate =
      totalAppointments > 0
        ? Math.round((completedAppointments / totalAppointments) * 100 * 100) / 100
        : 0

    res.json({
      appointments_today: appointmentsToday,
      appointments_week: appointmentsWeek,
      total_clients: totalClients,
      total_appointments: totalAppointments,
      conversion_rate: conversionRate,
    })
  } catch (error) {
    console.error('Error getting dashboard stats:', error)
    res.status(500).json({ error: 'Failed to get dashboard stats' })
  }
}

// GET /dashboard/revenue-chart
export async function getRevenueChart(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { period = 'month', group_by = 'day' } = req.query as Record<string, string>

    const periodStart = getPeriodStart(period)

    const appointments = await prisma.petshopAppointment.findMany({
      where: {
        companyId,
        status: 'completed',
        scheduledDate: { gte: periodStart },
      },
      select: {
        scheduledDate: true,
        priceCharged: true,
      },
    })

    const grouped: Record<string, { revenue: number; appointments: number }> = {}

    for (const appt of appointments) {
      let key: string

      if (group_by === 'day') {
        key = getBrasiliaDate(appt.scheduledDate)
      } else if (group_by === 'week') {
        const d = new Date(appt.scheduledDate.getTime() + BRASILIA_OFFSET_MS)
        const day = d.getUTCDay()
        const weekStart = new Date(d.getTime() - day * 24 * 60 * 60 * 1000)
        key = weekStart.toISOString().split('T')[0]
      } else {
        // month
        const d = new Date(appt.scheduledDate.getTime() + BRASILIA_OFFSET_MS)
        key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
      }

      if (!grouped[key]) {
        grouped[key] = { revenue: 0, appointments: 0 }
      }
      grouped[key].revenue += appt.priceCharged ? Number(appt.priceCharged) : 0
      grouped[key].appointments += 1
    }

    const result = Object.entries(grouped)
      .map(([date, data]) => ({
        date,
        revenue: Math.round(data.revenue * 100) / 100,
        appointments: data.appointments,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    res.json(result)
  } catch (error) {
    console.error('Error getting revenue chart:', error)
    res.status(500).json({ error: 'Failed to get revenue chart' })
  }
}

// GET /dashboard/categories-chart
export async function getCategoriesChart(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId

    const appointments = await prisma.petshopAppointment.findMany({
      where: { companyId },
      select: {
        serviceId: true,
        service: {
          select: { name: true },
        },
      },
    })

    const grouped: Record<string, { name: string; count: number }> = {}

    for (const appt of appointments) {
      const serviceId = String(appt.serviceId)
      const name = appt.service?.name ?? 'Desconhecido'

      if (!grouped[serviceId]) {
        grouped[serviceId] = { name, count: 0 }
      }
      grouped[serviceId].count += 1
    }

    const total = appointments.length

    const result = Object.values(grouped)
      .map((entry) => ({
        category: entry.name,
        value: entry.count,
        percentage:
          total > 0 ? Math.round((entry.count / total) * 100 * 100) / 100 : 0,
      }))
      .sort((a, b) => b.value - a.value)

    res.json(result)
  } catch (error) {
    console.error('Error getting categories chart:', error)
    res.status(500).json({ error: 'Failed to get categories chart' })
  }
}

// GET /dashboard/visits-chart
export async function getVisitsChart(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { period = 'week', group_by = 'day' } = req.query as Record<string, string>

    const periodStart = getPeriodStart(period)

    const [messages, clients] = await Promise.all([
      prisma.agentMessage.findMany({
        where: {
          companyId,
          role: 'user',
          createdAt: { gte: periodStart },
          NOT: { createdAt: null },
        },
        select: {
          createdAt: true,
          conversationId: true,
        },
      }),
      prisma.client.findMany({
        where: { companyId },
        select: {
          id: true,
          createdAt: true,
        },
      }),
    ])

    const clientCreatedByDate: Record<string, Set<string>> = {}
    for (const client of clients) {
      if (!client.createdAt) continue
      const dateKey = getBrasiliaDate(client.createdAt)
      if (!clientCreatedByDate[dateKey]) {
        clientCreatedByDate[dateKey] = new Set()
      }
      clientCreatedByDate[dateKey].add(client.id)
    }

    const clientCreatedAtMap: Record<string, string> = {}
    for (const client of clients) {
      if (!client.createdAt) continue
      clientCreatedAtMap[client.id] = getBrasiliaDate(client.createdAt)
    }

    // Get conversationId -> clientId mapping for returning client detection
    const conversationIds = [...new Set(messages.map((m) => m.conversationId))]

    let conversationClientMap: Record<string, string> = {}
    if (conversationIds.length > 0) {
      const conversations = await prisma.agentConversation.findMany({
        where: { id: { in: conversationIds } },
        select: { id: true, clientId: true },
      })
      for (const conv of conversations) {
        if (conv.clientId != null) {
          conversationClientMap[conv.id] = conv.clientId
        }
      }
    }

    type DayData = { visits: number; new_clients: number; returning_clients: number }
    const grouped: Record<string, DayData> = {}

    for (const msg of messages) {
      if (!msg.createdAt) continue
      let key: string

      if (group_by === 'hour') {
        const d = new Date(msg.createdAt.getTime() + BRASILIA_OFFSET_MS)
        const dateStr = d.toISOString().split('T')[0]
        const hour = String(d.getUTCHours()).padStart(2, '0')
        key = `${dateStr}T${hour}:00`
      } else {
        key = getBrasiliaDate(msg.createdAt)
      }

      if (!grouped[key]) {
        grouped[key] = { visits: 0, new_clients: 0, returning_clients: 0 }
      }

      grouped[key].visits += 1

      const clientId: string | undefined = conversationClientMap[msg.conversationId]
      if (clientId != null) {
        const clientDate = clientCreatedAtMap[clientId]
        const msgDate = group_by === 'hour' ? key.split('T')[0] : key
        if (clientDate === msgDate) {
          grouped[key].new_clients += 1
        } else {
          grouped[key].returning_clients += 1
        }
      }
    }

    const result = Object.entries(grouped)
      .map(([date, data]) => ({
        date,
        visits: data.visits,
        new_clients: data.new_clients,
        returning_clients: data.returning_clients,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    res.json(result)
  } catch (error) {
    console.error('Error getting visits chart:', error)
    res.status(500).json({ error: 'Failed to get visits chart' })
  }
}

// GET /dashboard/sales-chart
export async function getSalesChart(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId

    const appointments = await prisma.petshopAppointment.findMany({
      where: {
        companyId,
        status: { not: 'cancelled' },
      },
      select: {
        serviceId: true,
        priceCharged: true,
        service: {
          select: { name: true },
        },
      },
    })

    const grouped: Record<string, { name: string; sales: number; revenue: number }> = {}

    for (const appt of appointments) {
      const serviceId = String(appt.serviceId)
      const name = appt.service?.name ?? 'Desconhecido'

      if (!grouped[serviceId]) {
        grouped[serviceId] = { name, sales: 0, revenue: 0 }
      }
      grouped[serviceId].sales += 1
      grouped[serviceId].revenue += appt.priceCharged ? Number(appt.priceCharged) : 0
    }

    const result = Object.values(grouped)
      .map((entry) => ({
        service: entry.name,
        sales: entry.sales,
        revenue: Math.round(entry.revenue * 100) / 100,
      }))
      .sort((a, b) => b.sales - a.sales)

    res.json(result)
  } catch (error) {
    console.error('Error getting sales chart:', error)
    res.status(500).json({ error: 'Failed to get sales chart' })
  }
}
