/**
 * Client types and interfaces
 */

export interface CreateClientDTO {
  phone: string
  manualPhone?: string
  name?: string
  email?: string
  companyName?: string
  conversationStage?: string
  notes?: string
}

export interface UpdateClientDTO {
  phone?: string
  manualPhone?: string
  name?: string
  email?: string
  companyName?: string
  conversationStage?: string
  notes?: string
  isActive?: boolean
  aiPaused?: boolean
  aiPauseReason?: string
}

export interface ClientListQuery {
  search?: string
  is_active?: string
  stage?: string
  limit?: number
  offset?: number
}

export interface ClientSearchQuery {
  q: string
  limit?: number
}
