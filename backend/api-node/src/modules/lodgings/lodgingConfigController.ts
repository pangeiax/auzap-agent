import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { loadBusinessHourRows } from '../../lib/businessHoursTable'

function formatTime(d: Date | null | undefined): string {
  if (!d) return '00:00'
  const hh = String(new Date(d).getUTCHours()).padStart(2, '0')
  const mm = String(new Date(d).getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function parseTimeString(t: string | undefined): Date | undefined {
  if (!t) return undefined
  const parts = String(t).split(':')
  if (parts.length < 2) return undefined
  const hh = parseInt(parts[0] ?? '0', 10)
  const mm = parseInt(parts[1] ?? '0', 10)
  if (isNaN(hh) || isNaN(mm)) return undefined
  return new Date(Date.UTC(1970, 0, 1, hh, mm, 0))
}

function shapeConfig(config: any, capacities: any[]) {
  return {
    hotel_enabled: config?.hotelEnabled ?? false,
    hotel_daily_rate: config?.hotelDailyRate != null ? Number(config.hotelDailyRate) : null,
    hotel_checkin_time: formatTime(config?.hotelCheckinTime) || '08:00',
    hotel_checkout_time: formatTime(config?.hotelCheckoutTime) || '18:00',
    daycare_enabled: config?.daycareEnabled ?? false,
    daycare_daily_rate: config?.daycareDailyRate != null ? Number(config.daycareDailyRate) : null,
    daycare_checkin_time: formatTime(config?.daycareCheckinTime) || '07:00',
    daycare_checkout_time: formatTime(config?.daycareCheckoutTime) || '19:00',
    capacities: capacities.map((c) => ({
      id: c.id,
      type: c.type,
      day_of_week: c.dayOfWeek,
      max_capacity: c.maxCapacity,
      is_active: c.isActive,
    })),
  }
}

// GET /lodging-config
export async function getLodgingConfig(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId

    const [config, capacities] = await Promise.all([
      prisma.petshopLodgingConfig.findUnique({ where: { companyId } }),
      prisma.petshopLodgingCapacity.findMany({
        where: { companyId },
        orderBy: [{ type: 'asc' }, { dayOfWeek: 'asc' }],
      }),
    ])

    if (!config) {
      return res.json({
        hotel_enabled: false,
        hotel_daily_rate: null,
        hotel_checkin_time: '08:00',
        hotel_checkout_time: '18:00',
        daycare_enabled: false,
        daycare_daily_rate: null,
        daycare_checkin_time: '07:00',
        daycare_checkout_time: '19:00',
        capacities: [],
      })
    }

    res.json(shapeConfig(config, capacities))
  } catch (error) {
    console.error('Error getting lodging config:', error)
    res.status(500).json({ error: 'Failed to get lodging config' })
  }
}

// PATCH /lodging-config
export async function upsertLodgingConfig(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const {
      hotel_enabled,
      hotel_daily_rate,
      hotel_checkin_time,
      hotel_checkout_time,
      daycare_enabled,
      daycare_daily_rate,
      daycare_checkin_time,
      daycare_checkout_time,
    } = req.body

    const data: any = {}
    if (hotel_enabled !== undefined) data.hotelEnabled = hotel_enabled
    if (hotel_daily_rate !== undefined) data.hotelDailyRate = hotel_daily_rate != null ? Number(hotel_daily_rate) : null
    if (hotel_checkin_time !== undefined) {
      const parsed = parseTimeString(hotel_checkin_time)
      if (parsed) data.hotelCheckinTime = parsed
    }
    if (hotel_checkout_time !== undefined) {
      const parsed = parseTimeString(hotel_checkout_time)
      if (parsed) data.hotelCheckoutTime = parsed
    }
    if (daycare_enabled !== undefined) data.daycareEnabled = daycare_enabled
    if (daycare_daily_rate !== undefined) data.daycareDailyRate = daycare_daily_rate != null ? Number(daycare_daily_rate) : null
    if (daycare_checkin_time !== undefined) {
      const parsed = parseTimeString(daycare_checkin_time)
      if (parsed) data.daycareCheckinTime = parsed
    }
    if (daycare_checkout_time !== undefined) {
      const parsed = parseTimeString(daycare_checkout_time)
      if (parsed) data.daycareCheckoutTime = parsed
    }

    const config = await prisma.petshopLodgingConfig.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: { ...data, updatedAt: new Date() },
    })

    const capacities = await prisma.petshopLodgingCapacity.findMany({
      where: { companyId },
      orderBy: [{ type: 'asc' }, { dayOfWeek: 'asc' }],
    })

    res.json(shapeConfig(config, capacities))
  } catch (error) {
    console.error('Error upserting lodging config:', error)
    res.status(500).json({ error: 'Failed to update lodging config' })
  }
}

// PUT /lodging-config/capacity
export async function upsertLodgingCapacity(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { capacities } = req.body

    if (!Array.isArray(capacities) || capacities.length === 0) {
      return res.status(400).json({ error: 'capacities must be a non-empty array' })
    }

    const bhRows = await loadBusinessHourRows(companyId)

    const upsertPromises = capacities.map((entry: any) => {
      const { type, day_of_week, max_capacity, is_active } = entry

      if (!type || day_of_week === undefined || max_capacity === undefined) {
        return Promise.reject(new Error('Each capacity entry must have type, day_of_week, and max_capacity'))
      }

      const row = bhRows.find((r) => r.day_of_week === day_of_week)
      const isDayClosed =
        !row || row.is_closed || row.open_time == null || row.close_time == null

      const effectiveIsActive = isDayClosed ? false : (is_active ?? true)
      const effectiveMaxCapacity = isDayClosed ? 0 : Number(max_capacity)

      return prisma.petshopLodgingCapacity.upsert({
        where: {
          companyId_type_dayOfWeek: {
            companyId,
            type,
            dayOfWeek: day_of_week,
          },
        },
        create: {
          companyId,
          type,
          dayOfWeek: day_of_week,
          maxCapacity: effectiveMaxCapacity,
          isActive: effectiveIsActive,
        },
        update: {
          maxCapacity: effectiveMaxCapacity,
          isActive: effectiveIsActive,
        },
      })
    })

    await Promise.all(upsertPromises)

    const updatedCapacities = await prisma.petshopLodgingCapacity.findMany({
      where: { companyId },
      orderBy: [{ type: 'asc' }, { dayOfWeek: 'asc' }],
    })

    res.json(
      updatedCapacities.map((c) => ({
        id: c.id,
        type: c.type,
        day_of_week: c.dayOfWeek,
        max_capacity: c.maxCapacity,
        is_active: c.isActive,
      }))
    )
  } catch (error) {
    console.error('Error upserting lodging capacity:', error)
    res.status(500).json({ error: 'Failed to update lodging capacity' })
  }
}
