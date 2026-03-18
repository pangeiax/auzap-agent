import { api } from '@/lib/api'
import type { Petshop, PetshopUpdate } from '@/types'

type PetshopCreate = {
  company_id?: number
  phone: string
  name?: string
  address?: string
  cep?: string
  owner_phone?: string
  emergency_contact?: string
  assistant_name?: string
  business_hours?: Record<string, string | { open?: string; close?: string; closed?: boolean }>
}

export const petshopService = {
  async createPetshop(data: PetshopCreate): Promise<Petshop> {
    const response = await api.post<Petshop>('/petshops', data)
    return response.data
  },

  async listPetshops(params?: { skip?: number; limit?: number; is_active?: boolean }): Promise<Petshop[]> {
    const response = await api.get<Petshop[]>('/petshops', { params })
    return response.data
  },

  async getPetshop(petshopId: number): Promise<Petshop> {
    const response = await api.get<Petshop>(`/petshops/${petshopId}`)
    return response.data
  },

  async updatePetshop(petshopId: number, data: PetshopUpdate): Promise<Petshop> {
    const response = await api.patch<Petshop>(`/petshops/${petshopId}`, data)
    return response.data
  },
}
