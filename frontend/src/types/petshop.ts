export interface PetshopCreate {
  company_id: number
  address?: string
  cep?: string
  phone: string
  latitude?: number
  longitude?: number
  owner_phone?: string
  emergency_contact?: string
  assistant_name?: string
  default_capacity_per_hour?: number
  business_hours?: {
    [key: string]: {
      open?: string
      close?: string
      closed?: boolean
    }
  }
}

export interface Petshop {
  id: number
  companyId: number
  address?: string | null
  cep?: string | null
  phone: string
  latitude?: number | null
  longitude?: number | null
  ownerPhone?: string | null
  emergencyContact?: string | null
  assistantName?: string | null
  features?: any
  businessHours?: {
    [key: string]: {
      open?: string
      close?: string
      closed?: boolean
    }
  } | null
  defaultCapacityPerHour?: number | null
  customCapacityHours?: any
  isActive?: boolean | null
  createdAt?: string
  updatedAt?: string
  company?: {
    id: number
    name: string
    slug: string
    plan?: string
    isActive?: boolean
    createdAt?: string
    updatedAt?: string
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
  default_capacity_per_hour?: number
  business_hours?: {
    [key: string]: {
      open?: string
      close?: string
      closed?: boolean
    }
  }
  custom_capacity_hours?: any
  company_name?: string
  is_active?: boolean
}
