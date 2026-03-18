import { api } from '@/lib/api'
import type {
  BoardingStay,
  BoardingCheckIn,
  BoardingCheckOut,
  DailyLog,
  DailyLogCreate,
  DailyLogUpdate,
  BoardingStats,
} from '@/types'

/** Mapeia resposta de /lodgings para o shape BoardingStay esperado pela UI */
function lodgingToBoarding(l: any): BoardingStay & { client_name?: string; pet_name?: string; client_phone?: string } {
  return {
    id: l.id,
    petshop_id: l.company_id ?? 0,
    client_id: l.client_id,
    pet_id: l.pet_id,
    service_type: 'hotel',
    check_in_at: l.checkin_date ?? l.created_at,
    check_out_at: l.checkout_date ?? undefined,
    num_days: l.checkout_date && l.checkin_date
      ? Math.ceil((new Date(l.checkout_date).getTime() - new Date(l.checkin_date).getTime()) / 86400000)
      : undefined,
    base_price: l.daily_rate ?? 0,
    additional_charges: {},
    total_price: l.total_amount ?? undefined,
    status: l.status,
    notes: l.care_notes ? JSON.stringify(l.care_notes) : undefined,
    created_at: l.created_at,
    updated_at: l.updated_at,
    // campos extras com nomes dos relacionamentos
    client_name: l.client_name,
    pet_name: l.pet_name,
    client_phone: l.phone_client,
  }
}

export const boardingService = {

  async checkIn(
    _petshopId: number,
    checkInData: BoardingCheckIn
  ): Promise<BoardingStay> {
    const response = await api.post<any>('/lodgings', {
      client_id: checkInData.client_id,
      pet_id: checkInData.pet_id,
      checkin_date: new Date().toISOString().slice(0, 10),
      checkout_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    })
    return lodgingToBoarding(response.data)
  },

  async checkOut(
    stayId: string,
    _petshopId: number,
    _checkOutData: BoardingCheckOut
  ): Promise<BoardingStay> {
    const response = await api.patch<any>(`/lodgings/${stayId}`, {
      status: 'checked_out',
    })
    return lodgingToBoarding(response.data)
  },

  async getActiveBoardings(
    _petshopId: number,
    serviceType?: 'hotel' | 'creche'
  ): Promise<BoardingStay[]> {
    const response = await api.get<any[]>('/lodgings', {
      params: { status: 'pending,confirmed,checked_in' },
    })
    return (response.data ?? []).map(lodgingToBoarding)
  },

  async getBoarding(
    stayId: string,
    _petshopId: number
  ): Promise<BoardingStay> {
    const response = await api.get<any>(`/lodgings/${stayId}`)
    return lodgingToBoarding(response.data)
  },

  async getBoardingsByDateRange(
    _petshopId: number,
    startDate: string,
    endDate: string,
    _serviceType?: 'hotel' | 'creche'
  ): Promise<BoardingStay[]> {
    const response = await api.get<any[]>('/lodgings', {
      params: { checkin_from: startDate, checkin_to: endDate },
    })
    return (response.data ?? []).map(lodgingToBoarding)
  },

  async createDailyLog(
    _stayId: string,
    _petshopId: number,
    _logData: DailyLogCreate
  ): Promise<DailyLog> {
    throw new Error('Daily logs não implementados ainda')
  },

  async getDailyLogs(
    _stayId: string,
    _petshopId: number
  ): Promise<DailyLog[]> {
    return []
  },

  async updateDailyLog(
    _logId: string,
    _petshopId: number,
    _logData: DailyLogUpdate
  ): Promise<DailyLog> {
    throw new Error('Daily logs não implementados ainda')
  },

  async getStats(
    _petshopId: number,
    _startDate?: string,
    _endDate?: string
  ): Promise<BoardingStats> {
    const response = await api.get<any[]>('/lodgings', {
      params: { status: 'pending,confirmed,checked_in' },
    })
    const active = response.data ?? []
    return {
      total_active: active.length,
      total_hotel: active.length,
      total_creche: 0,
      total_revenue_month: active.reduce((sum: number, l: any) => sum + (l.total_amount ?? 0), 0),
      average_stay_duration: active.length
        ? active.reduce((sum: number, l: any) => sum + (l.num_days ?? 1), 0) / active.length
        : 0,
    }
  },
}
