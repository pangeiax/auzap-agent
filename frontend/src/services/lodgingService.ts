import { api } from '../lib/api'

// ─── Room Types ──────────────────────────────────────────────────────────────

export interface RoomType {
  id: string
  company_id: number
  lodging_type: 'hotel' | 'daycare'
  name: string
  description?: string | null
  capacity: number
  daily_rate: number
  features?: Record<string, boolean>
  is_active: boolean
  created_at?: string
  updated_at?: string
}

export interface CreateRoomTypeData {
  lodging_type: 'hotel' | 'daycare'
  name: string
  description?: string
  capacity: number
  daily_rate: number
  features?: Record<string, boolean>
}

export interface UpdateRoomTypeData {
  name?: string
  description?: string | null
  capacity?: number
  daily_rate?: number
  features?: Record<string, boolean>
  is_active?: boolean
}

export interface RoomTypeAvailability {
  room_type_id: string
  room_type_name: string
  daily_rate: number
  total_amount: number
  days: number
  total_capacity: number
  available_capacity: number
  available: boolean
}

export const roomTypeService = {
  async list(params?: { lodging_type?: 'hotel' | 'daycare'; is_active?: boolean }): Promise<RoomType[]> {
    const res = await api.get<RoomType[]>('/room-types', { params })
    return res.data
  },

  async get(id: string): Promise<RoomType> {
    const res = await api.get<RoomType>(`/room-types/${id}`)
    return res.data
  },

  async create(data: CreateRoomTypeData): Promise<RoomType> {
    const res = await api.post<RoomType>('/room-types', data)
    return res.data
  },

  async update(id: string, data: UpdateRoomTypeData): Promise<RoomType> {
    const res = await api.patch<RoomType>(`/room-types/${id}`, data)
    return res.data
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/room-types/${id}`)
  },

  async getAvailability(
    lodgingType: 'hotel' | 'daycare',
    checkinDate: string,
    checkoutDate: string,
  ): Promise<RoomTypeAvailability[]> {
    const res = await api.get<RoomTypeAvailability[]>('/room-types/availability', {
      params: { lodging_type: lodgingType, checkin_date: checkinDate, checkout_date: checkoutDate },
    })
    return res.data
  },
}

// ─── Lodging Reservations ────────────────────────────────────────────────────

export type LodgingType = 'hotel' | 'daycare'
export type LodgingStatus = 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'needs_reschedule'

export interface LodgingReservation {
  id: string
  company_id: number
  client_id: string
  client_name?: string
  phone_client?: string
  pet_id: string
  pet_name?: string
  pet_breed?: string
  pet_size?: string
  type: LodgingType
  room_type_id?: string | null
  room_type_name?: string | null
  room_type_daily_rate?: number | null
  checkin_date: string
  checkout_date: string
  checkin_time?: string | null
  checkout_time?: string | null
  kennel_id?: string | null
  status: LodgingStatus
  confirmed: boolean
  daily_rate?: number | null
  total_amount?: number | null
  care_notes?: Record<string, unknown>
  emergency_contact?: string | null
  created_at?: string
  updated_at?: string
}

export interface CreateLodgingReservationData {
  client_id: string
  pet_id: string
  type: LodgingType
  room_type_id?: string
  checkin_date: string
  checkout_date: string
  checkin_time?: string
  checkout_time?: string
  daily_rate?: number
  care_notes?: Record<string, unknown>
  emergency_contact?: string
}

export const lodgingReservationService = {
  async list(params?: {
    status?: string
    type?: LodgingType
    client_id?: string
    pet_id?: string
    checkin_from?: string
    checkin_to?: string
  }) {
    const res = await api.get<LodgingReservation[]>('/lodging-reservations', { params })
    return res.data
  },

  async get(id: string) {
    const res = await api.get<LodgingReservation>(`/lodging-reservations/${id}`)
    return res.data
  },

  async create(data: CreateLodgingReservationData) {
    const res = await api.post<LodgingReservation>('/lodging-reservations', data)
    return res.data
  },

  async update(id: string, data: Partial<{
    status: LodgingStatus
    kennel_id: string
    care_notes: Record<string, unknown>
    emergency_contact: string
    confirmed: boolean
  }>) {
    const res = await api.patch<LodgingReservation>(`/lodging-reservations/${id}`, data)
    return res.data
  },

  async cancel(id: string) {
    const res = await api.delete(`/lodging-reservations/${id}`)
    return res.data
  },

  async checkAvailability(type: LodgingType, checkinDate: string, checkoutDate: string) {
    const res = await api.get<{
      type: LodgingType
      checkin_date: string
      checkout_date: string
      available: boolean
      min_available_capacity: number
    }>('/lodging-reservations/availability', {
      params: { type, checkin_date: checkinDate, checkout_date: checkoutDate },
    })
    return res.data
  },
}

// ─── Lodging Config ──────────────────────────────────────────────────────────

export interface LodgingCapacityEntry {
  id?: string
  type: LodgingType
  day_of_week: number  // 0=dom..6=sab
  max_capacity: number
  is_active?: boolean
}

export interface LodgingConfig {
  hotel_enabled: boolean
  hotel_daily_rate?: number | null
  hotel_checkin_time: string
  hotel_checkout_time: string
  daycare_enabled: boolean
  daycare_daily_rate?: number | null
  daycare_checkin_time: string
  daycare_checkout_time: string
  capacities: LodgingCapacityEntry[]
}

export const lodgingConfigService = {
  async get(): Promise<LodgingConfig> {
    const res = await api.get<LodgingConfig>('/lodging-config')
    return res.data
  },

  async update(data: Partial<Omit<LodgingConfig, 'capacities'>>): Promise<LodgingConfig> {
    const res = await api.patch<LodgingConfig>('/lodging-config', data)
    return res.data
  },

  async upsertCapacities(capacities: LodgingCapacityEntry[]): Promise<LodgingCapacityEntry[]> {
    const res = await api.put<LodgingCapacityEntry[]>('/lodging-config/capacity', { capacities })
    return res.data
  },
}

// ─── Legacy service (kept for backward compat) ───────────────────────────────
export const lodgingService = {
  async list(params?: { status?: string; client_id?: string; pet_id?: string; checkin_from?: string; checkin_to?: string }) {
    const res = await api.get('/lodgings', { params })
    return res.data
  },
  async get(id: string) {
    const res = await api.get(`/lodgings/${id}`)
    return res.data
  },
  async update(id: string, data: Record<string, unknown>) {
    const res = await api.patch(`/lodgings/${id}`, data)
    return res.data
  },
  async cancel(id: string) {
    const res = await api.delete(`/lodgings/${id}`)
    return res.data
  },
}
