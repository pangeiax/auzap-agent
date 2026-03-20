export interface SentimentResult {
  sentimento_geral: 'positivo' | 'neutro' | 'negativo';
  tom_cliente: string;
  risco_churn: 'baixo' | 'medio' | 'alto';
  motivo_principal: string;
  pontos_criticos: string[];
  qualidade_atendimento: 'ótimo' | 'bom' | 'regular' | 'ruim';
}

export interface SentimentRecord {
  id: string;
  client_id: string;
  company_id: number;
  analyzed_at: string;
  analyzed_month: string;
  messages_analyzed: number;
  sentimento_geral: string;
  tom_cliente: string;
  risco_churn: string;
  motivo_principal: string;
  pontos_criticos: string[];
  qualidade_atendimento: string;
  raw_response: SentimentResult;
}

export interface SentimentKpi {
  month: string;
  total_analyzed: number;
  positive: number;
  neutral: number;
  negative: number;
  high_churn_risk: number;
  medium_churn_risk: number;
  positive_pct: number;
}
