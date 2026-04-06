import { api } from '@/lib/api'
import type { BrainAlert, BrainChatMeta, BrainDailyUsageResponse } from './brain.types'

export async function fetchBrainSuggestions(): Promise<string[]> {
  const { data } = await api.get<{ suggestions: string[] }>('/brain/suggestions')
  return Array.isArray(data.suggestions) ? data.suggestions : []
}

export async function fetchBrainUsage(): Promise<BrainDailyUsageResponse> {
  const { data } = await api.get<BrainDailyUsageResponse>('/brain/usage')
  return data
}

export async function sendBrainMessage(
  message: string,
  history: { role: string; content: string }[]
): Promise<{ reply: string; alerts: BrainAlert[]; meta?: BrainChatMeta }> {
  const { data } = await api.post('/brain/chat', { message, history })
  return data
}
