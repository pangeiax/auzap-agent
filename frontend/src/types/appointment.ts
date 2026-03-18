export interface Appointment {
  id: string
  client_id: string
  client_name: string
  phone_client: string
  pet_id?: string
  professional_id?: string
  professional_name?: string
  specialty?: string
  specialty_id?: string
  service_id?: number
  slot_id?: string
  schedule_id?: number
  scheduled_at: string
  scheduled_date?: string
  price: number
  status: string
  confirmed?: boolean
  google_calendar_event_id?: string
  pet_name?: string
  pet_species?: string
  pet_breed?: string
  pet_size?: string
  pet_age?: string
  pet_special_conditions?: string
  recurrence_rule?: string
  parent_id?: string
  is_recurring: boolean
  notes?: string
  cancelled_at?: string
  cancel_reason?: string
  created_at: string
}

export interface AppointmentSchedule {
  client_id: string
  scheduled_at: string
  slot_id?: string
  schedule_id?: number
  payment_method?: string
  origin_channel?: string
  pet_id?: string
  service_id?: string
  status?: string
  notes?: string
  pet_name?: string
  pet_species?: string
  pet_breed?: string
  pet_size?: string
  pet_age?: string
  pet_special_conditions?: string
}

export interface AppointmentUpdate {
  scheduled_at?: string
  price?: number
  status?: string
  payment_method?: string
  notes?: string
  pet_name?: string
  pet_species?: string
  pet_breed?: string
  pet_size?: string
  pet_age?: string
  pet_special_conditions?: string
  recurrence_rule?: string
  is_recurring?: boolean
}

export interface RescheduleRequest {
  new_scheduled_at: string
  reason?: string
}

export interface MultiServiceAppointmentCreate {
  client_id: string
  service_ids: string[]
  scheduled_at: string
  payment_method: string
  origin_channel?: string
  notes?: string
  pet_name?: string
  pet_species?: string
  pet_breed?: string
  pet_size?: string
  pet_age?: string
  pet_special_conditions?: string
}

export interface AISlotSuggestion {
  slot_time: string
  duration_minutes: number
  confidence_score: number
  reasoning: string
  professional_id?: string
  professional_name?: string
  available_services: string[]
}

export interface ConfirmAppointmentRequest {
  confirmation_token?: string
  notes?: string
}

export interface AvailableSlot {
  slot_id?: string
  schedule_id?: number
  time: string
  end_time?: string
  capacity: number
  remaining_capacity: number
  specialty_id?: string
}

export interface AvailableSlotsResponse {
  date: string
  available_slots: AvailableSlot[]
  total_available: number
}
