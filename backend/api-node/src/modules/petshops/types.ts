export interface CreatePetshopDTO {
  company_id: number
  address?: string
  cep?: string
  phone: string
  latitude?: number
  longitude?: number
  owner_phone?: string
  emergency_contact?: string
  assistant_name?: string
  business_hours?: Record<string, string | { open?: string; close?: string; closed?: boolean }>
}

export interface UpdatePetshopDTO {
  address?: string
  cep?: string
  phone?: string
  latitude?: number
  longitude?: number
  owner_phone?: string
  emergency_contact?: string
  assistant_name?: string
  business_hours?: Record<string, string | { open?: string; close?: string; closed?: boolean }>
  is_active?: boolean
}

export interface PetshopListQuery {
  skip?: number
  limit?: number
  is_active?: string
}
