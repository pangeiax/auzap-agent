export type BrainChatMode = 'converse' | 'sql' | 'action'

export interface BrainMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface BrainDailyUsageMeta {
  /** Mensagens já contadas hoje após esta requisição (quando aplicável). */
  used: number
  limit: number
}

export interface BrainMeta {
  /** Roteamento da última mensagem (debug / UX). */
  mode?: BrainChatMode
  /** SQL executada após validação (somente leitura). Omitida se SECOND_BRAIN_EXPOSE_SQL=0 */
  sql?: string
  /** Uso do limite diário de mensagens ao assistente (plano Pro). */
  brainDaily?: BrainDailyUsageMeta
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
