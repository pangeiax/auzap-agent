/**
 * Remarcação na grade (slot) para agendamentos manuais — um slot por agendamento.
 * Não cobre par de dois horários (G/GG + multiplicador): nesses casos cancele e recrie ou use o painel.
 */
import { prisma } from '../../lib/prisma'
import { isUuidString } from '../../lib/uuidValidation'
import { extractDoublePairPartnerAppointmentId } from './appointmentCancelCore'
import { requiresConsecutiveSlotsBooking } from './availableSlotsQuery'
import { resolveSlotIdFromDateTimeServicePet } from './appointmentSlotResolve'
import { petAppointmentConflictSameSlot } from './manualScheduleCore'

export type RescheduleManualAppointmentResult =
  | { ok: true; appointment_id: string; scheduled_date: string }
  | { ok: false; message: string }

export async function rescheduleManualAppointment(
  companyId: number,
  input: {
    appointment_id: string
    new_slot_id?: string | null
    new_scheduled_date?: string | null
    new_time?: string | null
  },
): Promise<RescheduleManualAppointmentResult> {
  const id = input.appointment_id.trim()
  if (!isUuidString(id)) {
    return { ok: false, message: 'appointment_id deve ser um UUID válido.' }
  }

  const appt = await prisma.petshopAppointment.findFirst({
    where: { id, companyId },
    include: {
      pet: { select: { id: true, size: true } },
      service: { select: { id: true, durationMultiplierLarge: true } },
      slot: { select: { id: true, slotDate: true, slotTime: true } },
    },
  })

  if (!appt) {
    return { ok: false, message: 'Agendamento não encontrado.' }
  }
  if (appt.status === 'cancelled' || appt.status === 'no_show') {
    return { ok: false, message: 'Agendamento já cancelado ou sem comparecimento.' }
  }

  const partnerId = extractDoublePairPartnerAppointmentId(appt.notes)
  if (partnerId) {
    const partner = await prisma.petshopAppointment.findFirst({
      where: { id: partnerId, companyId },
      select: { id: true, status: true },
    })
    if (partner && !['cancelled', 'no_show', 'completed'].includes(partner.status)) {
      return {
        ok: false,
        message:
          'Agendamento ligado a dois horários (pet G/GG). Use cancel_appointment (cancela o par) e create_manual_appointments_batch, ou remarque pelo painel.',
      }
    }
  }

  if (
    requiresConsecutiveSlotsBooking({
      durationMultiplierLarge: appt.service?.durationMultiplierLarge,
      petSize: appt.pet?.size,
    })
  ) {
    return {
      ok: false,
      message:
        'Este serviço exige dois horários seguidos para o porte do pet. Cancele e recrie com a grade ou use o painel.',
    }
  }

  let newSlotId = (input.new_slot_id ?? '').trim()
  const nd = (input.new_scheduled_date ?? '').trim()
  const nt = (input.new_time ?? '').trim()

  if (!isUuidString(newSlotId)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nd) || !nt) {
      return {
        ok: false,
        message: 'Informe new_slot_id (UUID da grade) ou new_scheduled_date (YYYY-MM-DD) + new_time (HH:MM).',
      }
    }
    const resolved = await resolveSlotIdFromDateTimeServicePet(
      companyId,
      nd,
      appt.serviceId,
      appt.petId,
      nt,
    )
    if (!resolved) {
      return { ok: false, message: 'Não há horário livre na grade para essa data/serviço/pet.' }
    }
    newSlotId = resolved
  }

  const newSlot = await prisma.petshopSlot.findUnique({ where: { id: newSlotId } })
  if (!newSlot || newSlot.companyId !== companyId) {
    return { ok: false, message: 'Novo horário (slot) não encontrado.' }
  }
  if (newSlot.maxCapacity - newSlot.usedCapacity <= 0) {
    return { ok: false, message: 'Novo horário sem vagas disponíveis.' }
  }

  const slotKey = newSlot.slotDate.toISOString().slice(0, 10)

  if (appt.slotId === newSlotId) {
    return { ok: true, appointment_id: id, scheduled_date: slotKey }
  }

  const conflict = await petAppointmentConflictSameSlot(
    companyId,
    appt.petId,
    newSlot.slotDate,
    newSlot.slotTime,
    [id],
  )
  if (conflict) {
    return { ok: false, message: `O pet já tem «${conflict}» neste horário.` }
  }

  try {
    await prisma.petshopAppointment.update({
      where: { id },
      data: {
        slotId: newSlotId,
        scheduledDate: newSlot.slotDate,
        status: 'pending',
        updatedAt: new Date(),
      },
    })
    return { ok: true, appointment_id: id, scheduled_date: slotKey }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: msg || 'Falha ao remarcar.' }
  }
}
