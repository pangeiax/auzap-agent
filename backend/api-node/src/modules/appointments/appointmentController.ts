import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { isUuidString } from '../../lib/uuidValidation'
import { cancelPetshopAppointment, extractDoublePairPartnerAppointmentId } from './appointmentCancelCore'
import { createManualScheduleAppointment } from './manualScheduleCore'
import { runReminderForClient } from '../../jobs/followUpReminder'

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

function fmtTimeHHMM(t: Date | null | undefined): string | null {
  if (!t) return null
  const h = String(t.getUTCHours()).padStart(2, '0')
  const m = String(t.getUTCMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

function fmtDateYMD(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function shapeAppointment(a: any) {
  // Resolver start_time: preferir campo direto, fallback para schedule/slot
  const startTime: string | null =
    fmtTimeHHMM(a.startTime) ??
    fmtTimeHHMM(a.schedule?.startTime) ??
    fmtTimeHHMM(a.slot?.slotTime) ??
    null

  const endTime: string | null =
    fmtTimeHHMM(a.endTime) ??
    fmtTimeHHMM(a.schedule?.endTime) ??
    null

  // Resolver scheduled_date como YYYY-MM-DD
  const scheduledDate: string | null = a.scheduledDate
    ? fmtDateYMD(new Date(a.scheduledDate))
    : a.slot?.slotDate
      ? fmtDateYMD(new Date(a.slot.slotDate))
      : null

  // scheduled_at com offset BRT (-03:00) para display correto
  let scheduledAt: string
  if (scheduledDate && startTime) {
    scheduledAt = `${scheduledDate}T${startTime}:00-03:00`
  } else if (scheduledDate) {
    scheduledAt = `${scheduledDate}T00:00:00-03:00`
  } else {
    scheduledAt = a.createdAt ? new Date(a.createdAt).toISOString() : new Date().toISOString()
  }

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
    scheduled_date: scheduledDate,
    start_time: startTime,
    end_time: endTime,
    price: a.priceCharged ? Number(a.priceCharged) : null,
    status: a.status,
    notes: a.notes ?? null,
    cancelled_at: a.cancelledAt ?? null,
    cancel_reason: a.cancelReason ?? null,
    created_at: a.createdAt,
    staff_id: a.staffId ?? null,
    staff_name: a.staff?.name ?? null,
  }
}

const appointmentInclude = {
  client: { select: { name: true, phone: true, manualPhone: true } },
  pet: { select: { name: true, species: true, breed: true, size: true } },
  service: { select: { name: true } },
  schedule: { select: { startTime: true, endTime: true } },
  slot: { select: { slotDate: true, slotTime: true } },
  staff: { select: { name: true } },
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
      staff_id,
      start_time,
      end_time,
      scheduled_at,
      notes,
      status,
    } = req.body

    if (!client_id || !pet_id || !service_id || !scheduled_at) {
      return res.status(400).json({
        error: 'client_id, pet_id, service_id e scheduled_at são obrigatórios',
      })
    }

    // Extrair a data YYYY-MM-DD do scheduled_at
    const scheduledAtStr = String(scheduled_at).trim()
    const datePrefix = scheduledAtStr.match(/^(\d{4}-\d{2}-\d{2})/)
    const scheduled_date = datePrefix
      ? datePrefix[1]!
      : new Date(scheduled_at).toLocaleString('sv-SE', {
          timeZone: 'America/Sao_Paulo',
        }).slice(0, 10)

    // ── Caminho staff-based ──────────────────────────────────────
    if (staff_id && start_time && end_time) {
      const [service, pet, staff] = await Promise.all([
        prisma.petshopService.findFirst({ where: { id: Number(service_id), companyId } }),
        prisma.petshopPet.findFirst({ where: { id: String(pet_id), companyId } }),
        prisma.petshopStaff.findFirst({ where: { id: String(staff_id), companyId, isActive: true } }),
      ])

      if (!service) return res.status(404).json({ error: 'Serviço não encontrado.' })
      if (!pet) return res.status(404).json({ error: 'Pet não encontrado.' })
      if (!staff) return res.status(404).json({ error: 'Profissional não encontrado.' })

      let priceCharged: number | null = null
      const priceBySize = service.priceBySize as Record<string, number> | null
      if (priceBySize && pet.size && priceBySize[pet.size] != null) {
        priceCharged = Number(priceBySize[pet.size])
      } else if (service.price != null) {
        priceCharged = Number(service.price)
      }

      const scheduledDate = new Date(scheduled_date + 'T12:00:00Z')

      const appointment = await prisma.petshopAppointment.create({
        data: {
          companyId,
          clientId: String(client_id),
          petId: String(pet_id),
          serviceId: Number(service_id),
          staffId: String(staff_id),
          startTime: new Date(`1970-01-01T${start_time}:00`),
          endTime: new Date(`1970-01-01T${end_time}:00`),
          scheduledDate,
          status: status || 'pending',
          notes: notes ?? null,
          priceCharged,
          source: 'manual',
          confirmed: false,
        },
        include: appointmentInclude,
      })

      return res.status(201).json(shapeAppointment(appointment))
    }

    // ── Caminho legado (slot_id) ──────────────────────────────────
    if (!slot_id) {
      return res.status(400).json({ error: 'slot_id ou (staff_id + start_time + end_time) são obrigatórios' })
    }

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

    const result = await cancelPetshopAppointment(companyId, id, cancel_reason ?? null)
    if (!result.ok) {
      return res.status(404).json({ error: result.message })
    }

    res.json({ success: true, appointment_id: result.appointment_id, cancelled_at: result.cancelled_at })
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

    const partnerId = extractDoublePairPartnerAppointmentId(existing.notes)

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

// GET /appointments/available-dates?year=2026&month=4
// Retorna quais dias do mês estão abertos/fechados/lotados baseado em business hours + staff
export async function getAvailableDates(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const year = Number(req.query.year)
    const month = Number(req.query.month) // 1-based

    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: 'year e month são obrigatórios (month 1-12)' })
    }

    // Buscar business hours para todos os dias da semana
    type BhRow = { day_of_week: number; open_time: Date | null; close_time: Date | null; is_closed: boolean }
    const bhRows = await prisma.$queryRaw<BhRow[]>`
      SELECT day_of_week, open_time, close_time, is_closed
      FROM petshop_business_hours
      WHERE company_id = ${companyId}
    `
    const bhByDow = new Map<number, BhRow>()
    for (const bh of bhRows) bhByDow.set(bh.day_of_week, bh)

    // Buscar staff ativo
    const activeStaff = await prisma.petshopStaff.findMany({
      where: { companyId, isActive: true },
      select: { daysOfWeek: true },
    })

    // Dias do mês
    const daysInMonth = new Date(year, month, 0).getDate()
    const dates: string[] = []
    const byDate: Record<string, 'closed' | 'full' | 'available'> = {}

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month - 1, day)
      const dow = d.getDay() // 0=dom..6=sab
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

      const bh = bhByDow.get(dow)

      // Se business hours marca como fechado
      if (bh?.is_closed || (bh && !bh.open_time)) {
        byDate[dateStr] = 'closed'
        continue
      }

      // Se não há business hours configurado para este dia, considerar fechado
      if (!bh) {
        byDate[dateStr] = 'closed'
        continue
      }

      // Verificar se algum staff trabalha neste dia da semana
      const hasStaff = activeStaff.some(s => s.daysOfWeek.includes(dow))
      if (!hasStaff) {
        byDate[dateStr] = 'closed'
        continue
      }

      // Dia está aberto e tem staff
      dates.push(dateStr)
      byDate[dateStr] = 'available'
    }

    res.json({ dates, by_date: byDate })
  } catch (error) {
    console.error('Error getting available dates:', error)
    res.status(500).json({ error: 'Failed to get available dates' })
  }
}

// ─── POST /appointments/send-reminders ─────────────────────────
// Dispara follow-up de lembrete para agendamentos de amanhã de um cliente específico.
// Body: { clientId: string }
export async function sendReminders(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { clientId } = req.body
    if (!clientId) {
      return res.status(400).json({ error: 'clientId é obrigatório' })
    }
    const result = await runReminderForClient(companyId, clientId)
    res.json(result)
  } catch (error: any) {
    console.error('[sendReminders] Erro:', error)
    res.status(500).json({ error: error?.message || 'Erro ao enviar lembretes' })
  }
}
