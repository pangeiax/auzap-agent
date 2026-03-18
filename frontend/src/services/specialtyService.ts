import { api } from '../lib/api'
import { Specialty, CapacityRule } from '../types/petshop'

export const specialtyService = {
  async list(params?: { is_active?: boolean }) {
    const res = await api.get<Specialty[]>('/specialties', { params })
    return res.data
  },

  async get(id: string) {
    const res = await api.get<Specialty>(`/specialties/${id}`)
    return res.data
  },

  async create(data: { name: string; color?: string; description?: string }) {
    const res = await api.post<Specialty>('/specialties', data)
    return res.data
  },

  async update(id: string, data: { name?: string; color?: string; description?: string; is_active?: boolean }) {
    const res = await api.patch<Specialty>(`/specialties/${id}`, data)
    return res.data
  },

  async delete(id: string) {
    const res = await api.delete(`/specialties/${id}`)
    return res.data
  },

  async listCapacityRules(specialtyId: string) {
    const res = await api.get<CapacityRule[]>(`/specialties/${specialtyId}/capacity-rules`)
    return res.data
  },

  async upsertCapacityRule(specialtyId: string, data: { day_of_week: number; slot_time: string; max_capacity: number }) {
    const res = await api.post<CapacityRule>(`/specialties/${specialtyId}/capacity-rules`, data)
    return res.data
  },

  async bulkUpsertCapacityRules(
    specialtyId: string,
    rules: { day_of_week: number; max_capacity: number; slot_time?: string }[],
  ) {
    const res = await api.post<{ created: number; updated: number; deactivated: number; rules: CapacityRule[] }>(
      `/specialties/${specialtyId}/capacity-rules/bulk`,
      { rules },
    )
    return res.data
  },

  async deleteCapacityRule(specialtyId: string, ruleId: string) {
    const res = await api.delete(`/specialties/${specialtyId}/capacity-rules/${ruleId}`)
    return res.data
  },

  async generateSlots(specialtyId: string, days = 30) {
    const res = await api.post(`/specialties/${specialtyId}/generate-slots`, { days })
    return res.data
  },
}
