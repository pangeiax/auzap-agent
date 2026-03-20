/** Mesmo prefixo usado no backend ao criar par de agendamentos (G/GG + multiplier). */
export const DOUBLE_PAIR_PREFIX = "__DOUBLE_PAIR__:";

export function extractPairedAppointmentId(
  notes?: string | null,
): string | null {
  if (!notes) return null;
  const idx = notes.indexOf(DOUBLE_PAIR_PREFIX);
  if (idx < 0) return null;
  const rest = notes.slice(idx + DOUBLE_PAIR_PREFIX.length).trim();
  const m = rest.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  return m?.[1] ?? null;
}

export type PairableByTime = {
  id: string;
  time: string;
  pairedAppointmentId?: string;
};

/** Une dois registros do par em um item (horário inicial + timeEnd). */
export function mergePairedByTime<T extends PairableByTime>(
  list: T[],
  combine: (first: T, second: T) => T,
): T[] {
  const byId = new Map(list.map((e) => [e.id, e]));
  const consumed = new Set<string>();
  const out: T[] = [];
  for (const e of list) {
    if (consumed.has(e.id)) continue;
    const pid = e.pairedAppointmentId;
    if (!pid) {
      out.push(e);
      continue;
    }
    const partner = byId.get(pid);
    if (!partner || partner.pairedAppointmentId !== e.id) {
      out.push(e);
      continue;
    }
    consumed.add(e.id);
    consumed.add(partner.id);
    const [first, second] =
      e.time <= partner.time ? [e, partner] : [partner, e];
    out.push(combine(first, second));
  }
  return out;
}

/** Lista bruta da API: retorna os dois IDs do par quando as notas referenciam um ao outro. */
export function resolveSymmetricPairIds(
  raw: { id: string; pairedAppointmentId?: string }[],
  eventId: string,
): string[] {
  const byId = new Map(raw.map((e) => [e.id, e]));
  const e = byId.get(eventId);
  if (!e) return [eventId];
  const pid = e.pairedAppointmentId;
  if (!pid) return [eventId];
  const p = byId.get(pid);
  if (p?.pairedAppointmentId === e.id) return [e.id, p.id];
  return [eventId];
}

/** Linha já mesclada na UI: um card com timeEnd + pairedAppointmentId do segundo slot. */
export function idsForMergedDisplayRow(row: {
  id: string;
  pairedAppointmentId?: string;
  timeEnd?: string;
}): string[] {
  if (row.timeEnd && row.pairedAppointmentId) {
    return [row.id, row.pairedAppointmentId];
  }
  return [row.id];
}
