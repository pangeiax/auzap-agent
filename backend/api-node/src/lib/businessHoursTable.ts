import { prisma } from './prisma'

/** Linha de `petshop_business_hours` (nomes alinhados ao SQL raw). */
export type BusinessHourRow = {
  day_of_week: number
  open_time: Date | null
  close_time: Date | null
  is_closed: boolean
}

export const BH_DAY_NAME_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const

export type BusinessHoursClientJson = Record<
  string,
  { open: string; close: string } | { closed: true }
>

function fmtUtcTime(d: Date | null | undefined): string {
  if (!d) return '09:00'
  const dt = new Date(d)
  return `${String(dt.getUTCHours()).padStart(2, '0')}:${String(dt.getUTCMinutes()).padStart(2, '0')}`
}

export async function loadBusinessHourRows(companyId: number): Promise<BusinessHourRow[]> {
  return prisma.$queryRaw<BusinessHourRow[]>`
    SELECT day_of_week, open_time, close_time, is_closed
    FROM petshop_business_hours
    WHERE company_id = ${companyId}
  `
}

/** Map por DOW (0–6) para lookup O(1) em loops grandes. */
export function businessHoursMapFromRows(bhRows: BusinessHourRow[]): Map<number, BusinessHourRow> {
  const m = new Map<number, BusinessHourRow>()
  for (const r of bhRows) m.set(r.day_of_week, r)
  return m
}

export function isDayOpenFromTable(bhRows: BusinessHourRow[], dayOfWeek: number): boolean {
  const bh = bhRows.find((r) => r.day_of_week === dayOfWeek)
  if (!bh) return true
  return !bh.is_closed && bh.open_time != null && bh.close_time != null
}

export function isSlotWithinBusinessHoursFromTable(
  bhRows: BusinessHourRow[],
  dayOfWeek: number,
  slotTime: Date,
): boolean {
  const bh = bhRows.find((r) => r.day_of_week === dayOfWeek)
  if (!bh) return true
  if (bh.is_closed || !bh.open_time || !bh.close_time) return false
  const openMin = bh.open_time.getUTCHours() * 60 + bh.open_time.getUTCMinutes()
  const closeMin = bh.close_time.getUTCHours() * 60 + bh.close_time.getUTCMinutes()
  const slotMin = slotTime.getUTCHours() * 60 + slotTime.getUTCMinutes()
  return slotMin >= openMin && slotMin < closeMin
}

export function isSlotWithinBusinessHoursFromMap(
  bhByDow: Map<number, BusinessHourRow>,
  dayOfWeek: number,
  slotTime: Date,
): boolean {
  const bh = bhByDow.get(dayOfWeek)
  if (!bh) return true
  if (bh.is_closed || !bh.open_time || !bh.close_time) return false
  const openMin = bh.open_time.getUTCHours() * 60 + bh.open_time.getUTCMinutes()
  const closeMin = bh.close_time.getUTCHours() * 60 + bh.close_time.getUTCMinutes()
  const slotMin = slotTime.getUTCHours() * 60 + slotTime.getUTCMinutes()
  return slotMin >= openMin && slotMin < closeMin
}

/**
 * JSON no formato que o frontend já esperava (`businessHours` no petshop).
 * Dia sem linha na tabela → fechado (até configurar na Agenda).
 */
export function businessHoursRowsToClientJson(rows: BusinessHourRow[]): BusinessHoursClientJson {
  const out: BusinessHoursClientJson = {}
  for (let dow = 0; dow < 7; dow++) {
    const key = BH_DAY_NAME_KEYS[dow]!
    const row = rows.find((r) => r.day_of_week === dow)
    if (!row || row.is_closed || !row.open_time || !row.close_time) {
      out[key] = { closed: true as const }
    } else {
      out[key] = { open: fmtUtcTime(row.open_time), close: fmtUtcTime(row.close_time) }
    }
  }
  return out
}

export async function attachBusinessHoursToPetshopJson<T extends { companyId: number }>(
  petshop: T,
): Promise<T & { businessHours: BusinessHoursClientJson }> {
  const rows = await loadBusinessHourRows(petshop.companyId)
  return { ...petshop, businessHours: businessHoursRowsToClientJson(rows) }
}
