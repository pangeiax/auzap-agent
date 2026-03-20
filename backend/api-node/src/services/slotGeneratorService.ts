import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import {
  businessHoursMapFromRows,
  isSlotWithinBusinessHoursFromMap,
  isSlotWithinBusinessHoursFromTable,
  loadBusinessHourRows,
} from '../lib/businessHoursTable'

const MAX_DAYS_AHEAD = 60

export const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// Re-export para módulos que já importavam daqui
export {
  isDayOpenFromTable,
  isSlotWithinBusinessHoursFromTable,
  type BusinessHourRow,
} from '../lib/businessHoursTable'

/**
 * Enforces business hours on existing future slots (fonte: petshop_business_hours).
 */
export async function enforceBusinessHoursOnSlots(companyId: number): Promise<number> {
  const bhRows = await loadBusinessHourRows(companyId)

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
    if (!isSlotWithinBusinessHoursFromTable(bhRows, dow, slot.slot_time)) {
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

/** Chunks maiores = menos round-trips; transação única abaixo amortiza commit. */
const SLOT_INSERT_CHUNK = 8000

/**
 * Generates slots for ALL active specialties of a company (or all companies).
 * Fonte da verdade: petshop_business_hours (sem linha para o DOW = horário liberado).
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
    const [bhRows, specialties] = await Promise.all([
      loadBusinessHourRows(company.id),
      prisma.petshopSpecialty.findMany({
        where: { companyId: company.id, isActive: true },
        select: { id: true },
      }),
    ])

    if (specialties.length === 0) continue

    const specialtyIds = specialties.map((s) => s.id)
    const bhByDow = businessHoursMapFromRows(bhRows)

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

    const slotRows: Prisma.Sql[] = []
    for (const rule of rules) {
      if (!isSlotWithinBusinessHoursFromMap(bhByDow, rule.dayOfWeek, rule.slotTime)) continue

      const dates = datesByDay.get(rule.dayOfWeek) ?? []
      for (const slotDate of dates) {
        slotRows.push(
          Prisma.sql`(gen_random_uuid(), ${company.id}, ${rule.specialtyId}::uuid, ${slotDate}::date, ${rule.slotTime}::time, ${rule.maxCapacity}, 0)`,
        )
      }
    }

    if (slotRows.length === 0) continue

    await prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < slotRows.length; i += SLOT_INSERT_CHUNK) {
          const chunk = slotRows.slice(i, i + SLOT_INSERT_CHUNK)
          await tx.$executeRaw`
            INSERT INTO petshop_slots (id, company_id, specialty_id, slot_date, slot_time, max_capacity, used_capacity)
            VALUES ${Prisma.join(chunk)}
            ON CONFLICT (specialty_id, slot_date, slot_time)
            DO UPDATE SET max_capacity = EXCLUDED.max_capacity`
        }
      },
      { timeout: 120_000 },
    )

    totalProcessed += slotRows.length
  }

  return { companies: companies.length, slots_processed: totalProcessed }
}
