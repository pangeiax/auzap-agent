export interface Petshop {
  id: number
  companyId: number
  address?: string
  cep?: string
  phone: string
  latitude?: number
  longitude?: number
  ownerPhone?: string
  emergencyContact?: string
  assistantName?: string
  features?: Record<string, unknown>
  /** Derivado no backend a partir de `petshop_business_hours` (não é coluna no banco). */
  businessHours?: Record<string, string | { open: string; close: string; closed?: boolean }>
  isActive?: boolean
  createdAt?: string
  updatedAt?: string
  company?: {
    id: number
    name: string
    slug: string
    plan?: string
    isActive?: boolean
  }
}

export interface PetshopUpdate {
  address?: string
  cep?: string
  phone?: string
  latitude?: number
  longitude?: number
  owner_phone?: string
  emergency_contact?: string
  assistant_name?: string
  company_name?: string
  is_active?: boolean
}

export interface Specialty {
  id: string
  companyId: number
  name: string
  color?: string
  description?: string
  isActive: boolean
  createdAt?: string
}

export interface CapacityRule {
  id: string
  specialtyId: string
  companyId: number
  dayOfWeek: number
  slot_time: string
  maxCapacity: number
  isActive: boolean
}

export interface PetshopSlot {
  id: string
  companyId: number
  specialtyId: string
  slotDate: string
  slot_time: string
  maxCapacity: number
  usedCapacity: number
  vagas_restantes?: number
}
