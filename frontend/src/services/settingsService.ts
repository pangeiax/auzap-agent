import { api } from '@/lib/api'

export const settingsService = {
  async generateSlots(days = 30): Promise<{
    success: boolean
    slots_created: number
    days_requested: number
    days_generated: number
    warning?: string
    period: { from: string; to: string }
  }> {
    const res = await api.post('/settings/generate-slots', { days })
    return res.data
  },
}
