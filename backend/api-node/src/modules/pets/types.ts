/**
 * Pet types and interfaces
 */

export interface CreatePetDTO {
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

export interface UpdatePetDTO {
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
  isActive?: boolean
}

export interface PetListQuery {
  client_id?: string
  species?: string
  limit?: number
  offset?: number
}
