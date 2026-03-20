import { api } from '@/lib/api'

// ─── Tipos para os novos endpoints de métricas (views Supabase) ──────────────

export interface SentimentKpi {
  total_analyzed: number
  positive: number
  neutral: number
  negative: number
  high_churn_risk: number
  medium_churn_risk: number
  positive_pct: number
}

export interface DashboardKpis {
  aiTime: { hours: number; total_conversations: number }
  afterHours: { pct_after_hours: number; pct_weekend: number; total: number }
  today: { total: number; confirmed: number; pending: number }
  conversion: { total_conversations: number; total_appointments: number; conversion_rate: number; revenue_generated: number }
  topService: { service_name: string; growth_pct: number } | null
  sentiment?: SentimentKpi
}

export interface RevenueByMonth {
  month: string
  total_revenue: number
  avg_ticket: number
}

export interface AppointmentByWeekday {
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

export interface ClientRecurrence {
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

import type {
  DashboardStats,
  RevenueMetrics,
  ConversionMetrics,
  ClientFunnelMetrics,
  AppointmentTrends,
  DashboardPeriod,
} from '@/types'

export const dashboardService = {
  async getStats(params?: DashboardPeriod): Promise<DashboardStats> {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.get<DashboardStats>('/dashboard/stats', {
      params,
    })
    return response.data
  },
  async getRevenue(params?: DashboardPeriod): Promise<RevenueMetrics> {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.get<RevenueMetrics>('/dashboard/revenue', {
      params,
    })
    return response.data
  },
  async getConversion(params?: DashboardPeriod): Promise<ConversionMetrics> {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.get<ConversionMetrics>(
      '/dashboard/conversion',
      { params }
    )
    return response.data
  },
  async getClientFunnel(params?: DashboardPeriod): Promise<ClientFunnelMetrics> {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.get<ClientFunnelMetrics>(
      '/dashboard/client-funnel',
      { params }
    )
    return response.data
  },
  async getAppointmentTrends(
    params?: DashboardPeriod
  ): Promise<AppointmentTrends> {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.get<AppointmentTrends>(
      '/dashboard/appointment-trends',
      { params }
    )
    return response.data
  },
  async getRevenueChart(params?: {
    period?: 'week' | 'month' | 'quarter' | 'year'
    group_by?: 'day' | 'week' | 'month'
  }): Promise<
    Array<{
      date: string
      revenue: number
      appointments: number
    }>
  > {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.get('/dashboard/revenue-chart', { params })
    return response.data
  },
  async getCategoriesChart(params?: DashboardPeriod): Promise<
    Array<{
      category: string
      value: number
      percentage: number
    }>
  > {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.get('/dashboard/categories-chart', {
      params,
    })
    return response.data
  },
  async getVisitsChart(params?: {
    period?: 'week' | 'month'
    group_by?: 'day' | 'hour'
  }): Promise<
    Array<{
      date: string
      visits: number
      new_clients: number
      returning_clients: number
    }>
  > {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.get('/dashboard/visits-chart', { params })
    return response.data
  },
  async getSalesChart(params?: DashboardPeriod): Promise<
    Array<{
      service: string
      sales: number
      revenue: number
    }>
  > {
    // TODO: Backend — endpoint não implementado em api-node ainda. Implementar em backend/api-node/src/modules/
    const response = await api.get('/dashboard/sales-chart', { params })
    return response.data
  },

  // ─── Novos endpoints baseados nas views do Supabase ────────────────────────

  async getKpis(): Promise<DashboardKpis> {
    const response = await api.get<DashboardKpis>('/dashboard/kpis')
    return response.data
  },

  async getRevenueByMonth(): Promise<RevenueByMonth[]> {
    const response = await api.get<RevenueByMonth[]>('/dashboard/revenue')
    return response.data
  },

  async getAppointmentsByWeekday(serviceId?: number): Promise<AppointmentByWeekday[]> {
    const response = await api.get<AppointmentByWeekday[]>('/dashboard/appointments-by-weekday', {
      params: serviceId ? { service_id: serviceId } : undefined,
    })
    return response.data
  },

  async getTopServices(): Promise<TopService[]> {
    const response = await api.get<TopService[]>('/dashboard/top-services')
    return response.data
  },

  async getClientRecurrence(): Promise<ClientRecurrence> {
    const response = await api.get<ClientRecurrence>('/dashboard/recurrence')
    return response.data
  },

  async getLostClients(minDays?: number): Promise<LostClient[]> {
    const response = await api.get<LostClient[]>('/dashboard/lost-clients', {
      params: minDays ? { min_days: minDays } : undefined,
    })
    return response.data
  },
}
