import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'

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
  const scheduledAt = a.schedule
    ? toScheduledAt(a.scheduledDate, a.schedule.startTime)
    : new Date(a.scheduledDate).toISOString()

  return {
    id: a.id,
    client_id: a.clientId,
    client_name: a.client?.name ?? null,
    phone_client: a.client?.phone ?? null,
    pet_name: a.pet?.name ?? null,
    pet_species: a.pet?.species ?? null,
    pet_breed: a.pet?.breed ?? null,
    pet_size: a.pet?.size ?? null,
    specialty: a.service?.name ?? null,
    service_id: a.serviceId,
    schedule_id: a.scheduleId,
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
}

// GET /appointments
export async function listAppointments(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { status, client_id, date_from, date_to } = req.query

    const where: any = { companyId }
    if (status) where.status = status
    if (client_id) where.clientId = client_id
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
      schedule_id,
      scheduled_at,
      notes,
      status = 'pending',
    } = req.body

    if (!client_id || !pet_id || !service_id || !scheduled_at) {
      return res.status(400).json({
        error: 'client_id, pet_id, service_id e scheduled_at são obrigatórios',
      })
    }

    const scheduledDate = new Date(scheduled_at)

    // Resolve schedule_id: usa o informado ou encontra o slot mais próximo pelo horário
    let resolvedScheduleId: number = Number(schedule_id)
    if (!schedule_id) {
      const weekday = scheduledDate.getDay() // 0=Dom … 6=Sab
      const hh = scheduledDate.getHours()
      const mm = scheduledDate.getMinutes()

      const slots = await prisma.petshopSchedule.findMany({
        where: { companyId, weekday, isActive: true },
        orderBy: { startTime: 'asc' },
      })

      if (!slots.length) {
        return res.status(400).json({ error: 'Nenhum horário disponível para este dia da semana' })
      }

      // Pega o slot cujo startTime é o mais próximo do horário escolhido
      const target = hh * 60 + mm
      const best = slots.reduce((prev, cur) => {
        const prevMin = new Date(prev.startTime).getHours() * 60 + new Date(prev.startTime).getMinutes()
        const curMin = new Date(cur.startTime).getHours() * 60 + new Date(cur.startTime).getMinutes()
        return Math.abs(curMin - target) < Math.abs(prevMin - target) ? cur : prev
      })
      resolvedScheduleId = best.id
    }

    const service = await prisma.petshopService.findFirst({
      where: { id: Number(service_id), companyId },
    })
    const pet = await prisma.petshopPet.findFirst({
      where: { id: pet_id, companyId },
    })

    let priceCharged: number | null = null
    if (service && pet) {
      const priceBySize = service.priceBySize as Record<string, number> | null
      if (priceBySize && pet.size && priceBySize[pet.size] != null) {
        priceCharged = Number(priceBySize[pet.size])
      } else if (service.price != null) {
        priceCharged = Number(service.price)
      }
    }

    const appointment = await prisma.petshopAppointment.create({
      data: {
        companyId,
        clientId: client_id,
        petId: pet_id,
        serviceId: Number(service_id),
        scheduleId: resolvedScheduleId,
        scheduledDate,
        status,
        notes: notes ?? null,
        priceCharged: priceCharged,
      },
      include: appointmentInclude,
    })

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

    const now = new Date()
    await prisma.petshopAppointment.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancelledAt: now,
        cancelReason: cancel_reason ?? null,
        updatedAt: now,
      },
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
