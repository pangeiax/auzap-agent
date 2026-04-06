const UI_TYPES = new Set([
  'campaign_draft',
  'appointment_created',
  'appointment_draft',
  'manual_schedule_draft',
  'manual_schedule_batch_draft',
  'cancel_appointment_draft',
  'cancel_appointments_batch_draft',
  'reschedule_appointments_batch_draft',
])

export type CampaignDraftPayload = {
  type: 'campaign_draft'
  clients: { id: string; name: string; manual_phone?: string; phone?: string }[]
  message: string
  /** Texto específico por cliente quando há mais de uma variante (fusão de rascunhos). */
  per_client_messages?: Record<string, string>
  total?: number
  /** Limite do plano para quantos destinatários podem ser marcados no envio. */
  max_recipients_per_send?: number
}

export type AppointmentCreatedPayload = {
  type: 'appointment_created'
  appointment_id: string
  scheduled_date: string
  service_id?: number
  pet_id?: string
  client_id?: string
}

export type AppointmentDraftPayload = {
  type: 'appointment_draft'
  client_id: string
  client_name?: string
  pet_id: string
  pet_name?: string
  service_id: number
  service_name?: string
  slot_id: string
  scheduled_date: string
  time: string
  notes?: string | null
  uses_consecutive_slots?: boolean
  paired_slot_time?: string
}

export type ManualScheduleDraftPayload = {
  type: 'manual_schedule_draft'
  client_id: string
  client_name?: string
  pet_id: string
  pet_name: string
  service_id: number
  service_name: string
  slot_id: string
  scheduled_date: string
  time: string
  scheduled_at: string
  notes?: string | null
}

export type ManualScheduleBatchDraftPayload = {
  type: 'manual_schedule_batch_draft'
  items: Omit<ManualScheduleDraftPayload, 'type'>[]
}

export type CancelAppointmentDraftPayload = {
  type: 'cancel_appointment_draft'
  appointment_id: string
  cancel_reason?: string | null
  summary?: string
}

export type CancelAppointmentsBatchDraftPayload = {
  type: 'cancel_appointments_batch_draft'
  appointment_ids: string[]
  cancel_reason?: string | null
  summaries: { appointment_id: string; summary: string }[]
}

export type RescheduleAppointmentsBatchDraftPayload = {
  type: 'reschedule_appointments_batch_draft'
  items: {
    appointment_id: string
    new_slot_id?: string
    new_scheduled_date?: string
    new_time?: string
    summary?: string
  }[]
}

export type BrainStructuredUi =
  | CampaignDraftPayload
  | AppointmentCreatedPayload
  | AppointmentDraftPayload
  | ManualScheduleDraftPayload
  | ManualScheduleBatchDraftPayload
  | CancelAppointmentDraftPayload
  | CancelAppointmentsBatchDraftPayload
  | RescheduleAppointmentsBatchDraftPayload

type SchedulingDraftPayload =
  | AppointmentDraftPayload
  | ManualScheduleDraftPayload
  | ManualScheduleBatchDraftPayload

function isSchedulingDraftPayload(x: BrainStructuredUi): x is SchedulingDraftPayload {
  return (
    x.type === 'appointment_draft' || x.type === 'manual_schedule_draft' || x.type === 'manual_schedule_batch_draft'
  )
}

function appointmentDraftToManualItem(x: AppointmentDraftPayload): Omit<ManualScheduleDraftPayload, 'type'> {
  return {
    client_id: x.client_id,
    client_name: x.client_name,
    pet_id: x.pet_id,
    pet_name: (x.pet_name ?? '').trim() || 'Pet',
    service_id: x.service_id,
    service_name: (x.service_name ?? '').trim() || 'Serviço',
    slot_id: x.slot_id,
    scheduled_date: x.scheduled_date,
    time: x.time,
    scheduled_at: `${x.scheduled_date}T${x.time}:00`,
    notes: x.notes ?? null,
  }
}

function schedulingPayloadToManualItems(x: SchedulingDraftPayload): Omit<ManualScheduleDraftPayload, 'type'>[] {
  if (x.type === 'manual_schedule_batch_draft') return x.items
  if (x.type === 'manual_schedule_draft') {
    const { type: _t, ...rest } = x
    return [rest]
  }
  return [appointmentDraftToManualItem(x)]
}

/** Junta vários rascunhos “um a um” que o modelo às vezes emite na mesma mensagem. */
function mergeStructuredPayloads(collected: BrainStructuredUi[]): BrainStructuredUi[] {
  if (collected.length === 0) return []
  if (collected.length === 1) return collected

  const schedulingOnes = collected.filter(isSchedulingDraftPayload)
  if (schedulingOnes.length === collected.length && schedulingOnes.length >= 2) {
    const items = schedulingOnes.flatMap(schedulingPayloadToManualItems)
    return [{ type: 'manual_schedule_batch_draft', items }]
  }

  const cancelOnes = collected.filter((x): x is CancelAppointmentDraftPayload => x.type === 'cancel_appointment_draft')
  if (cancelOnes.length === collected.length && cancelOnes.length >= 2) {
    const reason =
      cancelOnes.find((x) => x.cancel_reason != null && String(x.cancel_reason).trim() !== '')?.cancel_reason ?? null
    return [
      {
        type: 'cancel_appointments_batch_draft',
        appointment_ids: cancelOnes.map((x) => x.appointment_id),
        cancel_reason: reason,
        summaries: cancelOnes.map((x) => ({
          appointment_id: x.appointment_id,
          summary: x.summary ?? '',
        })),
      },
    ]
  }

  const campaigns = collected.filter((x): x is CampaignDraftPayload => x.type === 'campaign_draft')
  if (campaigns.length >= 2) {
    const merged = mergeCampaignDraftPayloads(campaigns)
    const rest = collected.filter((x) => x.type !== 'campaign_draft')
    return [...rest, merged]
  }

  return collected
}

function mergeCampaignDraftPayloads(parts: CampaignDraftPayload[]): CampaignDraftPayload {
  const byId = new Map<string, CampaignDraftPayload['clients'][0]>()
  const mergedMap: Record<string, string> = {}

  for (const part of parts) {
    const baseMsg = String(part.message ?? '').trim()
    const pcm = part.per_client_messages ?? {}
    for (const c of part.clients) {
      byId.set(c.id, c)
      const spec = pcm[c.id]
      mergedMap[c.id] = spec != null && String(spec).trim() !== '' ? String(spec).trim() : baseMsg
    }
    for (const [id, m] of Object.entries(pcm)) {
      if (id && String(m).trim() !== '') mergedMap[id] = String(m).trim()
    }
  }

  const clients = [...byId.values()]
  for (const c of clients) {
    if (!mergedMap[c.id]?.trim()) mergedMap[c.id] = String(parts[parts.length - 1]?.message ?? '').trim()
  }

  const uniqueVals = [...new Set(Object.values(mergedMap).filter((x) => x && x.trim()))]
  const message = uniqueVals.length === 1 ? uniqueVals[0]! : (mergedMap[clients[0]?.id ?? ''] ?? uniqueVals[0] ?? '')
  const maxRecipients = parts[parts.length - 1]?.max_recipients_per_send ?? parts[0]?.max_recipients_per_send

  return {
    type: 'campaign_draft',
    clients,
    message,
    ...(uniqueVals.length > 1 ? { per_client_messages: mergedMap } : {}),
    total: clients.length,
    max_recipients_per_send: maxRecipients,
  }
}

/**
 * Remove **todos** os JSONs de UI do texto e devolve `structured` (lista fundida: ex. vários
 * agendamentos → lote; várias campanhas → uma; **cancelamento + campanha** permanecem dois itens).
 *
 * Importante: ignorar `{` que não abrem JSON de UI (ex.: **{{nome_cliente}}**), senão o algoritmo
 * parava e deixava o JSON real visível no chat.
 */
export function splitAssistantReply(reply: string): {
  displayText: string
  structured: BrainStructuredUi | BrainStructuredUi[] | null
} {
  let text = reply ?? ''
  const collected: BrainStructuredUi[] = []

  let searchFrom = 0
  while (true) {
    const i = text.indexOf('{', searchFrom)
    if (i < 0) break
    let found = false
    for (let j = text.length; j > i; j--) {
      try {
        const slice = text.slice(i, j)
        const parsed = JSON.parse(slice) as { type?: string }
        if (parsed?.type && UI_TYPES.has(parsed.type)) {
          collected.push(parsed as BrainStructuredUi)
          text = (text.slice(0, i) + text.slice(j)).replace(/\n{3,}/g, '\n\n').trim()
          found = true
          searchFrom = 0
          break
        }
      } catch {
        /* continuar */
      }
    }
    if (!found) searchFrom = i + 1
  }

  const merged = mergeStructuredPayloads(collected)
  let structured: BrainStructuredUi | BrainStructuredUi[] | null = null
  if (merged.length === 1) structured = merged[0]!
  else if (merged.length > 1) structured = merged

  return {
    displayText: text.trim(),
    structured,
  }
}
