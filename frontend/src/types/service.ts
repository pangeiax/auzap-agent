export interface Service {
  id: number
  companyId: number
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
  description?: string
  duration_min?: number
  price?: number | string | null
  price_by_size?: {
    small?: number
    medium?: number
    large?: number
  } | null
  is_active?: boolean
}

export interface ServiceFilters {
  is_active?: boolean
}
