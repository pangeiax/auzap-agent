import { Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { isUuidString, parseOptionalUuid } from '../../lib/uuidValidation'
import { computeAvailableSlotsResponse } from './availableSlotsQuery'
import { createManualScheduleAppointment } from './manualScheduleCore'

function petSizeNeedsLargeDurationMultiplier(
  size: string | null | undefined,
): boolean {
  const s = (size ?? '').trim().toUpperCase()
  return s === 'G' || s === 'GG'
}

function serviceUsesDurationMultiplierLarge(
  multiplier: Prisma.Decimal | null | undefined,
): boolean {
  if (multiplier == null) return false
  return Number(multiplier) > 1
}

function requiresConsecutiveSlotsBooking(args: {
  durationMultiplierLarge: Prisma.Decimal | null | undefined
  petSize: string | null | undefined
}): boolean {
  return (
    serviceUsesDurationMultiplierLarge(args.durationMultiplierLarge) &&
    petSizeNeedsLargeDurationMultiplier(args.petSize)
  )
}

type SlotRow = {
  id: string
  specialtyId: string
  slotDate: Date
  slotTime: Date
  maxCapacity: number
  usedCapacity: number
  isBlocked: boolean
}

function orderedSlotsSameDaySpecialty(slots: SlotRow[]): SlotRow[] {
  return [...slots].sort(
    (a, b) => a.slotTime.getTime() - b.slotTime.getTime(),
  )
}

function findNextSlotInOrderedDay(
  ordered: SlotRow[],
  currentId: string,
): SlotRow | null {
  const idx = ordered.findIndex((s) => s.id === currentId)
  if (idx < 0 || idx >= ordered.length - 1) return null
  return ordered[idx + 1] ?? null
}

/** Liga os dois agendamentos do par (cancelar/excluir em conjunto). used_capacity é só no banco. */
const DOUBLE_PAIR_PREFIX = '__DOUBLE_PAIR__:'

function mergeNotesWithDoublePair(
  userNotes: string | null | undefined,
  partnerAppointmentId: string,
): string {
  const u = (userNotes ?? '').trim()
  const line = `${DOUBLE_PAIR_PREFIX}${partnerAppointmentId}`
  return u ? `${u}\n${line}` : line
}

function extractDoublePairAppointmentId(
  notes: string | null | undefined,
): string | null {
  if (!notes) return null
  const idx = notes.indexOf(DOUBLE_PAIR_PREFIX)
  if (idx < 0) return null
  const rest = notes.slice(idx + DOUBLE_PAIR_PREFIX.length).trim()
  const m = rest.match(
    /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
  )
  return m?.[1] ?? null
}

/** Há pelo menos um par de slots consecutivos livres neste dia para a especialidade. */
function dayHasBookableConsecutivePair(
  daySlots: SlotRow[],
  specialtyId: string,
): boolean {
  const subset = orderedSlotsSameDaySpecialty(
    daySlots.filter((s) => s.specialtyId === specialtyId),
  )
  for (let i = 0; i < subset.length - 1; i++) {
    const a = subset[i]!
    const b = subset[i + 1]!
    if (a.isBlocked || a.maxCapacity - a.usedCapacity <= 0) continue
    if (b.isBlocked || b.maxCapacity - b.usedCapacity <= 0) continue
    return true
  }
  return false
}

function formatTimeLabel(time: Date): string {
  return `${String(time.getUTCHours()).padStart(2, '0')}:${String(
    time.getUTCMinutes()
  ).padStart(2, '0')}`
}

function parseDateWindow(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return null

  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  if (Number.isNaN(base.getTime())) return null

  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
  const end = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0))

  return {
    weekday: base.getUTCDay(),
    start,
    end,
  }
}

// Combina scheduledDate (Date) + schedule.startTime (Time) em ISO string com offset Brasília
// startTime @db.Time é armazenado em UTC, mas representa horário local (BRT = UTC-3)
function toScheduledAt(date: Date, startTime: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const h = String(startTime.getUTCHours()).padStart(2, '0')
  const min = String(startTime.getUTCMinutes()).padStart(2, '0')
  // Retorna com offset explícito -03:00 para que o cliente exiba corretamente como horário de Brasília
  return `${y}-${m}-${d}T${h}:${min}:00-03:00`
}

function shapeAppointment(a: any) {
  // Prefer slot date+time, fall back to scheduledDate+slotTime, then schedule time, then bare date.
  // Guard against null scheduledDate (appointments created by AI agent without scheduled_date).
  const scheduledAt: string = !a.scheduledDate
    ? (a.slot?.slotDate && a.slot?.slotTime
        ? toScheduledAt(a.slot.slotDate, a.slot.slotTime)
        : (a.createdAt ? new Date(a.createdAt).toISOString() : new Date().toISOString()))
    : a.slot?.slotTime
      ? toScheduledAt(a.scheduledDate, a.slot.slotTime)
      : a.schedule?.startTime
        ? toScheduledAt(a.scheduledDate, a.schedule.startTime)
        : new Date(a.scheduledDate).toISOString()

  return {
    id: a.id,
    client_id: a.clientId,
    client_name: a.client?.name ?? null,
    phone_client: a.client?.phone ?? null,
    phone_client_manual: a.client?.manualPhone ?? null,
    pet_id: a.petId,
    pet_name: a.pet?.name ?? null,
    pet_species: a.pet?.species ?? null,
    pet_breed: a.pet?.breed ?? null,
    pet_size: a.pet?.size ?? null,
    specialty: a.service?.name ?? null,
    service_id: a.serviceId,
    slot_id: a.slotId ?? null,
    schedule_id: a.scheduleId ?? null,
    scheduled_at: scheduledAt,
    price: a.priceCharged ? Number(a.priceCharged) : null,
    status: a.status,
    notes: a.notes ?? null,
    cancelled_at: a.cancelledAt ?? null,
    cancel_reason: a.cancelReason ?? null,
    created_at: a.createdAt,
  }
}

const appointmentInclude = {
  client: { select: { name: true, phone: true, manualPhone: true } },
  pet: { select: { name: true, species: true, breed: true, size: true } },
  service: { select: { name: true } },
  schedule: { select: { startTime: true, endTime: true } },
  slot: { select: { slotDate: true, slotTime: true } },
}

// GET /appointments
export async function listAppointments(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { status, client_id, pet_id, phone, date_from, date_to } = req.query

    const where: any = { companyId }
    if (status) where.status = status
    if (client_id) {
      const cid = String(client_id).trim()
      if (!isUuidString(cid)) {
        return res.status(400).json({ error: 'client_id deve ser um UUID válido' })
      }
      where.clientId = cid
    }
    if (pet_id) {
      const pid = String(pet_id).trim()
      if (!isUuidString(pid)) {
        return res.status(400).json({ error: 'pet_id deve ser um UUID válido' })
      }
      where.petId = pid
    }
    if (phone) {
      where.client = {
        is: {
          phone: {
            contains: String(phone),
            mode: 'insensitive',
          },
        },
      }
    }
    if (date_from || date_to) {
      where.scheduledDate = {}
      if (date_from) where.scheduledDate.gte = new Date(date_from as string)
      if (date_to) where.scheduledDate.lte = new Date(date_to as string)
    }

    const appointments = await prisma.petshopAppointment.findMany({
      where,
      include: appointmentInclude,
      orderBy: [{ scheduledDate: 'desc' }, { scheduleId: 'asc' }],
    })

    res.json(appointments.map(shapeAppointment))
  } catch (error) {
    console.error('Error listing appointments:', error)
    res.status(500).json({ error: 'Failed to list appointments' })
  }
}

/** Por dia: sem slot / só bloqueado → fechado; há slot livre (não bloqueado + capacidade) → disponível; caso contrário lotado */
type DayAvailabilityStatus = 'closed' | 'full' | 'available'

function statusForDaySlots(
  slots: { maxCapacity: number; usedCapacity: number; isBlocked: boolean }[],
): DayAvailabilityStatus {
  if (slots.length === 0) return 'closed'
  const hasBookable = slots.some(
    (s) => !s.isBlocked && s.maxCapacity - s.usedCapacity > 0,
  )
  if (hasBookable) return 'available'
  const allBlocked = slots.every((s) => s.isBlocked)
  if (allBlocked) return 'closed'
  return 'full'
}

// GET /appointments/available-dates?year=YYYY&month=MM&service_id=&pet_id=
// Com service_id + pet_id e regra G/GG + multiplier: dia só entra como disponível se houver par consecutivo livre na especialidade do serviço.
export async function getAvailableDates(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const year = Number(req.query.year)
    const month = Number(req.query.month) // 1-based

    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: 'year e month são obrigatórios (month = 1-12)' })
    }

    const serviceIdRaw = req.query.service_id
    const petIdRaw = req.query.pet_id ? String(req.query.pet_id) : undefined
    const petId = parseOptionalUuid(petIdRaw)

    let specialtyId: string | undefined
    let needConsecutivePair = false

    if (serviceIdRaw) {
      const service = await prisma.petshopService.findFirst({
        where: { id: Number(serviceIdRaw), companyId },
        select: { specialtyId: true, durationMultiplierLarge: true },
      })
      specialtyId = service?.specialtyId ?? undefined

      if (petId && service) {
        const pet = await prisma.petshopPet.findFirst({
          where: { id: petId, companyId },
          select: { size: true },
        })
        needConsecutivePair = requiresConsecutiveSlotsBooking({
          durationMultiplierLarge: service.durationMultiplierLarge,
          petSize: pet?.size,
        })
      }
    }

    const startDate = new Date(Date.UTC(year, month - 1, 1))
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()

    const slots = await prisma.petshopSlot.findMany({
      where: {
        companyId,
        slotDate: { gte: startDate, lte: endDate },
      },
      select: {
        slotDate: true,
        specialtyId: true,
        slotTime: true,
        maxCapacity: true,
        usedCapacity: true,
        isBlocked: true,
      },
    })

    const byDateKey = new Map<string, SlotRow[]>()
    for (const s of slots) {
      const key = s.slotDate.toISOString().slice(0, 10)
      const list = byDateKey.get(key) ?? []
      list.push(s as SlotRow)
      byDateKey.set(key, list)
    }

    const by_date: Record<string, DayAvailabilityStatus> = {}
    const datesWithAvailability: string[] = []

    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const daySlots = byDateKey.get(dateKey) ?? []
      let status: DayAvailabilityStatus
      if (needConsecutivePair && specialtyId) {
        const specSlots = daySlots.filter((x) => x.specialtyId === specialtyId)
        if (specSlots.length === 0) {
          status = 'closed'
        } else if (dayHasBookableConsecutivePair(daySlots, specialtyId)) {
          status = 'available'
        } else {
          status = 'full'
        }
      } else {
        status = statusForDaySlots(
          daySlots.map((x) => ({
            maxCapacity: x.maxCapacity,
            usedCapacity: x.usedCapacity,
            isBlocked: x.isBlocked,
          })),
        )
      }
      by_date[dateKey] = status
      if (status === 'available') datesWithAvailability.push(dateKey)
    }

    res.json({
      dates: datesWithAvailability,
      by_date,
    })
  } catch (error) {
    console.error('Error getting available dates:', error)
    res.status(500).json({ error: 'Failed to get available dates' })
  }
}

// GET /appointments/available-slots?date=YYYY-MM-DD&service_id=<int>&pet_id=<uuid>
// Reads from petshop_slots (the new capacity-rule-driven slot table).
// service_id is optional but strongly recommended — it narrows results to the
// service's specialty and ensures the right capacity rules are reflected.
// pet_id opcional: com serviço multiplier + G/GG, só horários que abrem par de slots livres.
export async function getAvailableSlots(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const date = String(req.query.date || '')
    const parsed = parseDateWindow(date)

    if (!parsed) {
      return res.status(400).json({ error: 'date deve estar no formato YYYY-MM-DD' })
    }

    const serviceIdRaw = req.query.service_id
    const petIdRaw = req.query.pet_id ? String(req.query.pet_id) : undefined

    const result = await computeAvailableSlotsResponse(
      companyId,
      date,
      serviceIdRaw as string | undefined,
      petIdRaw,
    )

    if ('error' in result) {
      return res.status(400).json({ error: result.error })
    }

    res.json(result)
  } catch (error) {
    console.error('Error getting available slots:', error)
    res.status(500).json({ error: 'Failed to get available slots' })
  }
}

// GET /appointments/:id
export async function getAppointment(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const id = req.params.id!.trim()
    if (!isUuidString(id)) {
      return res.status(400).json({ error: 'id do agendamento deve ser um UUID válido' })
    }

    const appointment = await prisma.petshopAppointment.findUnique({
      where: { id },
      include: appointmentInclude,
    })

    if (!appointment || appointment.companyId !== companyId) {
      return res.status(404).json({ error: 'Appointment not found' })
    }

    res.json(shapeAppointment(appointment))
  } catch (error) {
    console.error('Error getting appointment:', error)
    res.status(500).json({ error: 'Failed to get appointment' })
  }
}

// POST /appointments/schedule
// used_capacity dos slots: atualizado por triggers no banco ao inserir agendamento (sem increment no app).
export async function scheduleAppointment(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const {
      client_id,
      pet_id,
      service_id,
      slot_id,
      scheduled_at,
      notes,
    } = req.body

    if (!client_id || !pet_id || !service_id || !scheduled_at) {
      return res.status(400).json({
        error: 'client_id, pet_id, service_id e scheduled_at são obrigatórios',
      })
    }

    if (!slot_id) {
      return res.status(400).json({ error: 'slot_id é obrigatório' })
    }

    // Preferir a data YYYY-MM-DD explícita no payload (igual ao date picker / slot query);
    // evita deslocamento quando o horário em UTC cruza meia-noite em BRT.
    const scheduledAtStr = String(scheduled_at).trim()
    const datePrefix = scheduledAtStr.match(/^(\d{4}-\d{2}-\d{2})/)
    const scheduled_date = datePrefix
      ? datePrefix[1]!
      : new Date(scheduled_at).toLocaleString('sv-SE', {
          timeZone: 'America/Sao_Paulo',
        }).slice(0, 10)

    const result = await createManualScheduleAppointment(companyId, {
      client_id,
      pet_id,
      service_id: Number(service_id),
      slot_id,
      scheduled_date,
      notes,
    })

    if (!result.ok) {
      const msg = result.message
      const code =
        msg.includes('não encontrado') || msg.includes('não coincide')
          ? 404
          : msg.includes('vagas') || msg.includes('lotado') || msg.includes('bloqueado') || msg.includes('consecutivos')
            ? 409
            : 400
      return res.status(code).json({ error: msg })
    }

    const appointment = await prisma.petshopAppointment.findUniqueOrThrow({
      where: { id: result.appointment_id },
      include: appointmentInclude,
    })

    return res.status(201).json(shapeAppointment(appointment))
  } catch (error) {
    console.error('Error scheduling appointment:', error)
    res.status(500).json({ error: 'Failed to schedule appointment' })
  }
}

// PUT /appointments/:id
export async function updateAppointment(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const id = req.params.id!
    const { status, notes, scheduled_at, schedule_id } = req.body

    const existing = await prisma.petshopAppointment.findUnique({ where: { id } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Appointment not found' })
    }

    const data: any = {}
    if (status !== undefined) data.status = status
    if (notes !== undefined) data.notes = notes
    if (scheduled_at !== undefined) data.scheduledDate = new Date(scheduled_at)
    if (schedule_id !== undefined) data.scheduleId = Number(schedule_id)
    data.updatedAt = new Date()

    const updated = await prisma.petshopAppointment.update({
      where: { id },
      data,
      include: appointmentInclude,
    })

    res.json(shapeAppointment(updated))
  } catch (error) {
    console.error('Error updating appointment:', error)
    res.status(500).json({ error: 'Failed to update appointment' })
  }
}

// DELETE /appointments/:id
// used_capacity: triggers no banco ao cancelar (sem decrement no app)
export async function cancelAppointment(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const id = req.params.id!
    const { cancel_reason } = req.body

    const existing = await prisma.petshopAppointment.findUnique({ where: { id } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Appointment not found' })
    }

    const now = new Date()
    const partnerId = extractDoublePairAppointmentId(existing.notes)

    await prisma.$transaction(async (tx) => {
      await tx.petshopAppointment.update({
        where: { id },
        data: { status: 'cancelled', cancelledAt: now, cancelReason: cancel_reason ?? null, updatedAt: now },
      })

      if (partnerId) {
        const partner = await tx.petshopAppointment.findUnique({
          where: { id: partnerId },
        })
        if (
          partner &&
          partner.companyId === companyId &&
          !['cancelled', 'no_show'].includes(partner.status)
        ) {
          await tx.petshopAppointment.update({
            where: { id: partnerId },
            data: {
              status: 'cancelled',
              cancelledAt: now,
              cancelReason: cancel_reason ?? 'Cancelado em conjunto (dois horários)',
              updatedAt: now,
            },
          })
        }
      }
    })

    res.json({ success: true, appointment_id: id, cancelled_at: now.toISOString() })
  } catch (error) {
    console.error('Error cancelling appointment:', error)
    res.status(500).json({ error: 'Failed to cancel appointment' })
  }
}

// DELETE /appointments/:id/delete
// used_capacity: triggers no banco ao excluir agendamento
export async function deleteAppointment(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const id = req.params.id!

    const existing = await prisma.petshopAppointment.findUnique({ where: { id } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Appointment not found' })
    }

    const partnerId = extractDoublePairAppointmentId(existing.notes)

    await prisma.$transaction(async (tx) => {
      await tx.petshopAppointment.delete({ where: { id } })

      if (partnerId) {
        const partner = await tx.petshopAppointment.findUnique({
          where: { id: partnerId },
        })
        if (partner && partner.companyId === companyId) {
          await tx.petshopAppointment.delete({ where: { id: partnerId } })
        }
      }
    })

    res.json({ success: true, appointment_id: id })
  } catch (error) {
    console.error('Error deleting appointment:', error)
    res.status(500).json({ error: 'Failed to delete appointment' })
  }
}

// POST /appointments/:id/confirm
export async function confirmAppointment(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const id = req.params.id!

    const existing = await prisma.petshopAppointment.findUnique({ where: { id } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Appointment not found' })
    }

    const updated = await prisma.petshopAppointment.update({
      where: { id },
      data: { status: 'confirmed', updatedAt: new Date() },
      include: appointmentInclude,
    })

    res.json(shapeAppointment(updated))
  } catch (error) {
    console.error('Error confirming appointment:', error)
    res.status(500).json({ error: 'Failed to confirm appointment' })
  }
}

// POST /appointments/:id/reschedule
export async function rescheduleAppointment(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const id = req.params.id!
    const { new_scheduled_at, new_schedule_id } = req.body

    if (!new_scheduled_at) {
      return res.status(400).json({ error: 'new_scheduled_at é obrigatório' })
    }

    const existing = await prisma.petshopAppointment.findUnique({ where: { id } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Appointment not found' })
    }

    const data: any = {
      scheduledDate: new Date(new_scheduled_at),
      status: 'pending',
      updatedAt: new Date(),
    }
    if (new_schedule_id) data.scheduleId = Number(new_schedule_id)

    const updated = await prisma.petshopAppointment.update({
      where: { id },
      data,
      include: appointmentInclude,
    })

    res.json(shapeAppointment(updated))
  } catch (error) {
    console.error('Error rescheduling appointment:', error)
    res.status(500).json({ error: 'Failed to reschedule appointment' })
  }
}
