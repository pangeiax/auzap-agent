import { api } from '@/lib/api'
import type {
  Service,
  ServiceCreate,
  ServiceUpdate,
  ServiceFilters,
} from '@/types'

export const serviceService = {
  async listServices(filters?: ServiceFilters): Promise<Service[]> {
    const response = await api.get<Service[]>('/services', {
      params: filters,
    })
    return response.data
  },
  async getService(serviceId: number): Promise<Service> {
    const response = await api.get<Service>(`/services/${serviceId}`)
    return response.data
  },
  async createService(serviceData: ServiceCreate): Promise<Service> {
    const response = await api.post<Service>('/services', serviceData)
    return response.data
  },
  async updateService(
    serviceId: number,
    updates: ServiceUpdate
  ): Promise<Service> {
    const response = await api.put<Service>(
      `/services/${serviceId}`,
      updates
    )
    return response.data
  },
  async deleteService(serviceId: number): Promise<void> {
    await api.delete(`/services/${serviceId}`)
  },
}
