import { api } from '../lib/api'
import { Specialty } from '../types/petshop'

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
}
