import { api } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgendaSpecialty {
  id: string
  name: string
  color: string | null
}

export interface AgendaCapacityBySpecialty {
  specialty_id: string
  specialty_name: string
  color: string | null
  rule_id: string | null
  max_capacity: number
  is_active: boolean
  total_slots: number
  total_vagas: number
}

export interface AgendaSlot {
  slot_id: string
  slot_time: string // "HH:MM"
  specialty_id: string
  max_capacity: number
  used_capacity: number
  is_blocked: boolean
  block_reason: string | null
}

export interface AgendaDay {
  day_of_week: number
  day_name: string
  is_closed: boolean
  open_time: string // "HH:MM"
  close_time: string // "HH:MM"
  capacity_by_specialty: AgendaCapacityBySpecialty[]
  slots_today: AgendaSlot[]
}

export interface AgendaData {
  specialties: AgendaSpecialty[]
  days: AgendaDay[]
}

export interface SaveAgendaDay {
  day_of_week: number
  is_closed: boolean
  open_time: string
  close_time: string
  capacity_by_specialty: Array<{ specialty_id: string; max_capacity: number }>
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const settingsService = {
  async generateSlots(days = 30): Promise<{
    success: boolean
    slots_created: number
    days_requested: number
    days_generated: number
    warning?: string
    period: { from: string; to: string }
  }> {
    const res = await api.post('/settings/generate-slots', { days })
    return res.data
  },

  async getAgenda(): Promise<AgendaData> {
    const res = await api.get('/settings/agenda')
    return res.data
  },

  /** Retorna a agenda atualizada (mesmo formato do GET) para evitar novo request após salvar. */
  async saveAgenda(body: { days: SaveAgendaDay[] }): Promise<AgendaData> {
    const res = await api.put<{ success: boolean } & AgendaData>('/settings/agenda', body)
    const { success: _s, ...agenda } = res.data
    return agenda as AgendaData
  },

  async blockSlot(slotId: string, isBlocked: boolean, force = false): Promise<void> {
    await api.patch(`/settings/agenda/slot/${slotId}/block`, { is_blocked: isBlocked, force })
  },

  async toggleRule(ruleId: string, isActive: boolean): Promise<void> {
    await api.patch(`/settings/agenda/rule/${ruleId}/toggle`, { is_active: isActive })
  },
}
