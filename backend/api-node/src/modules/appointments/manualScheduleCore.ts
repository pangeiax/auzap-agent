/**
 * Criação de agendamento manual (mesma regra que POST /appointments/schedule), reutilizada pelo segundo cérebro.
 */
import { prisma } from '../../lib/prisma'
import { isUuidString } from '../../lib/uuidValidation'
import {
  findNextSlotInOrderedDay,
  orderedSlotsSameDaySpecialty,
  requiresConsecutiveSlotsBooking,
  type SlotRow,
} from './availableSlotsQuery'

const DOUBLE_PAIR_PREFIX = '__DOUBLE_PAIR__:'

function mergeNotesWithDoublePair(
  userNotes: string | null | undefined,
  partnerAppointmentId: string,
): string {
  const u = (userNotes ?? '').trim()
  const line = `${DOUBLE_PAIR_PREFIX}${partnerAppointmentId}`
  return u ? `${u}\n${line}` : line
}

const appointmentInclude = {
  client: { select: { name: true, phone: true, manualPhone: true } },
  pet: { select: { name: true, species: true, breed: true, size: true } },
  service: { select: { name: true } },
  schedule: { select: { startTime: true, endTime: true } },
  slot: { select: { slotDate: true, slotTime: true } },
}

function slotDateKeyBR(slotDate: Date): string {
  return slotDate.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10)
}

/** Mesmo cliente não pode ter dois atendimentos ativos com início no mesmo slot (data+hora da grade). */
async function clientAppointmentConflictSameSlot(
  companyId: number,
  clientId: string,
  slotDate: Date,
  slotTime: Date,
): Promise<string | null> {
  const existing = await prisma.petshopAppointment.findFirst({
    where: {
      companyId,
      clientId,
      status: { notIn: ['completed', 'cancelled'] },
      slotId: { not: null },
      slot: { slotDate, slotTime },
    },
    select: { service: { select: { name: true } } },
  })
  if (!existing) return null
  const n = existing.service?.name?.trim()
  return n || 'Serviço'
}

export type ManualScheduleInput = {
  client_id: string
  pet_id: string
  service_id: number
  slot_id: string
  scheduled_date: string
  notes?: string | null
}

export type ManualScheduleResult =
  | { ok: true; appointment_id: string; scheduled_date: string }
  | { ok: false; message: string }

export async function createManualScheduleAppointment(
  companyId: number,
  input: ManualScheduleInput,
): Promise<ManualScheduleResult> {
  const { client_id, pet_id, service_id, slot_id, scheduled_date, notes } = input

  const cid = String(client_id).trim()
  const pid = String(pet_id).trim()
  const sid = String(slot_id).trim()
  if (!isUuidString(cid)) {
    return {
      ok: false,
      message:
        'client_id deve ser um UUID válido (use search_clients e copie o campo id do cliente).',
    }
  }
  if (!isUuidString(pid)) {
    return {
      ok: false,
      message:
        'pet_id deve ser um UUID válido (use get_client_pets_for_scheduling e copie o id do pet, não o nome).',
    }
  }
  if (!isUuidString(sid)) {
    return {
      ok: false,
      message:
        'slot_id deve ser um UUID válido (copie o campo slot_id retornado em get_available_times).',
    }
  }

  const [service, pet] = await Promise.all([
    prisma.petshopService.findFirst({
      where: { id: Number(service_id), companyId },
    }),
    prisma.petshopPet.findFirst({ where: { id: pid, companyId } }),
  ])

  if (!service) return { ok: false, message: 'Serviço não encontrado.' }
  if (!pet) return { ok: false, message: 'Pet não encontrado.' }

  const slot = await prisma.petshopSlot.findUnique({ where: { id: sid } })
  if (!slot || slot.companyId !== companyId) {
    return { ok: false, message: 'Horário (slot) não encontrado.' }
  }
  if (slot.maxCapacity - slot.usedCapacity <= 0) {
    return { ok: false, message: 'Horário sem vagas disponíveis.' }
  }

  const conflictPrimary = await clientAppointmentConflictSameSlot(
    companyId,
    cid,
    slot.slotDate,
    slot.slotTime,
  )
  if (conflictPrimary) {
    return {
      ok: false,
      message: `Já existe agendamento de «${conflictPrimary}» neste mesmo horário para este cliente. Cancele ou remarque antes de marcar outro serviço no mesmo horário.`,
    }
  }

  const slotKey = slotDateKeyBR(slot.slotDate)
  if (scheduled_date && scheduled_date !== slotKey) {
    return {
      ok: false,
      message: `A data informada (${scheduled_date}) não coincide com a data do horário escolhido (${slotKey}).`,
    }
  }

  const scheduledDate = slot.slotDate

  const needDouble = requiresConsecutiveSlotsBooking({
    durationMultiplierLarge: service.durationMultiplierLarge,
    petSize: pet.size,
  })

  let secondSlot: typeof slot | null = null
  if (needDouble) {
    const daySlots = await prisma.petshopSlot.findMany({
      where: {
        companyId,
        slotDate: slot.slotDate,
        specialtyId: slot.specialtyId,
      },
      orderBy: { slotTime: 'asc' },
    })
    const ordered = orderedSlotsSameDaySpecialty(daySlots as SlotRow[])
    secondSlot = findNextSlotInOrderedDay(ordered, sid) as typeof slot | null
    if (!secondSlot) {
      return {
        ok: false,
        message:
          'Este serviço exige dois horários consecutivos para pets G/GG; não há segundo horário disponível após o selecionado.',
      }
    }
    if (secondSlot.isBlocked) {
      return {
        ok: false,
        message: 'O horário seguinte está bloqueado; escolha outro início de horário para pets G/GG.',
      }
    }
    if (secondSlot.maxCapacity - secondSlot.usedCapacity <= 0) {
      return {
        ok: false,
        message: 'O horário seguinte está lotado; escolha outro início de horário para pets G/GG.',
      }
    }

    const conflictSecond = await clientAppointmentConflictSameSlot(
      companyId,
      cid,
      secondSlot.slotDate,
      secondSlot.slotTime,
    )
    if (conflictSecond) {
      return {
        ok: false,
        message: `No horário do segundo bloco já existe «${conflictSecond}» para este cliente. Escolha outro início ou ajuste o agendamento existente.`,
      }
    }
  }

  let priceCharged: number | null = null
  const priceBySize = service.priceBySize as Record<string, number> | null
  if (priceBySize && pet.size && priceBySize[pet.size] != null) {
    priceCharged = Number(priceBySize[pet.size])
  } else if (service.price != null) {
    priceCharged = Number(service.price)
  }

  const status = 'pending'

  try {
    if (!needDouble) {
      const appointment = await prisma.petshopAppointment.create({
        data: {
          companyId,
          clientId: cid,
          petId: pid,
          serviceId: Number(service_id),
          slotId: sid,
          scheduledDate,
          status,
          notes: notes ?? null,
          priceCharged,
          source: 'manual',
          confirmed: false,
        },
      })
      return { ok: true, appointment_id: appointment.id, scheduled_date: slotKey }
    }

    const appointmentPrimary = await prisma.$transaction(
      async (tx) => {
        const primary = await tx.petshopAppointment.create({
          data: {
            companyId,
            clientId: cid,
            petId: pid,
            serviceId: Number(service_id),
            slotId: sid,
            scheduledDate,
            status,
            notes: notes ?? null,
            priceCharged,
            source: 'manual',
            confirmed: false,
          },
          select: { id: true },
        })

        const secondary = await tx.petshopAppointment.create({
          data: {
            companyId,
            clientId: cid,
            petId: pid,
            serviceId: Number(service_id),
            slotId: secondSlot!.id,
            scheduledDate,
            status,
            notes: mergeNotesWithDoublePair(notes, primary.id),
            priceCharged,
            source: 'manual',
            confirmed: false,
          },
          select: { id: true },
        })

        await tx.petshopAppointment.update({
          where: { id: primary.id },
          data: { notes: mergeNotesWithDoublePair(notes, secondary.id) },
        })

        return tx.petshopAppointment.findUniqueOrThrow({
          where: { id: primary.id },
          include: appointmentInclude,
        })
      },
      { maxWait: 10_000, timeout: 20_000 },
    )

    return {
      ok: true,
      appointment_id: appointmentPrimary.id,
      scheduled_date: slotKey,
    }
  } catch (e: any) {
    return { ok: false, message: e?.message ? String(e.message) : 'Erro ao criar agendamento.' }
  }
}
