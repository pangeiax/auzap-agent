import { api } from '@/lib/api'
import type {
  Service,
  ServiceCreate,
  ServiceUpdate,
  ServiceFilters,
} from '@/types'

/** API returns Prisma Decimals as strings; normalize so UI checks like `=== 2` work. */
function normalizeService(raw: Service): Service {
  const v = raw.durationMultiplierLarge
  if (v == null || v === '') {
    return { ...raw, durationMultiplierLarge: null }
  }
  const n = typeof v === 'number' ? v : Number(v)
  return {
    ...raw,
    durationMultiplierLarge: Number.isFinite(n) ? n : null,
  }
}

export const serviceService = {
  async listServices(filters?: ServiceFilters): Promise<Service[]> {
    const response = await api.get<Service[]>('/services', {
      params: filters,
    })
    return response.data.map(normalizeService)
  },
  async getService(serviceId: number): Promise<Service> {
    const response = await api.get<Service>(`/services/${serviceId}`)
    return normalizeService(response.data)
  },
  async createService(serviceData: ServiceCreate): Promise<Service> {
    const response = await api.post<Service>('/services', serviceData)
    return normalizeService(response.data)
  },
  async updateService(
    serviceId: number,
    updates: ServiceUpdate
  ): Promise<Service> {
    const response = await api.put<Service>(
      `/services/${serviceId}`,
      updates
    )
    return normalizeService(response.data)
  },
  async deleteService(serviceId: number): Promise<void> {
    await api.delete(`/services/${serviceId}`)
  },
}
