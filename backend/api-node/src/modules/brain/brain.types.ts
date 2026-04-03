export type BrainChatMode = 'converse' | 'sql' | 'action'

export interface BrainMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface BrainMeta {
  /** Roteamento da última mensagem (debug / UX). */
  mode?: BrainChatMode
  /** SQL executada após validação (somente leitura). Omitida se SECOND_BRAIN_EXPOSE_SQL=0 */
  sql?: string
}

export interface BrainResponse {
  reply: string
  alerts: BrainAlert[]
  meta?: BrainMeta
}

export interface BrainAlert {
  type: 'warning' | 'info' | 'critical'
  message: string
  action?: string
}
