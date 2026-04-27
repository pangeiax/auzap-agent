import { api } from '@/lib/api'

function getDevToolsKey(): string {
  return localStorage.getItem('dev-tool') || ''
}

function headers() {
  return { 'x-dev-tools-key': getDevToolsKey() }
}

export interface DevToolsCompany {
  id: number
  name: string
  slug: string
  plan: string | null
  isActive: boolean | null
  createdAt: string | null
  users: {
    id: number
    name: string
    email: string
    role: string | null
    isActive: boolean | null
    createdAt: string | null
    lastLogin: string | null
  }[]
  petshopProfile: {
    id: number
    phone: string
    isActive: boolean | null
    assistantName: string | null
  } | null
}

export interface CreatePetshopPayload {
  companyName: string
  companySlug: string
  companyPlan: string
  userName: string
  userEmail: string
  userPassword: string
  userRole: string
  phone: string
}

export const devToolsService = {
  async listPetshops(): Promise<DevToolsCompany[]> {
    const res = await api.get('/dev-tools/petshops', { headers: headers() })
    return res.data
  },

  async createPetshop(data: CreatePetshopPayload) {
    const res = await api.post('/dev-tools/petshops', data, { headers: headers() })
    return res.data
  },

  async updatePassword(userId: number, newPassword: string) {
    const res = await api.patch(`/dev-tools/users/${userId}/password`, { newPassword }, { headers: headers() })
    return res.data
  },

  async updateEmail(userId: number, newEmail: string) {
    const res = await api.patch(`/dev-tools/users/${userId}/email`, { newEmail }, { headers: headers() })
    return res.data
  },
}
