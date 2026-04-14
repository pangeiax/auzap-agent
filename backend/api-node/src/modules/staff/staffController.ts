import { Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import type { CreateStaffDTO, UpdateStaffDTO, CreateStaffScheduleDTO, WorkHoursByDay } from './types'

// ── Utilitários ───────────────────────────────────────────────

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, '0')
  const m = (minutes % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

function fmtTime(t: Date | string | null | undefined): string | null {
  if (!t) return null
  if (t instanceof Date) {
    const h = t.getUTCHours().toString().padStart(2, '0')
    const m = t.getUTCMinutes().toString().padStart(2, '0')
    return `${h}:${m}`
  }
  const s = String(t)
  if (s.includes('T')) return s.split('T')[1]?.slice(0, 5) ?? null
  return s.slice(0, 5)
}

/** Resolve work hours for a specific day, using per-day overrides if available */
function getStaffHoursForDay(
  staff: { workStart: Date | null; workEnd: Date | null; lunchStart: Date | null; lunchEnd: Date | null; workHoursByDay: unknown },
  dayOfWeek: number
): { workStart: string; workEnd: string; lunchStart: string | null; lunchEnd: string | null } {
  const byDay = staff.workHoursByDay as WorkHoursByDay | null
  const dayKey = String(dayOfWeek)

  if (byDay && byDay[dayKey]) {
    const d = byDay[dayKey]
    return {
      workStart: d.start,
      workEnd: d.end,
      lunchStart: d.lunch_start ?? null,
      lunchEnd: d.lunch_end ?? null,
    }
  }

  return {
    workStart: fmtTime(staff.workStart) ?? '08:00',
    workEnd: fmtTime(staff.workEnd) ?? '18:00',
    lunchStart: fmtTime(staff.lunchStart),
    lunchEnd: fmtTime(staff.lunchEnd),
  }
}

// ── CRUD Funcionários ─────────────────────────────────────────

export async function listStaff(req: Request, res: Response) {
  const companyId = req.user!.companyId
  const staff = await prisma.petshopStaff.findMany({
    where: { companyId, isActive: true },
    orderBy: { name: 'asc' },
  })
  return res.json(staff)
}

export async function createStaff(req: Request, res: Response) {
  const companyId = req.user!.companyId
  const body = req.body as CreateStaffDTO

  if (!body.name) return res.status(400).json({ error: 'name é obrigatório' })
  if (!body.days_of_week?.length) return res.status(400).json({ error: 'days_of_week é obrigatório' })
  if (!body.work_start || !body.work_end) return res.status(400).json({ error: 'work_start e work_end são obrigatórios' })

  const staff = await prisma.petshopStaff.create({
    data: {
      companyId,
      name: body.name,
      role: body.role ?? null,
      specialtyIds: body.specialty_ids ?? [],
      daysOfWeek: body.days_of_week,
      workStart: new Date(`1970-01-01T${body.work_start}:00`),
      workEnd: new Date(`1970-01-01T${body.work_end}:00`),
      lunchStart: body.lunch_start ? new Date(`1970-01-01T${body.lunch_start}:00`) : null,
      lunchEnd: body.lunch_end ? new Date(`1970-01-01T${body.lunch_end}:00`) : null,
      workHoursByDay: body.work_hours_by_day ? (body.work_hours_by_day as unknown as Prisma.InputJsonValue) : undefined,
    },
  })

  return res.status(201).json(staff)
}

export async function updateStaff(req: Request, res: Response) {
  const companyId = req.user!.companyId
  const { id } = req.params
  const body = req.body as UpdateStaffDTO

  const existing = await prisma.petshopStaff.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ error: 'Funcionário não encontrado' })

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) data.name = body.name
  if (body.role !== undefined) data.role = body.role
  if (body.specialty_ids !== undefined) data.specialtyIds = body.specialty_ids
  if (body.days_of_week !== undefined) data.daysOfWeek = body.days_of_week
  if (body.work_start !== undefined) data.workStart = new Date(`1970-01-01T${body.work_start}:00`)
  if (body.work_end !== undefined) data.workEnd = new Date(`1970-01-01T${body.work_end}:00`)
  if ('lunch_start' in body) data.lunchStart = body.lunch_start ? new Date(`1970-01-01T${body.lunch_start}:00`) : null
  if ('lunch_end' in body) data.lunchEnd = body.lunch_end ? new Date(`1970-01-01T${body.lunch_end}:00`) : null
  if ('work_hours_by_day' in body) data.workHoursByDay = body.work_hours_by_day ? (body.work_hours_by_day as unknown as Prisma.InputJsonValue) : null

  const updated = await prisma.petshopStaff.update({ where: { id }, data })
  return res.json(updated)
}

export async function deactivateStaff(req: Request, res: Response) {
  const companyId = req.user!.companyId
  const { id } = req.params

  const existing = await prisma.petshopStaff.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ error: 'Funcionário não encontrado' })

  const updated = await prisma.petshopStaff.update({
    where: { id },
    data: { isActive: false },
  })
  return res.json(updated)
}

// ── Bloqueios (schedules) ──────────────────────────────────────

export async function listStaffSchedules(req: Request, res: Response) {
  const companyId = req.user!.companyId
  const { id } = req.params

  const staff = await prisma.petshopStaff.findFirst({ where: { id, companyId } })
  if (!staff) return res.status(404).json({ error: 'Funcionário não encontrado' })

  const schedules = await prisma.petshopStaffSchedule.findMany({
    where: { staffId: id },
    orderBy: { startDate: 'asc' },
  })
  return res.json(schedules)
}

export async function createStaffSchedule(req: Request, res: Response) {
  const companyId = req.user!.companyId
  const { id } = req.params
  const body = req.body as CreateStaffScheduleDTO

  const staff = await prisma.petshopStaff.findFirst({ where: { id, companyId } })
  if (!staff) return res.status(404).json({ error: 'Funcionário não encontrado' })

  if (!body.start_date) return res.status(400).json({ error: 'start_date é obrigatório' })

  const schedule = await prisma.petshopStaffSchedule.create({
    data: {
      companyId,
      staffId: id,
      type: body.type ?? null,
      startDate: new Date(body.start_date),
      endDate: body.end_date ? new Date(body.end_date) : null,
      startTime: body.start_time ? new Date(`1970-01-01T${body.start_time}:00`) : null,
      endTime: body.end_time ? new Date(`1970-01-01T${body.end_time}:00`) : null,
      notes: body.notes ?? null,
    },
  })
  return res.status(201).json(schedule)
}

export async function deleteStaffSchedule(req: Request, res: Response) {
  const companyId = req.user!.companyId
  const { id, scheduleId } = req.params

  const staff = await prisma.petshopStaff.findFirst({ where: { id, companyId } })
  if (!staff) return res.status(404).json({ error: 'Funcionário não encontrado' })

  const schedule = await prisma.petshopStaffSchedule.findFirst({ where: { id: scheduleId, staffId: id } })
  if (!schedule) return res.status(404).json({ error: 'Bloqueio não encontrado' })

  await prisma.petshopStaffSchedule.delete({ where: { id: scheduleId } })
  return res.json({ success: true })
}

// ── Disponibilidade ───────────────────────────────────────────

export type StaffAvailabilitySlot = {
  staff_id: string
  staff_name: string
  start_time: string
  end_time: string
  date: string
}

export type StaffAvailabilityResult = {
  available: boolean
  date: string
  available_slots: StaffAvailabilitySlot[]
}

/** Core staff availability logic — reusable by endpoints and internal tools (Second Brain). */
export async function computeStaffAvailability(
  companyId: number,
  args: { specialty_id: string; date: string; service_id?: string; pet_id?: string },
): Promise<StaffAvailabilityResult> {
  const { specialty_id, date, service_id, pet_id } = args

  // Buscar duração do serviço (com multiplicador para pet G/GG)
  let durationMinutes = 60
  if (service_id) {
    const svc = await prisma.petshopService.findFirst({
      where: { id: parseInt(service_id), companyId, isActive: true },
    })
    if (svc) {
      durationMinutes = svc.durationMin
      if (pet_id && svc.durationMultiplierLarge) {
        const pet = await prisma.petshopPet.findFirst({
          where: { id: pet_id, companyId },
          select: { size: true },
        })
        const size = (pet?.size ?? '').trim().toUpperCase()
        if ((size === 'G' || size === 'GG') && Number(svc.durationMultiplierLarge) > 1) {
          durationMinutes = Math.round(svc.durationMin * Number(svc.durationMultiplierLarge))
        }
      }
    }
  }

  // Funcionários ativos que atendem esta especialidade
  const allStaff = await prisma.petshopStaff.findMany({
    where: { companyId, isActive: true },
  })
  const staffList = allStaff.filter(s => s.specialtyIds.includes(specialty_id))

  if (!staffList.length) {
    return { available: false, date, available_slots: [] }
  }

  const parsedDate = new Date(date + 'T12:00:00Z')
  const dayOfWeek = parsedDate.getUTCDay()

  // Verificar business hours do petshop para este dia
  type BhRow = { open_time: Date | null; close_time: Date | null; is_closed: boolean }
  const bhRows = await prisma.$queryRaw<BhRow[]>`
    SELECT open_time, close_time, is_closed
    FROM petshop_business_hours
    WHERE company_id = ${companyId} AND day_of_week = ${dayOfWeek}
  `
  const bh = bhRows[0]
  if (bh?.is_closed || (bh && !bh.open_time)) {
    return { available: false, date, available_slots: [] }
  }
  const shopOpen = bh?.open_time ? bh.open_time.getUTCHours() * 60 + bh.open_time.getUTCMinutes() : null
  const shopClose = bh?.close_time ? bh.close_time.getUTCHours() * 60 + bh.close_time.getUTCMinutes() : null

  const results: StaffAvailabilitySlot[] = []

  for (const staff of staffList) {
    if (!staff.daysOfWeek.includes(dayOfWeek)) continue

    const blocks = await prisma.petshopStaffSchedule.findMany({
      where: {
        staffId: staff.id,
        startDate: { lte: parsedDate },
        OR: [
          { endDate: { gte: parsedDate } },
          { endDate: null, startDate: parsedDate },
        ],
      },
    })

    const fullDayBlock = blocks.some(b => !b.startTime && !b.endTime)
    if (fullDayBlock) continue

    const appointments = await prisma.petshopAppointment.findMany({
      where: {
        staffId: staff.id,
        scheduledDate: parsedDate,
        status: { notIn: ['cancelled'] },
      },
      include: { service: { select: { durationMin: true } } },
    })

    const busyPeriods: { start: number; end: number }[] = []

    for (const appt of appointments) {
      if (appt.startTime) {
        const startMin = timeToMinutes(fmtTime(appt.startTime)!)
        const dur = appt.service?.durationMin ?? 60
        busyPeriods.push({ start: startMin, end: startMin + dur })
      }
    }

    const dayHours = getStaffHoursForDay(staff, dayOfWeek)

    if (dayHours.lunchStart && dayHours.lunchEnd) {
      busyPeriods.push({
        start: timeToMinutes(dayHours.lunchStart),
        end: timeToMinutes(dayHours.lunchEnd),
      })
    }

    for (const block of blocks) {
      if (block.startTime && block.endTime) {
        busyPeriods.push({
          start: timeToMinutes(fmtTime(block.startTime)!),
          end: timeToMinutes(fmtTime(block.endTime)!),
        })
      }
    }

    let workStart = timeToMinutes(dayHours.workStart)
    let workEnd = timeToMinutes(dayHours.workEnd)

    // Limitar ao horário de funcionamento do petshop
    if (shopOpen !== null) workStart = Math.max(workStart, shopOpen)
    if (shopClose !== null) workEnd = Math.min(workEnd, shopClose)

    if (workStart >= workEnd) continue

    let cursor = workStart

    while (cursor + durationMinutes <= workEnd) {
      const slotEnd = cursor + durationMinutes
      const hasConflict = busyPeriods.some(
        busy => cursor < busy.end && slotEnd > busy.start
      )

      if (!hasConflict) {
        results.push({
          staff_id: staff.id,
          staff_name: staff.name,
          start_time: minutesToTime(cursor),
          end_time: minutesToTime(slotEnd),
          date,
        })
      }

      cursor += 15
    }
  }

  results.sort((a, b) => a.start_time.localeCompare(b.start_time))

  return { available: results.length > 0, date, available_slots: results }
}

export async function getStaffAvailability(req: Request, res: Response) {
  const companyId = req.user!.companyId
  const { specialty_id, date, service_id, pet_id } = req.query as Record<string, string>

  if (!specialty_id || !date) {
    return res.status(400).json({ error: 'specialty_id e date são obrigatórios' })
  }

  const result = await computeStaffAvailability(companyId, { specialty_id, date, service_id, pet_id })
  return res.json(result)
}
