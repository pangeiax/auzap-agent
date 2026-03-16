/**
 * Conversation types and interfaces
 */

export interface SendMessageDTO {
  role: 'user' | 'assistant'
  content: string
}

export interface ToggleAIDTO {
  ai_paused: boolean
  ai_pause_reason?: string
}

export interface ConversationListQuery {
  client_id?: string
  status?: string
  limit?: number
  offset?: number
}

export interface SearchMessagesQuery {
  q: string
  client_id?: string
  limit?: number
}
