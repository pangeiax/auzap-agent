export interface Service {
  id: number
  companyId: number
  specialtyId?: string | null
  specialty?: { id: string; name: string; color?: string | null } | null
  name: string
  description?: string
  durationMin: number
  price?: number | null
  priceBySize?: {
    small?: number
    medium?: number
    large?: number
  } | null
  durationMultiplierLarge?: number | null
  isActive?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface ServiceCreate {
  name: string
  specialty_id?: string | null
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

export interface ServiceUpdate {
  name?: string
  specialty_id?: string | null
  description?: string
  duration_min?: number
  price?: number | string | null
  price_by_size?: {
    small?: number
    medium?: number
    large?: number
  } | null
  is_active?: boolean
  duration_multiplier_large?: number | null
}

export interface ServiceFilters {
  is_active?: boolean
}
