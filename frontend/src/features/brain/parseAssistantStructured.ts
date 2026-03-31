const UI_TYPES = new Set(['campaign_draft', 'appointment_created'])

export type CampaignDraftPayload = {
  type: 'campaign_draft'
  clients: { id: string; name: string; phone: string }[]
  message: string
  total?: number
}

export type AppointmentCreatedPayload = {
  type: 'appointment_created'
  appointment_id: string
  scheduled_date: string
  service_id?: number
  pet_id?: string
  client_id?: string
}

export type BrainStructuredUi = CampaignDraftPayload | AppointmentCreatedPayload

/**
 * Extrai o primeiro JSON com `type` reconhecido para UI (campanha / agendamento criado).
 */
export function splitAssistantReply(reply: string): {
  displayText: string
  structured: BrainStructuredUi | null
} {
  const text = reply ?? ''
  let start = 0
  while (start < text.length) {
    const i = text.indexOf('{', start)
    if (i < 0) break
    for (let j = text.length; j > i; j--) {
      try {
        const slice = text.slice(i, j)
        const parsed = JSON.parse(slice) as { type?: string }
        if (parsed?.type && UI_TYPES.has(parsed.type)) {
          const displayText = (text.slice(0, i) + text.slice(j)).replace(/\n{3,}/g, '\n\n').trim()
          return { displayText, structured: parsed as BrainStructuredUi }
        }
      } catch {
        /* continuar */
      }
    }
    start = i + 1
  }
  return { displayText: text.trim(), structured: null }
}
