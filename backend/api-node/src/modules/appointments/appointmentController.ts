import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'

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
  client: { select: { name: true, phone: true } },
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
    if (client_id) where.clientId = client_id
    if (pet_id) where.petId = pet_id
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

// GET /appointments/available-dates?year=YYYY&month=MM
// Returns an array of dates (YYYY-MM-DD) in the given month that have at least one available slot.
export async function getAvailableDates(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const year = Number(req.query.year)
    const month = Number(req.query.month) // 1-based

    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: 'year e month são obrigatórios (month = 1-12)' })
    }

    const startDate = new Date(Date.UTC(year, month - 1, 1))
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

    const slots = await prisma.petshopSlot.findMany({
      where: {
        companyId,
        slotDate: { gte: startDate, lte: endDate },
      },
      select: { slotDate: true, maxCapacity: true, usedCapacity: true },
    })

    const datesSet = new Set<string>()
    for (const s of slots) {
      if (s.maxCapacity - s.usedCapacity > 0) {
        datesSet.add(s.slotDate.toISOString().slice(0, 10))
      }
    }

    res.json({ dates: [...datesSet].sort() })
  } catch (error) {
    console.error('Error getting available dates:', error)
    res.status(500).json({ error: 'Failed to get available dates' })
  }
}

// GET /appointments/available-slots?date=YYYY-MM-DD&service_id=<int>
// Reads from petshop_slots (the new capacity-rule-driven slot table).
// service_id is optional but strongly recommended — it narrows results to the
// service's specialty and ensures the right capacity rules are reflected.
export async function getAvailableSlots(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const date = String(req.query.date || '')
    const parsed = parseDateWindow(date)

    if (!parsed) {
      return res.status(400).json({ error: 'date deve estar no formato YYYY-MM-DD' })
    }

    const [year, month, day] = date.split('-').map(Number)
    const slotDate = new Date(Date.UTC(year!, month! - 1, day!))

    // Optionally filter by specialty from the chosen service
    let specialtyId: string | undefined
    const serviceIdRaw = req.query.service_id
    if (serviceIdRaw) {
      const service = await prisma.petshopService.findFirst({
        where: { id: Number(serviceIdRaw), companyId },
        select: { specialtyId: true },
      })
      specialtyId = service?.specialtyId ?? undefined
    }

    const slots = await prisma.petshopSlot.findMany({
      where: {
        companyId,
        slotDate,
        ...(specialtyId ? { specialtyId } : {}),
      },
      orderBy: { slotTime: 'asc' },
    })

    const availableSlots = slots
      .filter((slot) => slot.maxCapacity - slot.usedCapacity > 0)
      .map((slot) => ({
        slot_id: slot.id,
        specialty_id: slot.specialtyId,
        time: formatTimeLabel(slot.slotTime),
        capacity: slot.maxCapacity,
        remaining_capacity: slot.maxCapacity - slot.usedCapacity,
      }))

    res.json({
      date,
      available_slots: availableSlots,
      total_available: availableSlots.length,
    })
  } catch (error) {
    console.error('Error getting available slots:', error)
    res.status(500).json({ error: 'Failed to get available slots' })
  }
}

// GET /appointments/:id
export async function getAppointment(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const id = req.params.id!

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
      status = 'pending',
    } = req.body

    if (!client_id || !pet_id || !service_id || !scheduled_at) {
      return res.status(400).json({
        error: 'client_id, pet_id, service_id e scheduled_at são obrigatórios',
      })
    }

    // Validate slot and check remaining capacity
    if (!slot_id) {
      return res.status(400).json({ error: 'slot_id é obrigatório' })
    }

    const slot = await prisma.petshopSlot.findUnique({ where: { id: slot_id } })
    if (!slot || slot.companyId !== companyId) {
      return res.status(404).json({ error: 'Horário não encontrado' })
    }
    if (slot.maxCapacity - slot.usedCapacity <= 0) {
      return res.status(409).json({ error: 'Horário sem vagas disponíveis' })
    }

    const scheduledDate = new Date(scheduled_at)

    const [service, pet] = await Promise.all([
      prisma.petshopService.findFirst({ where: { id: Number(service_id), companyId } }),
      prisma.petshopPet.findFirst({ where: { id: pet_id, companyId } }),
    ])

    let priceCharged: number | null = null
    if (service && pet) {
      const priceBySize = service.priceBySize as Record<string, number> | null
      if (priceBySize && pet.size && priceBySize[pet.size] != null) {
        priceCharged = Number(priceBySize[pet.size])
      } else if (service.price != null) {
        priceCharged = Number(service.price)
      }
    }

    // Create appointment and increment usedCapacity atomically
    const [appointment] = await prisma.$transaction([
      prisma.petshopAppointment.create({
        data: {
          companyId,
          clientId: client_id,
          petId: pet_id,
          serviceId: Number(service_id),
          slotId: slot_id,
          scheduledDate,
          status,
          notes: notes ?? null,
          priceCharged,
        },
        include: appointmentInclude,
      }),
      prisma.petshopSlot.update({
        where: { id: slot_id },
        data: { usedCapacity: { increment: 1 } },
      }),
    ])

    res.status(201).json(shapeAppointment(appointment))
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
export async function cancelAppointment(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const id = req.params.id!
    const { cancel_reason } = req.body

    const existing = await prisma.petshopAppointment.findUnique({ where: { id } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Appointment not found' })
    }

    // Only decrement if it was an active appointment that held a slot
    const wasActive = !['cancelled', 'no_show'].includes(existing.status)

    const now = new Date()

    await prisma.$transaction(async (tx) => {
      await tx.petshopAppointment.update({
        where: { id },
        data: { status: 'cancelled', cancelledAt: now, cancelReason: cancel_reason ?? null, updatedAt: now },
      })

      if (wasActive && existing.slotId) {
        await tx.petshopSlot.update({
          where: { id: existing.slotId },
          data: { usedCapacity: { decrement: 1 } },
        })
      }
    })

    res.json({ success: true, appointment_id: id, cancelled_at: now.toISOString() })
  } catch (error) {
    console.error('Error cancelling appointment:', error)
    res.status(500).json({ error: 'Failed to cancel appointment' })
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
