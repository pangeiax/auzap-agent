export type ChatRole = 'system' | 'user' | 'assistant'

export interface AnalyticsBrainMessage {
  role: ChatRole
  content: string
}

export type SqlValidationOk = { ok: true; normalizedSql: string }

export type SqlValidationErr = { ok: false; code: string; message: string }

export type SqlValidationResult = SqlValidationOk | SqlValidationErr

export interface AnalyticsBrainMeta {
  sql?: string
}

export interface AnalyticsBrainResult {
  reply: string
  meta?: AnalyticsBrainMeta
}
