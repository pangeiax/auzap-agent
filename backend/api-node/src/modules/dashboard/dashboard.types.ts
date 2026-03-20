export interface AiTimeWorked {
  hours: number
  total_conversations: number
}

export interface AfterHoursStats {
  pct_after_hours: number
  pct_weekend: number
  total: number
}

export interface AppointmentsToday {
  total: number
  confirmed: number
  pending: number
}

export interface RevenueByMonth {
  month: string
  total_revenue: number
  avg_ticket: number
}

export interface AppointmentsByWeekday {
  day_of_week: number
  day_name: string
  service_name: string
  total: number
}

export interface TopService {
  service_name: string
  total_appointments: number
  total_revenue: number
  avg_ticket: number
  revenue_pct: number
}

export interface TopServiceThisMonth {
  service_name: string
  growth_pct: number
}

export interface WhatsappConversion {
  total_conversations: number
  total_appointments: number
  conversion_rate: number
  revenue_generated: number
}

export interface ClientRecurrenceSummary {
  active: number
  at_risk: number
  lost: number
  never: number
  avg_return_days: number
}

export interface LostClient {
  client_id: string
  client_name: string
  pet_name: string
  pet_species: string
  last_visit: string | null
  days_absent: number
  phone: string
}
