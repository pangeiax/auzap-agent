import { api } from '../lib/api'

export interface DayHours {
  start: string       // "HH:MM"
  end: string         // "HH:MM"
  lunch_start?: string | null
  lunch_end?: string | null
}

/** Keys are day-of-week as strings: "0"=dom, "1"=seg, ..., "6"=sab */
export type WorkHoursByDay = Record<string, DayHours>

export interface Staff {
  id: string
  companyId: number
  name: string
  role?: string | null
  specialtyIds: string[]
  daysOfWeek: number[]
  workStart: string
  workEnd: string
  lunchStart?: string | null
  lunchEnd?: string | null
  workHoursByDay?: WorkHoursByDay | null
  isActive: boolean
  createdAt?: string
  updatedAt?: string
}

export interface StaffSchedule {
  id: string
  staffId: string
  type?: string | null
  startDate: string
  endDate?: string | null
  startTime?: string | null
  endTime?: string | null
  notes?: string | null
  createdAt?: string
}

export interface CreateStaffData {
  name: string
  role?: string
  specialty_ids?: string[]
  days_of_week: number[]
  work_start: string
  work_end: string
  lunch_start?: string
  lunch_end?: string
  work_hours_by_day?: WorkHoursByDay
}

export interface UpdateStaffData {
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

export interface CreateScheduleData {
  type?: string
  start_date: string
  end_date?: string
  start_time?: string
  end_time?: string
  notes?: string
}

export interface StaffSlot {
  staff_id: string
  staff_name: string
  start_time: string
  end_time: string
  date: string
}

export interface StaffAvailabilityResponse {
  available: boolean
  date: string
  available_slots: StaffSlot[]
}

export const staffService = {
  async list(): Promise<Staff[]> {
    const res = await api.get<Staff[]>('/staff')
    return res.data
  },

  async create(data: CreateStaffData): Promise<Staff> {
    const res = await api.post<Staff>('/staff', data)
    return res.data
  },

  async update(id: string, data: UpdateStaffData): Promise<Staff> {
    const res = await api.put<Staff>(`/staff/${id}`, data)
    return res.data
  },

  async deactivate(id: string): Promise<Staff> {
    const res = await api.patch<Staff>(`/staff/${id}/deactivate`)
    return res.data
  },

  async listSchedules(staffId: string): Promise<StaffSchedule[]> {
    const res = await api.get<StaffSchedule[]>(`/staff/${staffId}/schedules`)
    return res.data
  },

  async createSchedule(staffId: string, data: CreateScheduleData): Promise<StaffSchedule> {
    const res = await api.post<StaffSchedule>(`/staff/${staffId}/schedules`, data)
    return res.data
  },

  async deleteSchedule(staffId: string, scheduleId: string): Promise<void> {
    await api.delete(`/staff/${staffId}/schedules/${scheduleId}`)
  },

  async getAvailability(params: {
    specialty_id: string
    date: string
    service_id?: string
    pet_id?: string
  }): Promise<StaffAvailabilityResponse> {
    const res = await api.get<StaffAvailabilityResponse>('/staff/availability', { params })
    return res.data
  },
}
