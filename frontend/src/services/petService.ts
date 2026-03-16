import { api } from '@/lib/api'
import type { Pet } from '@/types'

export interface PetCreate {
  petshop_id: number
  client_id: string
  name: string
  species?: string
  breed?: string
  age?: number
  size?: string
  weight?: number
  color?: string
  medical_info?: {
    allergies?: string[]
    medications?: string[]
    conditions?: string[]
  }
  vaccination_date?: string
  last_vet_visit?: string
  emergency_contact?: string
  photo_url?: string
}

export interface PetUpdate {
  name?: string
  species?: string
  breed?: string
  age?: number
  size?: string
  weight?: number
  color?: string
  medical_info?: {
    allergies?: string[]
    medications?: string[]
    conditions?: string[]
  }
  vaccination_date?: string
  last_vet_visit?: string
  emergency_contact?: string
  photo_url?: string
}

export const petService = {
  async listPets(params?: {
    petshop_id?: number
    client_id?: string
    species?: string
    limit?: number
    offset?: number
  }): Promise<Pet[]> {
    const response = await api.get<Pet[]>('/pets', { params })
    return response.data
  },
  async getPet(petId: string): Promise<Pet> {
    const response = await api.get<Pet>(`/pets/${petId}`)
    return response.data
  },
  async createPet(petData: PetCreate): Promise<Pet> {
    const { petshop_id, ...body } = petData
    const response = await api.post<Pet>('/pets', body, {
      params: { petshop_id },
    })
    return response.data
  },
  async updatePet(petId: string, updates: PetUpdate): Promise<Pet> {
    const response = await api.put<Pet>(`/pets/${petId}`, updates)
    return response.data
  },
  async deletePet(petId: string): Promise<void> {
    await api.delete(`/pets/${petId}`)
  },
  async getClientPets(clientId: string, petshopId?: number): Promise<Pet[]> {
    const response = await api.get<Pet[]>(`/clients/${clientId}/pets`, {
      params: petshopId ? { petshop_id: petshopId } : {},
    })
    return response.data
  },
}
