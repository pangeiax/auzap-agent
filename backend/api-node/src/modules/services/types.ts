/**
 * Service types and interfaces
 */

export interface CreateServiceDTO {
  name: string
  description?: string
  duration_min?: number
  price?: number | string
  price_by_size?: {
    small?: number
    medium?: number
    large?: number
  }
  duration_multiplier_large?: number | string
}

export interface UpdateServiceDTO {
  name?: string
  description?: string
  duration_min?: number
  price?: number | string
  price_by_size?: {
    small?: number
    medium?: number
    large?: number
  }
  is_active?: boolean
}

export interface ServiceListQuery {
  is_active?: string
}

export interface BookableServicesQuery {
  specialty?: string
  pet_species?: string
  pet_size?: string
}
