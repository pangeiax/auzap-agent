export interface BrainMessage {
  role: 'user' | 'assistant';
  content: string;
  id: string;
  loading?: boolean;
}

export interface BrainAlert {
  type: 'warning' | 'info' | 'critical';
  message: string;
  action?: string;
}
