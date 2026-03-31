/**
 * Lógica compartilhada de slots livres (GET /appointments/available-slots e tool get_available_times do brain).
 * Não altera schema nem contrato HTTP do endpoint existente.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { parseOptionalUuid } from '../../lib/uuidValidation'

function petSizeNeedsLargeDurationMultiplier(size: string | null | undefined): boolean {
  const s = (size ?? '').trim().toUpperCase()
  return s === 'G' || s === 'GG'
}

function serviceUsesDurationMultiplierLarge(multiplier: Prisma.Decimal | null | undefined): boolean {
  if (multiplier == null) return false
  return Number(multiplier) > 1
}

export function requiresConsecutiveSlotsBooking(args: {
  durationMultiplierLarge: Prisma.Decimal | null | undefined
  petSize: string | null | undefined
}): boolean {
  return (
    serviceUsesDurationMultiplierLarge(args.durationMultiplierLarge) &&
    petSizeNeedsLargeDurationMultiplier(args.petSize)
  )
}

export type SlotRow = {
  id: string
  specialtyId: string
  slotDate: Date
  slotTime: Date
  maxCapacity: number
  usedCapacity: number
  isBlocked: boolean
}

export function orderedSlotsSameDaySpecialty(slots: SlotRow[]): SlotRow[] {
  return [...slots].sort((a, b) => a.slotTime.getTime() - b.slotTime.getTime())
}

export function findNextSlotInOrderedDay(ordered: SlotRow[], currentId: string): SlotRow | null {
  const idx = ordered.findIndex((s) => s.id === currentId)
  if (idx < 0 || idx >= ordered.length - 1) return null
  return ordered[idx + 1] ?? null
}

function formatTimeLabel(time: Date): string {
  return `${String(time.getUTCHours()).padStart(2, '0')}:${String(time.getUTCMinutes()).padStart(2, '0')}`
}

export type AvailableSlotItem = {
  slot_id: string
  specialty_id: string
  time: string
  capacity: number
  remaining_capacity: number
  uses_consecutive_slots?: true
  paired_slot_time?: string
}

export async function computeAvailableSlotsResponse(
  companyId: number,
  date: string,
  serviceIdRaw?: string | number | undefined,
  petIdRaw?: string | undefined,
): Promise<{ date: string; available_slots: AvailableSlotItem[]; total_available: number } | { error: string }> {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return { error: 'date deve estar no formato YYYY-MM-DD' }

  const slotDate = new Date(Date.UTC(year, month - 1, day!))

  let specialtyId: string | undefined
  let needConsecutivePair = false

  if (serviceIdRaw !== undefined && serviceIdRaw !== null && serviceIdRaw !== '') {
    const service = await prisma.petshopService.findFirst({
      where: { id: Number(serviceIdRaw), companyId },
      select: { specialtyId: true, durationMultiplierLarge: true },
    })
    specialtyId = service?.specialtyId ?? undefined

    const petId = parseOptionalUuid(petIdRaw)
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

  const whereClause: Prisma.PetshopSlotWhereInput = {
    companyId,
    slotDate,
    ...(specialtyId ? { specialtyId } : {}),
  }

  const allDaySlots = await prisma.petshopSlot.findMany({
    where: whereClause,
    orderBy: { slotTime: 'asc' },
  })

  const ordered = orderedSlotsSameDaySpecialty(allDaySlots as SlotRow[])

  const bookableIds = new Set(
    ordered.filter((s) => !s.isBlocked && s.maxCapacity - s.usedCapacity > 0).map((s) => s.id),
  )

  let candidateStarters = ordered.filter((s) => bookableIds.has(s.id))

  if (needConsecutivePair && specialtyId) {
    candidateStarters = candidateStarters.filter((slot) => {
      const next = findNextSlotInOrderedDay(ordered, slot.id)
      if (!next) return false
      if (next.isBlocked) return false
      if (next.maxCapacity - next.usedCapacity <= 0) return false
      return true
    })
  }

  const availableSlots: AvailableSlotItem[] = candidateStarters.map((slot) => {
    const next =
      needConsecutivePair && specialtyId ? findNextSlotInOrderedDay(ordered, slot.id) : null
    const remFirst = slot.maxCapacity - slot.usedCapacity
    const remSecond = next ? next.maxCapacity - next.usedCapacity : remFirst
    return {
      slot_id: slot.id,
      specialty_id: slot.specialtyId,
      time: formatTimeLabel(slot.slotTime),
      capacity: slot.maxCapacity,
      remaining_capacity: next != null ? Math.min(remFirst, remSecond) : remFirst,
      ...(next
        ? {
            uses_consecutive_slots: true as const,
            paired_slot_time: formatTimeLabel(next.slotTime),
          }
        : {}),
    }
  })

  return {
    date,
    available_slots: availableSlots,
    total_available: availableSlots.length,
  }
}
