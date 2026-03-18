import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'

const MAX_DAYS_AHEAD = 60

export const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

export function isDayOpen(businessHours: Record<string, any> | null, dayOfWeek: number): boolean {
  if (!businessHours || Object.keys(businessHours).length === 0) return true
  const dayName = DAY_NAMES[dayOfWeek] as string | undefined
  if (!dayName) return true
  const dayConfig = businessHours[dayName]
  if (!dayConfig || dayConfig.closed === true || !dayConfig.open || !dayConfig.close) return false
  return true
}

export function isSlotWithinBusinessHours(
  businessHours: Record<string, any> | null,
  dayOfWeek: number,
  slotTime: Date,
): boolean {
  if (!businessHours || Object.keys(businessHours).length === 0) return true
  const dayName = DAY_NAMES[dayOfWeek] as string | undefined
  if (!dayName) return true

  const dayConfig = businessHours[dayName]
  if (!dayConfig || dayConfig.closed === true || !dayConfig.open || !dayConfig.close) return false

  const [openH = 0, openM = 0] = String(dayConfig.open).split(':').map(Number)
  const [closeH = 0, closeM = 0] = String(dayConfig.close).split(':').map(Number)
  const openMinutes = openH * 60 + openM
  const closeMinutes = closeH * 60 + closeM
  const slotMinutes = slotTime.getUTCHours() * 60 + slotTime.getUTCMinutes()
  return slotMinutes >= openMinutes && slotMinutes < closeMinutes
}

/**
 * Enforces business hours on existing future slots.
 * Slots for days/times outside business hours: max_capacity=0, used_capacity=0 (effectively disabled).
 * Called after business_hours changes.
 */
export async function enforceBusinessHoursOnSlots(companyId: number): Promise<number> {
  const profile = await prisma.petshopProfile.findUnique({
    where: { companyId },
    select: { businessHours: true },
  })
  const businessHours = profile?.businessHours as Record<string, any> | null
  if (!businessHours) return 0

  const today = new Date()
  const futureSlotsRaw = await prisma.$queryRaw<Array<{ id: string; slot_date: Date; slot_time: Date }>>`
    SELECT id, slot_date, slot_time
    FROM petshop_slots
    WHERE company_id = ${companyId}
      AND slot_date >= ${today}::date
      AND used_capacity = 0
  `

  const toDeactivate: string[] = []
  for (const slot of futureSlotsRaw) {
    const dow = slot.slot_date.getUTCDay()
    if (!isSlotWithinBusinessHours(businessHours, dow, slot.slot_time)) {
      toDeactivate.push(slot.id)
    }
  }

  if (toDeactivate.length > 0) {
    await prisma.$executeRaw`
      UPDATE petshop_slots
      SET max_capacity = 0
      WHERE id = ANY(${toDeactivate}::uuid[])
        AND used_capacity = 0
    `
  }

  return toDeactivate.length
}

/**
 * Generates slots for ALL active specialties of a company (or all companies).
 *
 * Rules:
 *  - Never generates beyond today + 60 days
 *  - Uses INSERT ... ON CONFLICT DO UPDATE in a single query per company
 *  - Ignores specialties / companies that are inactive
 *  - Respects business_hours from petshop_profile
 *  - used_capacity always starts at 0 on creation (appointments update it)
 */
export async function generateSlotsForCompany(
  companyId?: number,
  requestedDays = 60,
): Promise<{ companies: number; slots_processed: number }> {
  const days = Math.min(requestedDays, MAX_DAYS_AHEAD)

  const companies = await prisma.saasCompany.findMany({
    where: {
      ...(companyId ? { id: companyId } : {}),
      isActive: true,
    },
    select: { id: true },
  })

  let totalProcessed = 0

  for (const company of companies) {
    // Parallel: fetch profile, specialties, and clean up old empty slots
    const [profile, specialties] = await Promise.all([
      prisma.petshopProfile.findUnique({
        where: { companyId: company.id },
        select: { businessHours: true },
      }),
      prisma.petshopSpecialty.findMany({
        where: { companyId: company.id, isActive: true },
        select: { id: true },
      }),
    ])

    const businessHours = profile?.businessHours as Record<string, any> | null

    if (specialties.length === 0) continue

    const specialtyIds = specialties.map((s) => s.id)

    // Parallel: fetch capacity rules + delete old empty slots
    const [rules] = await Promise.all([
      prisma.specialtyCapacityRule.findMany({
        where: { companyId: company.id, specialtyId: { in: specialtyIds }, isActive: true },
      }),
      prisma.petshopSlot.deleteMany({
        where: {
          companyId: company.id,
          slotDate: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          usedCapacity: 0,
        },
      }),
    ])

    if (rules.length === 0) continue

    // Pre-compute matching dates per dayOfWeek to avoid recomputing in inner loop
    const uniqueDays = [...new Set(rules.map((r) => r.dayOfWeek))]
    const today = new Date()
    const datesByDay = new Map<number, Date[]>()
    for (const dow of uniqueDays) {
      const dates: Date[] = []
      for (let i = 0; i < days; i++) {
        const d = new Date(today)
        d.setDate(today.getDate() + i)
        if (d.getUTCDay() === dow) {
          dates.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())))
        }
      }
      datesByDay.set(dow, dates)
    }

    // Build all slot rows for this company
    const slotRows: Prisma.Sql[] = []
    for (const rule of rules) {
      if (!isSlotWithinBusinessHours(businessHours, rule.dayOfWeek, rule.slotTime)) continue
      const dates = datesByDay.get(rule.dayOfWeek) ?? []
      for (const slotDate of dates) {
        slotRows.push(
          Prisma.sql`(gen_random_uuid(), ${company.id}, ${rule.specialtyId}::uuid, ${slotDate}::date, ${rule.slotTime}::time, ${rule.maxCapacity}, 0)`,
        )
      }
    }

    if (slotRows.length === 0) continue

    await prisma.$executeRaw`
      INSERT INTO petshop_slots (id, company_id, specialty_id, slot_date, slot_time, max_capacity, used_capacity)
      VALUES ${Prisma.join(slotRows)}
      ON CONFLICT (specialty_id, slot_date, slot_time)
      DO UPDATE SET max_capacity = EXCLUDED.max_capacity`

    totalProcessed += slotRows.length
  }

  return { companies: companies.length, slots_processed: totalProcessed }
}
