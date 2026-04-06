/**
 * Cancelamento de agendamento (reutilizado pelo REST e pelas tools do Second Brain).
 */
import { prisma } from '../../lib/prisma'
import { isUuidString } from '../../lib/uuidValidation'

const DOUBLE_PAIR_PREFIX = '__DOUBLE_PAIR__:'

/** Par de agendamentos consecutivos (G/GG): id do outro registro nas notes. */
export function extractDoublePairPartnerAppointmentId(notes: string | null | undefined): string | null {
  if (!notes) return null
  const idx = notes.indexOf(DOUBLE_PAIR_PREFIX)
  if (idx < 0) return null
  const rest = notes.slice(idx + DOUBLE_PAIR_PREFIX.length).trim()
  const m = rest.match(
    /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
  )
  return m?.[1] ?? null
}

export type CancelPetshopAppointmentResult =
  | { ok: true; appointment_id: string; cancelled_at: string }
  | { ok: false; message: string }

export async function cancelPetshopAppointment(
  companyId: number,
  appointmentIdRaw: string,
  cancelReason?: string | null,
): Promise<CancelPetshopAppointmentResult> {
  const id = appointmentIdRaw.trim()
  if (!isUuidString(id)) {
    return { ok: false, message: 'appointment_id deve ser um UUID válido.' }
  }

  const existing = await prisma.petshopAppointment.findUnique({ where: { id } })
  if (!existing || existing.companyId !== companyId) {
    return { ok: false, message: 'Agendamento não encontrado.' }
  }

  if (existing.status === 'cancelled' || existing.status === 'no_show') {
    return { ok: false, message: 'Este agendamento já está encerrado ou cancelado.' }
  }

  const now = new Date()
  const partnerId = extractDoublePairPartnerAppointmentId(existing.notes)

  await prisma.$transaction(async (tx) => {
    await tx.petshopAppointment.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancelledAt: now,
        cancelReason: cancelReason ?? null,
        updatedAt: now,
      },
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
            cancelReason: cancelReason ?? 'Cancelado em conjunto (dois horários)',
            updatedAt: now,
          },
        })
      }
    }
  })

  return { ok: true, appointment_id: id, cancelled_at: now.toISOString() }
}
