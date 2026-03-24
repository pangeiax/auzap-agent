export interface BrainMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface BrainRequest {
  message: string;
  history: BrainMessage[];
}

export interface BrainResponse {
  reply: string;
  alerts: BrainAlert[];
}

export interface BrainAlert {
  type: 'warning' | 'info' | 'critical';
  message: string;
  action?: string;
}

export interface BrainContext {
  petshop_name: string;
  assistant_name: string;
  plan: string;
  today: string;
  appointments_today_total: number;
  appointments_today_confirmed: number;
  appointments_today_pending: number;
  revenue_today: number;
  revenue_this_week: number;
  revenue_today_vs_yesterday_pct: number | null;
  active_clients: number;
  lost_clients_count: number;
  whatsapp_conversion_rate: number;
  alerts: BrainAlert[];
}
