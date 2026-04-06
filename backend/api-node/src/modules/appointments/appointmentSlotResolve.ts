/**
 * Resolve slot_id a partir de data + horário + serviço + pet (grade de capacidade).
 * Usado pelo Second Brain e pela remarcação.
 */
import { computeAvailableSlotsResponse } from './availableSlotsQuery'

export function normalizeHhMm(input: string): string | null {
  const t = input.trim().toLowerCase().replace(/\s+/g, '')
  let h: number
  let min = 0
  const withColon = t.match(/^(\d{1,2}):(\d{2})$/)
  const withH = t.match(/^(\d{1,2})h(\d{2})?$/)
  if (withColon) {
    h = Number.parseInt(withColon[1]!, 10)
    min = Number.parseInt(withColon[2]!, 10)
  } else if (withH) {
    h = Number.parseInt(withH[1]!, 10)
    min = withH[2] ? Number.parseInt(withH[2]!, 10) : 0
  } else if (/^\d{1,2}$/.test(t)) {
    h = Number.parseInt(t, 10)
  } else {
    return null
  }
  if (!Number.isFinite(h) || h < 0 || h > 23 || min < 0 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export async function resolveSlotIdFromDateTimeServicePet(
  companyId: number,
  scheduledDateYmd: string,
  serviceId: number,
  petIdUuid: string | undefined,
  timeRaw: string,
): Promise<string | null> {
  const want = normalizeHhMm(timeRaw)
  if (!want) return null
  const result = await computeAvailableSlotsResponse(companyId, scheduledDateYmd, serviceId, petIdUuid)
  if ('error' in result) return null
  const slot = result.available_slots.find((s) => normalizeHhMm(s.time) === want)
  return slot?.slot_id ?? null
}
