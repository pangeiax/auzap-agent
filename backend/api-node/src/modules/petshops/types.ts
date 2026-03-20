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
  is_active?: boolean
}

export interface PetshopListQuery {
  skip?: number
  limit?: number
  is_active?: string
}
