import type { BrainStructuredUi } from './parseAssistantStructured'

export interface BrainMessage {
  role: 'user' | 'assistant'
  content: string
  id: string
  loading?: boolean
  /** Um cartão ou vários (ex.: cancelamento em lote + rascunho de campanha). */
  structured?: BrainStructuredUi | BrainStructuredUi[]
  /** SQL executada no backend (somente leitura), quando exposta pela API */
  sqlExecuted?: string
}

export interface BrainAlert {
  type: 'warning' | 'info' | 'critical'
  message: string
  action?: string
}

export type BrainChatMode = 'converse' | 'sql' | 'action'

export interface BrainDailyUsageMeta {
  used: number
  limit: number
}

export interface BrainChatMeta {
  mode?: BrainChatMode
  sql?: string
  brainDaily?: BrainDailyUsageMeta
}

export interface BrainDailyUsageResponse {
  enabled: boolean
  used: number
  limit: number
}
