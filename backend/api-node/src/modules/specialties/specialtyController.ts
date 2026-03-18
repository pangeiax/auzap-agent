import { Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(d: Date): string {
  const dt = new Date(d)
  return `${String(dt.getUTCHours()).padStart(2, '0')}:${String(dt.getUTCMinutes()).padStart(2, '0')}`
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function isSlotWithinBusinessHours(
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
 * Builds the Prisma.Sql row fragments for a bulk INSERT into petshop_slots.
 * Only generates rows for rules that pass business-hours validation.
 * Groups dates by dayOfWeek to avoid recomputing them for each rule.
 */
function buildSlotRows(
  companyId: number,
  specialtyId: string,
  businessHours: Record<string, any> | null,
  rules: Array<{ dayOfWeek: number; slotTime: Date; maxCapacity: number }>,
  days: number,
): Prisma.Sql[] {
  const datesByDay = new Map<number, Date[]>()
  const uniqueDays = [...new Set(rules.map((r) => r.dayOfWeek))]
  const today = new Date()
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

  const rows: Prisma.Sql[] = []
  for (const rule of rules) {
    if (!isSlotWithinBusinessHours(businessHours, rule.dayOfWeek, rule.slotTime)) continue
    const dates = datesByDay.get(rule.dayOfWeek) ?? []
    for (const slotDate of dates) {
      rows.push(
        Prisma.sql`(gen_random_uuid(), ${companyId}, ${specialtyId}::uuid, ${slotDate}::date, ${rule.slotTime}::time, ${rule.maxCapacity}, 0)`,
      )
    }
  }
  return rows
}

// ─── GET /specialties ─────────────────────────────────────────────────────────

export async function listSpecialties(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { is_active } = req.query

    const where: any = { companyId }
    if (is_active !== undefined) where.isActive = is_active === 'true'

    const specialties = await prisma.petshopSpecialty.findMany({
      where,
      orderBy: { name: 'asc' },
    })

    res.json(specialties)
  } catch (error) {
    console.error('Error listing specialties:', error)
    res.status(500).json({ error: 'Failed to list specialties' })
  }
}

// ─── GET /specialties/:id ─────────────────────────────────────────────────────

export async function getSpecialty(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const id = req.params.id!

    const specialty = await prisma.petshopSpecialty.findUnique({
      where: { id },
      include: {
        services: { where: { isActive: true }, select: { id: true, name: true, price: true, priceBySize: true, durationMin: true } },
        capacityRules: { where: { isActive: true }, orderBy: [{ dayOfWeek: 'asc' }, { slotTime: 'asc' }] },
      },
    })

    if (!specialty || specialty.companyId !== companyId) {
      return res.status(404).json({ error: 'Specialty not found' })
    }

    res.json(specialty)
  } catch (error) {
    console.error('Error getting specialty:', error)
    res.status(500).json({ error: 'Failed to get specialty' })
  }
}

// ─── POST /specialties ────────────────────────────────────────────────────────

export async function createSpecialty(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { name, color, description } = req.body

    if (!name) return res.status(400).json({ error: 'name é obrigatório' })

    const specialty = await prisma.petshopSpecialty.create({
      data: { companyId, name, color, description, isActive: true },
    })

    res.status(201).json(specialty)
  } catch (error: any) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'Já existe uma especialidade com este nome' })
    console.error('Error creating specialty:', error)
    res.status(500).json({ error: 'Failed to create specialty' })
  }
}

// ─── PATCH /specialties/:id ───────────────────────────────────────────────────

export async function updateSpecialty(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const id = req.params.id!
    const { name, color, description, is_active } = req.body

    const existing = await prisma.petshopSpecialty.findUnique({ where: { id } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Specialty not found' })
    }

    const data: any = {}
    if (name !== undefined) data.name = name
    if (color !== undefined) data.color = color
    if (description !== undefined) data.description = description
    if (is_active !== undefined) data.isActive = is_active

    const specialty = await prisma.petshopSpecialty.update({ where: { id }, data })

    if (is_active === false) {
      await prisma.petshopService.updateMany({
        where: { specialtyId: id, companyId },
        data: { isActive: false },
      })
    }

    res.json(specialty)
  } catch (error: any) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'Já existe uma especialidade com este nome' })
    console.error('Error updating specialty:', error)
    res.status(500).json({ error: 'Failed to update specialty' })
  }
}

// ─── DELETE /specialties/:id ──────────────────────────────────────────────────

export async function deleteSpecialty(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const id = req.params.id!

    const existing = await prisma.petshopSpecialty.findUnique({ where: { id } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Specialty not found' })
    }

    await prisma.petshopSpecialty.update({ where: { id }, data: { isActive: false } })
    await prisma.petshopService.updateMany({
      where: { specialtyId: id, companyId },
      data: { isActive: false },
    })
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting specialty:', error)
    res.status(500).json({ error: 'Failed to delete specialty' })
  }
}

// ─── GET /specialties/:id/capacity-rules ──────────────────────────────────────
// Parallel fetch: ownership check + rules query in a single round-trip

export async function listCapacityRules(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const specialtyId = req.params.id!

    const [specialty, rules] = await Promise.all([
      prisma.petshopSpecialty.findUnique({ where: { id: specialtyId }, select: { companyId: true } }),
      prisma.specialtyCapacityRule.findMany({
        where: { specialtyId, companyId },
        orderBy: [{ dayOfWeek: 'asc' }, { slotTime: 'asc' }],
      }),
    ])

    if (!specialty || specialty.companyId !== companyId) {
      return res.status(404).json({ error: 'Specialty not found' })
    }

    res.json(rules.map((r) => ({ ...r, slot_time: fmtTime(r.slotTime) })))
  } catch (error) {
    console.error('Error listing capacity rules:', error)
    res.status(500).json({ error: 'Failed to list capacity rules' })
  }
}

// ─── POST /specialties/:id/capacity-rules (legacy single-rule endpoint) ────────

export async function upsertCapacityRule(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const specialtyId = req.params.id!
    const { day_of_week, slot_time, max_capacity } = req.body

    if (day_of_week === undefined || !slot_time || !max_capacity) {
      return res.status(400).json({ error: 'day_of_week, slot_time e max_capacity são obrigatórios' })
    }

    const specialty = await prisma.petshopSpecialty.findUnique({ where: { id: specialtyId } })
    if (!specialty || specialty.companyId !== companyId) {
      return res.status(404).json({ error: 'Specialty not found' })
    }

    const [hh, mm] = String(slot_time).split(':').map(Number)
    const slotTimeDate = new Date(Date.UTC(1970, 0, 1, hh, mm, 0))

    const rule = await prisma.specialtyCapacityRule.upsert({
      where: { specialtyId_dayOfWeek_slotTime: { specialtyId, dayOfWeek: Number(day_of_week), slotTime: slotTimeDate } },
      create: { specialtyId, companyId, dayOfWeek: Number(day_of_week), slotTime: slotTimeDate, maxCapacity: Number(max_capacity), isActive: true },
      update: { maxCapacity: Number(max_capacity), isActive: true },
    })

    await generateSlotsForRule(specialtyId, companyId, Number(day_of_week), slotTimeDate, Number(max_capacity))

    res.status(201).json(rule)
  } catch (error) {
    console.error('Error upserting capacity rule:', error)
    res.status(500).json({ error: 'Failed to upsert capacity rule' })
  }
}

// ─── POST /specialties/:id/capacity-rules/bulk ────────────────────────────────
// Accepts rules as { day_of_week, max_capacity, slot_time? }.
// slot_time is OPTIONAL: when omitted the backend derives it automatically from
// the petshop's business_hours opening time for that weekday (or "08:00" default).
// This enforces 1 rule per day per specialty — the editor only configures capacity.
//
// Steps:
//   1. Single raw SQL INSERT ON CONFLICT for capacity rules
//   2. Single raw SQL INSERT ON CONFLICT for slots of changed rules only
//   3. Deactivate rules no longer in payload + zero-out their future slots

export async function bulkUpsertCapacityRules(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const specialtyId = req.params.id!

    const rulesPayload = (req.body as any)?.rules

    if (!Array.isArray(rulesPayload)) {
      return res.status(400).json({ error: 'rules deve ser um array' })
    }

    // ── Pre-validate structure (no DB round-trips yet) ───────────────────────
    for (const raw of rulesPayload as any[]) {
      const dayOfWeek = Number(raw?.day_of_week)
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        return res.status(400).json({ error: 'day_of_week inválido (0-6)' })
      }
      if (raw?.slot_time != null) {
        const parts = String(raw.slot_time).split(':')
        const hh = Number(parts[0])
        const mm = Number(parts[1])
        if (parts.length < 2 || !Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
          return res.status(400).json({ error: 'slot_time inválido (use HH:MM)' })
        }
      }
      const maxCapacity = Number(raw?.max_capacity)
      if (!Number.isFinite(maxCapacity) || maxCapacity < 0) {
        return res.status(400).json({ error: 'max_capacity inválido' })
      }
    }

    // ── Parallel fetch: ownership + existing rules + business hours ──────────
    const [specialty, existingRules, profile] = await Promise.all([
      prisma.petshopSpecialty.findUnique({ where: { id: specialtyId }, select: { companyId: true } }),
      prisma.specialtyCapacityRule.findMany({ where: { specialtyId, companyId } }),
      prisma.petshopProfile.findUnique({ where: { companyId }, select: { businessHours: true } }),
    ])

    if (!specialty || specialty.companyId !== companyId) {
      return res.status(404).json({ error: 'Specialty not found' })
    }

    const businessHours = profile?.businessHours as Record<string, any> | null

    // ── Normalize rules (derive slot_time from business hours when missing) ───
    type NormalizedRule = { dayOfWeek: number; slotTime: Date; slotTimeKey: string; maxCapacity: number }
    const normalizedRules: NormalizedRule[] = []

    for (const raw of rulesPayload as any[]) {
      const dayOfWeek = Number(raw?.day_of_week)
      const maxCapacity = Number(raw?.max_capacity)

      let hh: number
      let mm: number

      if (raw?.slot_time != null) {
        const parts = String(raw.slot_time).split(':')
        hh = Number(parts[0])
        mm = Number(parts[1])
      } else {
        // Derive from business hours opening time for this weekday
        const dayName = DAY_NAMES[dayOfWeek] as string
        const dayBH = (businessHours && Object.keys(businessHours).length > 0) ? businessHours[dayName] : null
        const openStr: string = dayBH?.open ?? '08:00'
        const parts = openStr.split(':')
        hh = Number(parts[0] ?? '8')
        mm = Number(parts[1] ?? '0')
        if (!Number.isInteger(hh) || hh < 0 || hh > 23) hh = 8
        if (!Number.isInteger(mm) || mm < 0 || mm > 59) mm = 0
      }

      const slotTime = new Date(Date.UTC(1970, 0, 1, hh, mm, 0))
      const slotTimeKey = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
      normalizedRules.push({ dayOfWeek, slotTime, slotTimeKey, maxCapacity })
    }

    // ── Build lookup map of existing rules ───────────────────────────────────
    const existingByKey = new Map<string, (typeof existingRules)[number]>()
    for (const r of existingRules) {
      existingByKey.set(`${r.dayOfWeek}|${fmtTime(r.slotTime)}`, r)
    }

    // ── Determine which rules changed (for selective slot generation) ─────────
    let created = 0
    let updated = 0
    const changedRules: NormalizedRule[] = []
    const desiredKeys = new Set<string>()

    for (const rule of normalizedRules) {
      const key = `${rule.dayOfWeek}|${rule.slotTimeKey}`
      desiredKeys.add(key)

      const existing = existingByKey.get(key)
      if (!existing) {
        created++
        changedRules.push(rule)
      } else if (existing.maxCapacity !== rule.maxCapacity || !existing.isActive) {
        updated++
        changedRules.push(rule)
      }
    }

    // ── Rules to deactivate: active rules whose day is no longer in payload ───
    const rulesToDeactivate = existingRules.filter(
      (r) => r.isActive && !desiredKeys.has(`${r.dayOfWeek}|${fmtTime(r.slotTime)}`),
    )
    const deactivateIds = rulesToDeactivate.map((r) => r.id)
    const deactivated = deactivateIds.length

    // ── Step 1: Bulk upsert capacity rules (single SQL) ──────────────────────
    if (normalizedRules.length > 0) {
      const ruleRows = normalizedRules.map((r) =>
        Prisma.sql`(gen_random_uuid(), ${specialtyId}::uuid, ${companyId}, ${r.dayOfWeek}::smallint, ${r.slotTime}::time, ${r.maxCapacity}, true)`,
      )

      await prisma.$executeRaw`
        INSERT INTO specialty_capacity_rules (id, specialty_id, company_id, day_of_week, slot_time, max_capacity, is_active)
        VALUES ${Prisma.join(ruleRows)}
        ON CONFLICT (specialty_id, day_of_week, slot_time)
        DO UPDATE SET max_capacity = EXCLUDED.max_capacity, is_active = true`
    }

    // ── Step 2: Deactivate removed rules + zero-out their future slots ────────
    if (deactivateIds.length > 0) {
      const today = new Date(Date.UTC(
        new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(),
      ))
      const timeSqls = rulesToDeactivate.map((r) => Prisma.sql`${r.slotTime}::time`)

      await Promise.all([
        prisma.specialtyCapacityRule.updateMany({
          where: { id: { in: deactivateIds }, companyId, specialtyId },
          data: { isActive: false },
        }),
        prisma.$executeRaw`
          UPDATE petshop_slots
          SET max_capacity = 0
          WHERE specialty_id = ${specialtyId}::uuid
            AND company_id = ${companyId}
            AND slot_date >= ${today}::date
            AND slot_time IN (${Prisma.join(timeSqls)})`,
      ])
    }

    // ── Step 3: Generate slots ONLY for changed rules (single SQL) ───────────
    const slotRows = changedRules.length > 0
      ? buildSlotRows(companyId, specialtyId, businessHours, changedRules, 30)
      : []

    if (slotRows.length > 0) {
      await prisma.$executeRaw`
        INSERT INTO petshop_slots (id, company_id, specialty_id, slot_date, slot_time, max_capacity, used_capacity)
        VALUES ${Prisma.join(slotRows)}
        ON CONFLICT (specialty_id, slot_date, slot_time)
        DO UPDATE SET max_capacity = EXCLUDED.max_capacity`
    }

    res.json({ created, updated, deactivated, slots_generated: slotRows.length })
  } catch (error) {
    console.error('Error bulk upserting capacity rules:', error)
    res.status(500).json({ error: 'Failed to bulk upsert capacity rules' })
  }
}

// ─── DELETE /specialties/:id/capacity-rules/:ruleId ───────────────────────────

export async function deleteCapacityRule(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const specialtyId = req.params.id!
    const ruleId = req.params.ruleId!

    const rule = await prisma.specialtyCapacityRule.findUnique({ where: { id: ruleId } })
    if (!rule || rule.companyId !== companyId || rule.specialtyId !== specialtyId) {
      return res.status(404).json({ error: 'Rule not found' })
    }

    await prisma.specialtyCapacityRule.update({ where: { id: ruleId }, data: { isActive: false } })
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting capacity rule:', error)
    res.status(500).json({ error: 'Failed to delete capacity rule' })
  }
}

// ─── POST /specialties/:id/generate-slots ────────────────────────────────────
// Generates slots for the next N days using a single bulk INSERT ON CONFLICT

export async function generateSlots(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const specialtyId = req.params.id!
    const { days = 30 } = req.body

    const [specialty, rules, profile] = await Promise.all([
      prisma.petshopSpecialty.findUnique({ where: { id: specialtyId }, select: { companyId: true } }),
      prisma.specialtyCapacityRule.findMany({ where: { specialtyId, companyId, isActive: true } }),
      prisma.petshopProfile.findUnique({ where: { companyId }, select: { businessHours: true } }),
    ])

    if (!specialty || specialty.companyId !== companyId) {
      return res.status(404).json({ error: 'Specialty not found' })
    }

    if (rules.length === 0) {
      return res.json({ success: true, slots_processed: 0 })
    }

    const businessHours = profile?.businessHours as Record<string, any> | null
    const slotRows = buildSlotRows(
      companyId,
      specialtyId,
      businessHours,
      rules.map((r) => ({ dayOfWeek: r.dayOfWeek, slotTime: r.slotTime, maxCapacity: r.maxCapacity })),
      Number(days),
    )

    const today = new Date(Date.UTC(
      new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(),
    ))

    if (slotRows.length > 0) {
      await prisma.$executeRaw`
        INSERT INTO petshop_slots (id, company_id, specialty_id, slot_date, slot_time, max_capacity, used_capacity)
        VALUES ${Prisma.join(slotRows)}
        ON CONFLICT (specialty_id, slot_date, slot_time)
        DO UPDATE SET max_capacity = EXCLUDED.max_capacity`
    }

    // Zero out future slots whose (day_of_week, slot_time) no longer matches any active rule.
    // This closes slots outside business hours and slots for inactive specialty hours.
    await prisma.$executeRaw`
      UPDATE petshop_slots
      SET max_capacity = 0
      WHERE specialty_id = ${specialtyId}::uuid
        AND company_id = ${companyId}
        AND slot_date >= ${today}::date
        AND (EXTRACT(DOW FROM slot_date)::int, slot_time) NOT IN (
          SELECT day_of_week, slot_time
          FROM specialty_capacity_rules
          WHERE specialty_id = ${specialtyId}::uuid
            AND company_id = ${companyId}
            AND is_active = true
        )`

    res.json({ success: true, slots_processed: slotRows.length })
  } catch (error) {
    console.error('Error generating slots:', error)
    res.status(500).json({ error: 'Failed to generate slots' })
  }
}

// ─── Internal helper: generate slots for a single rule (used by legacy endpoint) ─

async function generateSlotsForRule(
  specialtyId: string,
  companyId: number,
  dayOfWeek: number,
  slotTime: Date,
  maxCapacity: number,
  days = 30,
) {
  const profile = await prisma.petshopProfile.findUnique({
    where: { companyId },
    select: { businessHours: true },
  })
  const businessHours = profile?.businessHours as Record<string, any> | null

  if (!isSlotWithinBusinessHours(businessHours, dayOfWeek, slotTime)) return

  const today = new Date()
  const slotDates: Date[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    if (d.getUTCDay() !== dayOfWeek) continue
    slotDates.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())))
  }

  if (slotDates.length === 0) return

  const rows = slotDates.map((slotDate) =>
    Prisma.sql`(gen_random_uuid(), ${companyId}, ${specialtyId}::uuid, ${slotDate}::date, ${slotTime}::time, ${maxCapacity}, 0)`,
  )

  await prisma.$executeRaw`
    INSERT INTO petshop_slots (id, company_id, specialty_id, slot_date, slot_time, max_capacity, used_capacity)
    VALUES ${Prisma.join(rows)}
    ON CONFLICT (specialty_id, slot_date, slot_time)
    DO UPDATE SET max_capacity = EXCLUDED.max_capacity`
}
