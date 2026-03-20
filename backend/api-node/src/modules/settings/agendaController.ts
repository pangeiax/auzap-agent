import { Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { generateSlotsForCompany } from '../../services/slotGeneratorService'

// ─── Constants ────────────────────────────────────────────────────────────────
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const
const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(t: Date): string {
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`
}

function computeTotalSlotsInRange(openTime: Date, closeTime: Date): number {
  const openMin = openTime.getUTCHours() * 60 + openTime.getUTCMinutes()
  const closeMin = closeTime.getUTCHours() * 60 + closeTime.getUTCMinutes()
  if (closeMin <= openMin) return 0
  return Math.floor((closeMin - openMin) / 60)
}

function generateHourSlots(open: string, close: string): string[] {
  const [oh = 8, om = 0] = open.split(':').map(Number)
  const [ch = 18, cm = 0] = close.split(':').map(Number)
  const openMin = oh * 60 + om
  const closeMin = ch * 60 + cm
  const slots: string[] = []
  for (let m = openMin; m < closeMin; m += 60) {
    slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  }
  return slots
}

type BhRow = { day_of_week: number; open_time: Date | null; close_time: Date | null; is_closed: boolean }
type SlotRow = {
  id: string
  specialty_id: string
  slot_time: Date
  max_capacity: number
  used_capacity: number
  is_blocked: boolean
  block_reason: string | null
}

/** Mesmo payload do GET /settings/agenda — reutilizado após salvar para evitar 2º round-trip. */
async function buildAgendaPayload(companyId: number) {
  const todayUTC = new Date()
  const todayDate = new Date(Date.UTC(todayUTC.getFullYear(), todayUTC.getMonth(), todayUTC.getDate()))
  const todayDow = todayUTC.getDay()

  const [businessHoursRows, specialties, rules, slotsToday] = await Promise.all([
    prisma.$queryRaw<BhRow[]>`
      SELECT day_of_week, open_time, close_time, is_closed
      FROM petshop_business_hours
      WHERE company_id = ${companyId}
    `,
    prisma.petshopSpecialty.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, color: true },
      orderBy: { name: 'asc' },
    }),
    prisma.specialtyCapacityRule.findMany({
      where: { companyId },
    }),
    prisma.$queryRaw<SlotRow[]>`
      SELECT id, specialty_id, slot_time, max_capacity, used_capacity,
             COALESCE(is_blocked, FALSE) AS is_blocked,
             block_reason
      FROM petshop_slots
      WHERE company_id = ${companyId}
        AND slot_date = ${todayDate}::date
      ORDER BY slot_time, specialty_id
    `,
  ])

  const days = DAY_ORDER.map((dow) => {
    const bh = businessHoursRows.find((b) => b.day_of_week === dow)
    const isClosed = !bh || bh.is_closed

    const totalSlotsInRange =
      bh && !bh.is_closed && bh.open_time && bh.close_time
        ? computeTotalSlotsInRange(bh.open_time, bh.close_time)
        : 0

    const capacityBySpecialty = specialties.map((sp) => {
      const spRulesForDay = rules.filter(
        (r) => r.specialtyId === sp.id && r.dayOfWeek === dow && r.isActive,
      )
      const maxCap = spRulesForDay.length > 0 ? spRulesForDay[0]!.maxCapacity : 1
      const totalVagas = totalSlotsInRange * maxCap

      return {
        specialty_id: sp.id,
        specialty_name: sp.name,
        color: sp.color,
        rule_id: spRulesForDay[0]?.id ?? null,
        max_capacity: maxCap,
        is_active: spRulesForDay.length > 0,
        total_slots: totalSlotsInRange,
        total_vagas: totalVagas,
      }
    })

    const daySlots =
      dow === todayDow
        ? slotsToday.map((s) => ({
            slot_id: s.id,
            slot_time: formatTime(s.slot_time),
            specialty_id: s.specialty_id,
            max_capacity: s.max_capacity,
            used_capacity: s.used_capacity,
            is_blocked: s.is_blocked,
            block_reason: s.block_reason,
          }))
        : []

    return {
      day_of_week: dow,
      day_name: DAY_NAMES[dow]!,
      is_closed: isClosed,
      open_time: bh && !bh.is_closed && bh.open_time ? formatTime(bh.open_time) : '09:00',
      close_time: bh && !bh.is_closed && bh.close_time ? formatTime(bh.close_time) : '18:00',
      capacity_by_specialty: capacityBySpecialty,
      slots_today: daySlots,
    }
  })

  return { specialties, days }
}

// ─── GET /settings/agenda ─────────────────────────────────────────────────────
export async function getAgenda(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const payload = await buildAgendaPayload(companyId)
    res.json(payload)
  } catch (error) {
    console.error('[Agenda] getAgenda error:', error)
    res.status(500).json({ error: 'Falha ao carregar agenda' })
  }
}

// ─── PUT /settings/agenda ─────────────────────────────────────────────────────
export async function saveAgenda(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { days } = req.body as {
      days: Array<{
        day_of_week: number
        is_closed: boolean
        open_time: string
        close_time: string
        capacity_by_specialty: Array<{ specialty_id: string; max_capacity: number }>
      }>
    }

    if (!Array.isArray(days)) {
      return res.status(400).json({ error: 'days é obrigatório' })
    }

    await Promise.all(days.map(async (day) => {
      // 1. UPSERT petshop_business_hours
      if (day.is_closed) {
        await prisma.$executeRaw`
          INSERT INTO petshop_business_hours (id, company_id, day_of_week, open_time, close_time, is_closed, updated_at)
          VALUES (gen_random_uuid(), ${companyId}, ${day.day_of_week}, NULL, NULL, TRUE, NOW())
          ON CONFLICT (company_id, day_of_week) DO UPDATE SET
            open_time  = NULL,
            close_time = NULL,
            is_closed  = TRUE,
            updated_at = NOW()
        `
        // Deactivate capacity rules for this day
        await prisma.specialtyCapacityRule.updateMany({
          where: { companyId, dayOfWeek: day.day_of_week },
          data: { isActive: false },
        })
        // Block future empty slots for this day
        await prisma.$executeRaw`
          UPDATE petshop_slots
          SET is_blocked = TRUE, block_reason = 'business_hours', blocked_at = NOW()
          WHERE company_id    = ${companyId}
            AND EXTRACT(DOW FROM slot_date) = ${day.day_of_week}
            AND slot_date    >= CURRENT_DATE
            AND used_capacity = 0
            AND (is_blocked = FALSE OR is_blocked IS NULL)
        `
      } else {
        const openStr  = day.open_time  + ':00'
        const closeStr = day.close_time + ':00'

        await prisma.$executeRaw`
          INSERT INTO petshop_business_hours (id, company_id, day_of_week, open_time, close_time, is_closed, updated_at)
          VALUES (gen_random_uuid(), ${companyId}, ${day.day_of_week},
                  ${openStr}::time, ${closeStr}::time, FALSE, NOW())
          ON CONFLICT (company_id, day_of_week) DO UPDATE SET
            open_time  = EXCLUDED.open_time,
            close_time = EXCLUDED.close_time,
            is_closed  = FALSE,
            updated_at = NOW()
        `

        // 2. UPSERT capacity rules por especialidade em paralelo (mesma lógica; menos latência)
        const slotTimes = generateHourSlots(day.open_time, day.close_time)
        await Promise.all(
          day.capacity_by_specialty.map(async (cap) => {
            if (slotTimes.length === 0) return

            const rows = slotTimes.map(
              (t) =>
                Prisma.sql`(gen_random_uuid(), ${cap.specialty_id}::uuid, ${companyId}, ${day.day_of_week}, ${t + ':00'}::time, ${cap.max_capacity}, TRUE)`,
            )

            await prisma.$executeRaw`
              INSERT INTO specialty_capacity_rules (id, specialty_id, company_id, day_of_week, slot_time, max_capacity, is_active)
              VALUES ${Prisma.join(rows)}
              ON CONFLICT (specialty_id, day_of_week, slot_time) DO UPDATE SET
                max_capacity = EXCLUDED.max_capacity,
                is_active    = TRUE
            `

            await prisma.$executeRaw`
              UPDATE specialty_capacity_rules
              SET is_active = FALSE
              WHERE company_id   = ${companyId}
                AND specialty_id = ${cap.specialty_id}::uuid
                AND day_of_week  = ${day.day_of_week}
                AND (slot_time < ${openStr}::time OR slot_time >= ${closeStr}::time)
            `

            await prisma.$executeRaw`
              UPDATE petshop_slots
              SET max_capacity = ${cap.max_capacity},
                  is_blocked   = FALSE,
                  block_reason = NULL,
                  blocked_at   = NULL
              WHERE company_id   = ${companyId}
                AND specialty_id = ${cap.specialty_id}::uuid
                AND EXTRACT(DOW FROM slot_date) = ${day.day_of_week}
                AND slot_date   >= CURRENT_DATE
                AND slot_time   >= ${openStr}::time
                AND slot_time    < ${closeStr}::time
                AND used_capacity = 0
            `
          }),
        )

        // 3. Block future empty slots outside new time range
        await prisma.$executeRaw`
          UPDATE petshop_slots
          SET is_blocked = TRUE, block_reason = 'business_hours', blocked_at = NOW()
          WHERE company_id = ${companyId}
            AND EXTRACT(DOW FROM slot_date) = ${day.day_of_week}
            AND slot_date  >= CURRENT_DATE
            AND used_capacity = 0
            AND (slot_time < ${openStr}::time OR slot_time >= ${closeStr}::time)
            AND (is_blocked = FALSE OR is_blocked IS NULL)
        `

        // 4. Unblock slots within new range that were blocked by business_hours
        await prisma.$executeRaw`
          UPDATE petshop_slots
          SET is_blocked = FALSE, block_reason = NULL, blocked_at = NULL
          WHERE company_id   = ${companyId}
            AND EXTRACT(DOW FROM slot_date) = ${day.day_of_week}
            AND slot_date    >= CURRENT_DATE
            AND block_reason  = 'business_hours'
            AND slot_time    >= ${openStr}::time
            AND slot_time     < ${closeStr}::time
        `
      }
    }))

    // 5. Regenerate slots for next 60 days
    await generateSlotsForCompany(companyId, 60)

    const agenda = await buildAgendaPayload(companyId)
    res.json({ success: true, specialties: agenda.specialties, days: agenda.days })
  } catch (error) {
    console.error('[Agenda] saveAgenda error:', error)
    res.status(500).json({ error: 'Falha ao salvar agenda' })
  }
}

// ─── PATCH /settings/agenda/slot/:slotId/block ────────────────────────────────
export async function blockSlot(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { slotId } = req.params
    const { is_blocked, force = false } = req.body as { is_blocked: boolean; force?: boolean }

    type SlotCheck = { id: string; used_capacity: number; is_blocked: boolean; block_reason: string | null }
    const rows = await prisma.$queryRaw<SlotCheck[]>`
      SELECT id, used_capacity, COALESCE(is_blocked, FALSE) AS is_blocked, block_reason
      FROM petshop_slots
      WHERE id = ${slotId}::uuid AND company_id = ${companyId}
    `

    if (rows.length === 0) return res.status(404).json({ error: 'Slot não encontrado' })
    const slot = rows[0]!

    // System-blocked slots (non-manual) cannot be edited here
    if (!is_blocked && slot.block_reason && slot.block_reason !== 'manual') {
      return res.status(409).json({
        error: 'Slot bloqueado automaticamente. Altere o horário ou reative a especialidade.',
      })
    }

    // Warn if trying to block a slot with active appointments
    if (is_blocked && slot.used_capacity > 0 && !force) {
      return res.status(409).json({
        error: 'slot_has_appointments',
        message: `Este slot tem ${slot.used_capacity} agendamento(s) ativo(s).`,
        used_capacity: slot.used_capacity,
      })
    }

    if (is_blocked) {
      await prisma.$executeRaw`
        UPDATE petshop_slots
        SET is_blocked = TRUE, block_reason = 'manual', blocked_at = NOW()
        WHERE id = ${slotId}::uuid AND company_id = ${companyId}
      `
    } else {
      await prisma.$executeRaw`
        UPDATE petshop_slots
        SET is_blocked = FALSE, block_reason = NULL, blocked_at = NULL
        WHERE id = ${slotId}::uuid AND company_id = ${companyId}
          AND block_reason = 'manual'
      `
    }

    res.json({ success: true })
  } catch (error) {
    console.error('[Agenda] blockSlot error:', error)
    res.status(500).json({ error: 'Falha ao atualizar slot' })
  }
}

// ─── PATCH /settings/agenda/rule/:ruleId/toggle ───────────────────────────────
export async function toggleRule(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { ruleId } = req.params
    const { is_active } = req.body as { is_active: boolean }

    // Get the rule to find (specialty_id, day_of_week) pair
    const rule = await prisma.specialtyCapacityRule.findFirst({
      where: { id: ruleId as string, companyId },
    })

    if (!rule) return res.status(404).json({ error: 'Rule não encontrada' })

    // Toggle all rules for this specialty+day
    await prisma.specialtyCapacityRule.updateMany({
      where: { companyId, specialtyId: rule.specialtyId, dayOfWeek: rule.dayOfWeek },
      data: { isActive: is_active },
    })

    // If deactivating, block future empty slots for this specialty on this day
    if (!is_active) {
      await prisma.$executeRaw`
        UPDATE petshop_slots
        SET is_blocked = TRUE, block_reason = 'rule_disabled', blocked_at = NOW()
        WHERE company_id   = ${companyId}
          AND specialty_id = ${rule.specialtyId}::uuid
          AND EXTRACT(DOW FROM slot_date) = ${rule.dayOfWeek}
          AND slot_date    >= CURRENT_DATE
          AND used_capacity = 0
      `
    } else {
      // Re-enable: unblock slots that were blocked by rule_disabled
      await prisma.$executeRaw`
        UPDATE petshop_slots
        SET is_blocked = FALSE, block_reason = NULL, blocked_at = NULL
        WHERE company_id   = ${companyId}
          AND specialty_id = ${rule.specialtyId}::uuid
          AND EXTRACT(DOW FROM slot_date) = ${rule.dayOfWeek}
          AND slot_date    >= CURRENT_DATE
          AND block_reason  = 'rule_disabled'
      `
    }

    res.json({ success: true })
  } catch (error) {
    console.error('[Agenda] toggleRule error:', error)
    res.status(500).json({ error: 'Falha ao atualizar rule' })
  }
}
