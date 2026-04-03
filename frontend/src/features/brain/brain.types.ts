import type { BrainStructuredUi } from './parseAssistantStructured'

export interface BrainMessage {
  role: 'user' | 'assistant'
  content: string
  id: string
  loading?: boolean
  structured?: BrainStructuredUi
  /** SQL executada no backend (somente leitura), quando exposta pela API */
  sqlExecuted?: string
}

export interface BrainAlert {
  type: 'warning' | 'info' | 'critical'
  message: string
  action?: string
}

export type BrainChatMode = 'converse' | 'sql' | 'action'

export interface BrainChatMeta {
  mode?: BrainChatMode
  sql?: string
}
