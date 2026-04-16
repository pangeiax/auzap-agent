export interface ChatMessage {
  id: string
  conversation_id: string
  client_id: string
  sender: 'user' | 'assistant' | 'system'
  message_content: string
  metadata?: Record<string, unknown>
  created_at: string
}

export interface Conversation {
  id?: string
  conversation_id?: string
  client_id: string
  client_name?: string
  client_phone?: string
  client_manual_phone?: string | null
  started_at: string
  last_message_at: string
  message_count: number
  stage?: string
  kanban_column?: string
  specialty_detected?: string
  ai_paused?: boolean
  is_ai_paused?: boolean
}

export interface ConversationDetail {
  conversation_id: string
  client_id: string
  client_name?: string
  client_phone?: string
  client_manual_phone?: string | null
  messages: ChatMessage[]
  stage?: string
  specialty_detected?: string
  total_messages: number
}

export interface ConversationAnalysis {
  conversation_id: string
  sentiment: string
  urgency_level: string
  topics: string[]
  suggested_actions: string[]
  summary: string
}

export interface SendMessageRequest {
  message: string
  sender?: 'user' | 'assistant' | 'staff'
  metadata?: Record<string, unknown>
}

export interface ConversationFilters {
  client_id?: string
  stage?: string
  ai_paused?: boolean
  is_ai_paused?: boolean
  start_date?: string
  end_date?: string
  limit?: number
  offset?: number
}
