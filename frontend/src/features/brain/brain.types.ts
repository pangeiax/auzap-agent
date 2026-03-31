import type { BrainStructuredUi } from './parseAssistantStructured'

export interface BrainMessage {
  role: 'user' | 'assistant';
  content: string;
  id: string;
  loading?: boolean;
  /** Resposta estruturada (campanha / agendamento); texto exibível já vem em content sem o JSON. */
  structured?: BrainStructuredUi;
}

export interface BrainAlert {
  type: 'warning' | 'info' | 'critical';
  message: string;
  action?: string;
}
