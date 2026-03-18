import { api } from '@/lib/api'
import type {
  Appointment,
  AppointmentSchedule,
  AppointmentUpdate,
  RescheduleRequest,
  MultiServiceAppointmentCreate,
  AISlotSuggestion,
  ConfirmAppointmentRequest,
  AvailableSlotsResponse,
} from '@/types'

export const appointmentService = {

  async listAppointments(params?: {
    status?: string
    phone?: string
    client_id?: string
    pet_id?: string
    professional_id?: string
  }): Promise<Appointment[]> {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.get<Appointment[]>('/appointments', {
      params,
    })
    return response.data
  },

  async getAppointment(appointmentId: string): Promise<Appointment> {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.get<Appointment>(
      `/appointments/${appointmentId}`
    )
    return response.data
  },

  async scheduleAppointment(
    schedule: AppointmentSchedule
  ): Promise<Appointment> {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.post<Appointment>(
      '/appointments/schedule',
      schedule
    )
    return response.data
  },

  async updateAppointment(
    appointmentId: string,
    updates: AppointmentUpdate
  ): Promise<Appointment> {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.put<Appointment>(
      `/appointments/${appointmentId}`,
      updates
    )
    return response.data
  },

  async cancelAppointment(appointmentId: string): Promise<{
    success: boolean
    appointment_id: string
    cancelled_at: string
  }> {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.delete(`/appointments/${appointmentId}`)
    return response.data
  },

  async rescheduleAppointment(
    appointmentId: string,
    rescheduleData: RescheduleRequest
  ): Promise<Appointment> {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.post<Appointment>(
      `/appointments/${appointmentId}/reschedule`,
      rescheduleData
    )
    return response.data
  },

  async confirmAppointment(
    appointmentId: string,
    confirmData: ConfirmAppointmentRequest
  ): Promise<Appointment> {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.post<Appointment>(
      `/appointments/${appointmentId}/confirm`,
      confirmData
    )
    return response.data
  },

  async getAvailableSlots(params: {
    date: string
    service_id?: string
  }): Promise<AvailableSlotsResponse> {
    const response = await api.get<AvailableSlotsResponse>(
      '/appointments/available-slots',
      { params }
    )
    return response.data
  },

  async getAvailableDates(params: {
    year: number
    month: number
  }): Promise<{ dates: string[] }> {
    const response = await api.get<{ dates: string[] }>(
      '/appointments/available-dates',
      { params }
    )
    return response.data
  },

  async getAISlotSuggestions(params: {
    client_id: string
    service_ids: string[]
    preferred_date?: string
    preferred_time_range?: 'morning' | 'afternoon' | 'evening'
    petshop_id?: number
  }): Promise<AISlotSuggestion[]> {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.get<AISlotSuggestion[]>(
      '/appointments/ai-suggestions',
      { params }
    )
    return response.data
  },

  async createMultiServiceAppointment(
    appointmentData: MultiServiceAppointmentCreate
  ): Promise<Appointment> {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.post<Appointment>(
      '/appointments/multi-service',
      appointmentData
    )
    return response.data
  },
}
