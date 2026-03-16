import { api } from '@/lib/api'
import type {
  Conversation,
  ConversationDetail,
  ConversationAnalysis,
  ChatMessage,
  SendMessageRequest,
  ConversationFilters,
} from '@/types'

export const conversationService = {
  async listConversations(
    filters?: ConversationFilters
  ): Promise<Conversation[]> {
    const response = await api.get<Conversation[]>('/conversations', {
      params: filters,
    })
    return response.data
  },
  async getConversation(
    conversationId: string,
    params?: {
      limit?: number
      offset?: number
    }
  ): Promise<ConversationDetail> {
    const response = await api.get<ConversationDetail>(
      `/conversations/${conversationId}`,
      { params }
    )
    return response.data
  },
  async getMessages(
    conversationId: string,
    params?: { limit?: number; offset?: number }
  ): Promise<any[]> {
    const response = await api.get<any[]>(
      `/conversations/${conversationId}/messages`,
      { params }
    )
    return response.data
  },
  async sendMessage(
    conversationId: string,
    messageData: SendMessageRequest
  ): Promise<ChatMessage> {
    const response = await api.post<ChatMessage>(
      `/conversations/${conversationId}/message`,
      messageData
    )
    return response.data
  },
  async getAnalysis(conversationId: string): Promise<ConversationAnalysis> {
    const response = await api.get<ConversationAnalysis>(
      `/conversations/${conversationId}/analysis`
    )
    return response.data
  },
  async toggleAI(
    conversationId: string,
    pause: boolean,
    reason?: string
  ): Promise<{ success: boolean; ai_paused: boolean }> {
    const response = await api.put(`/conversations/${conversationId}/toggle-ai`, {
      ai_paused: pause,
      ai_pause_reason: reason,
    })
    return response.data
  },
  async getClientConversations(
    clientId: string,
    params?: {
      limit?: number
      offset?: number
    }
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
      { params }
    )
    return response.data
  },
  async updateStage(
    conversationId: string,
    kanban_column: string
  ): Promise<{ success: boolean; kanban_column: string }> {
    const response = await api.put(`/conversations/${conversationId}/stage`, {
      kanban_column,
    })
    return response.data
  },
  async searchMessages(
    query: string,
    params?: {
      client_id?: string
      limit?: number
    }
  ): Promise<ChatMessage[]> {
    const response = await api.get<ChatMessage[]>('/conversations/search', {
      params: { q: query, ...params },
    })
    return response.data
  },
}
