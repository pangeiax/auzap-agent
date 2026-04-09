import { api } from '@/lib/api'
import { normalizePhoneForStorage } from '@/lib/masks'
import type {
  Client,
  ClientCreate,
  ClientUpdate,
  ClientDetails,
  ClientContext,
  Pet,
  ActivityResponse,
  ImportResponse,
} from '@/types'
import type { PaginatedResponse } from '@/types/api'

export const clientService = {
  async listClients(params?: {
    search?: string
    is_active?: boolean
    stage?: string
    limit?: number
    offset?: number
  }): Promise<Client[]> {
    const response = await api.get<Client[]>('/clients', { params })
    return response.data
  },

  async searchClients(query: string, limit = 10): Promise<Client[]> {
    const response = await api.get<Client[]>('/clients/search', {
      params: { q: query, limit },
    })
    return response.data
  },

  async getClientDetails(clientId: string): Promise<ClientDetails> {
    const response = await api.get<ClientDetails>(`/clients/${clientId}`)
    return response.data
  },

  async createClient(clientData: ClientCreate): Promise<Client> {
    const payload = {
      ...clientData,
      phone: normalizePhoneForStorage(clientData.phone),
    }

    const response = await api.post<Client>('/clients', payload)
    return response.data
  },

  async updateClient(
    clientId: string,
    updates: ClientUpdate
  ): Promise<Client> {
    const payload = {
      ...updates,
      ...(updates.phone
        ? { phone: normalizePhoneForStorage(updates.phone) }
        : {}),
    }

    const response = await api.put<Client>(
      `/clients/${clientId}`,
      payload
    )
    return response.data
  },

  async deleteClient(clientId: string): Promise<{
    success: boolean
    client_id: string
  }> {
    const response = await api.delete<{
      success: boolean
      client_id: string
    }>(`/clients/${clientId}`)
    return response.data
  },

  /** Liga o `phone` (WhatsApp/LID) do cliente não cadastrado ao cliente destino e remove o duplicado. */
  async syncUnregisteredWhatsapp(
    sourceClientId: string,
    targetClientId: string,
  ): Promise<Client> {
    const response = await api.post<{ success: boolean; client: Client }>(
      `/clients/${sourceClientId}/sync-whatsapp`,
      { target_client_id: targetClientId },
    )
    return response.data.client
  },

  async getClientConversations(
    clientId: string,
    limit = 50,
    offset = 0
  ): Promise<{
    client_id: string
    conversations: Array<{
      conversation_id: string
      message_count: number
      started_at: string
      last_message_at: string
      stage?: string
      specialty_detected?: string
    }>
    total: number
  }> {
    const response = await api.get(
      `/clients/${clientId}/conversations`,
      { params: { limit, offset } }
    )
    return response.data
  },

  async getClientPets(
    clientId: string,
    petshopId?: number
  ): Promise<Pet[]> {
    const response = await api.get<Pet[]>(`/clients/${clientId}/pets`, {
      params: petshopId ? { petshop_id: petshopId } : {},
    })
    return response.data
  },

  async getClientContext(clientId: string): Promise<ClientContext> {
    const response = await api.get<ClientContext>(
      `/clients/${clientId}/context`
    )
    return response.data
  },

  async getClientActivities(
    clientId: string,
    params?: {
      limit?: number
      offset?: number
      activity_type?: string
    }
  ): Promise<ActivityResponse[]> {
    const response = await api.get<ActivityResponse[]>(
      `/clients/${clientId}/activities`,
      { params }
    )
    return response.data
  },

  async importClients(file: File): Promise<ImportResponse> {
    const formData = new FormData()
    formData.append('file', file)

    const response = await api.post<ImportResponse>(
      '/clients/import',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    )
    return response.data
  },
}
