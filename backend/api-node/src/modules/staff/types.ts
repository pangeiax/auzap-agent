export interface DayHours {
  start: string       // "HH:MM"
  end: string         // "HH:MM"
  lunch_start?: string | null
  lunch_end?: string | null
}

/** Keys are day-of-week as strings: "0"=dom, "1"=seg, ..., "6"=sab */
export type WorkHoursByDay = Record<string, DayHours>

export interface CreateStaffDTO {
  name: string
  role?: string
  specialty_ids?: string[]
  days_of_week: number[]   // 0=dom, 1=seg, ... 6=sab
  work_start: string       // "HH:MM" — default fallback
  work_end: string         // "HH:MM" — default fallback
  lunch_start?: string
  lunch_end?: string
  work_hours_by_day?: WorkHoursByDay
}

export interface UpdateStaffDTO {
  name?: string
  role?: string
  specialty_ids?: string[]
  days_of_week?: number[]
  work_start?: string
  work_end?: string
  lunch_start?: string | null
  lunch_end?: string | null
  work_hours_by_day?: WorkHoursByDay | null
}

export interface CreateStaffScheduleDTO {
  type?: string        // 'ferias' | 'folga' | 'saida_antecipada' | 'reuniao' | 'externo'
  start_date: string   // YYYY-MM-DD
  end_date?: string
  start_time?: string  // HH:MM — null = dia inteiro bloqueado
  end_time?: string
  notes?: string
}

export interface StaffAvailabilityQuery {
  specialty_id: string
  date: string         // YYYY-MM-DD
  service_id?: string
}
