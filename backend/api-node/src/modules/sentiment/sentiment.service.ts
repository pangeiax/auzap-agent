import { prisma } from '../../lib/prisma'
import type { SentimentResult } from './sentiment.types'

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const SENTIMENT_MODEL = 'gpt-4o-mini'

const SYSTEM_PROMPT = `Você é um analista de relacionamento com clientes de petshops.
Analise as mensagens abaixo e retorne SOMENTE um JSON válido, sem texto antes ou depois, sem markdown, sem blocos de código.

O JSON deve ter exatamente esta estrutura:
{
  "sentimento_geral": "positivo" | "neutro" | "negativo",
  "tom_cliente": string (ex: "amigável", "irritado", "ansioso", "satisfeito", "neutro", "impaciente"),
  "risco_churn": "baixo" | "medio" | "alto",
  "motivo_principal": string (máx 100 caracteres),
  "pontos_criticos": string[] (máx 5 itens, cada um com máx 60 caracteres),
  "qualidade_atendimento": "ótimo" | "bom" | "regular" | "ruim"
}

Considere apenas o comportamento e tom do CLIENTE nas mensagens. Ignore as mensagens do assistente para avaliar o tom, mas use-as para avaliar a qualidade do atendimento.`

export class SentimentService {
  async hasAnalysisThisMonth(companyId: number, clientId: string): Promise<boolean> {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)

    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM client_sentiment_analysis
      WHERE company_id = ${companyId}
        AND client_id = ${clientId}::uuid
        AND analyzed_month >= ${startOfMonth.toISOString().slice(0, 10)}::date
      LIMIT 1
    `
    return rows.length > 0
  }

  async getClientSentimentStatus(companyId: number, clientId: string) {
    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT id, analyzed_at, sentimento_geral, tom_cliente, risco_churn,
             motivo_principal, pontos_criticos, qualidade_atendimento, messages_analyzed
      FROM client_sentiment_analysis
      WHERE company_id = ${companyId}
        AND client_id = ${clientId}::uuid
      ORDER BY analyzed_at DESC
      LIMIT 1
    `
    const data = rows[0] ?? null

    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)

    const analyzedThisMonth = data ? new Date(data.analyzed_at) >= startOfMonth : false

    return {
      has_analysis: !!data,
      analyzed_this_month: analyzedThisMonth,
      latest: data ?? null,
    }
  }

  async getLastMessages(companyId: number, clientId: string, limit = 25) {
    const conversations = await prisma.agentConversation.findMany({
      where: { companyId, clientId },
      select: { id: true },
    })

    if (!conversations.length) return []

    const conversationIds = conversations.map((c) => c.id)

    const messages = await prisma.agentMessage.findMany({
      where: { conversationId: { in: conversationIds } },
      select: { role: true, content: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return messages.reverse()
  }

  async analyzeWithOpenAI(messages: { role: string; content: string }[]): Promise<SentimentResult> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY não configurada')

    const transcript = messages
      .map((m) => `[${m.role === 'user' ? 'CLIENTE' : 'ASSISTENTE'}]: ${m.content}`)
      .join('\n')

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: SENTIMENT_MODEL,
        max_tokens: 500,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Mensagens do cliente:\n\n${transcript}` },
        ],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`OpenAI API error: ${err}`)
    }

    const json = await response.json()
    const content = json.choices?.[0]?.message?.content ?? ''
    const resolvedModel = (json.model as string | undefined) ?? SENTIMENT_MODEL
    console.log(
      `[Sentiment] LLM | model_requested=${SENTIMENT_MODEL} | model_response=${resolvedModel}`
    )
    const clean = content.replace(/```json|```/g, '').trim()
    const result: SentimentResult = JSON.parse(clean)

    return result
  }

  async analyzeClient(companyId: number, clientId: string, conversationId?: string) {
    const alreadyDone = await this.hasAnalysisThisMonth(companyId, clientId)
    if (alreadyDone) {
      throw Object.assign(new Error('Este cliente já foi analisado este mês.'), { statusCode: 429 })
    }

    const messages = await this.getLastMessages(companyId, clientId, 25)
    if (messages.length < 3) {
      throw Object.assign(
        new Error('Mensagens insuficientes para análise (mínimo 3).'),
        { statusCode: 422 }
      )
    }

    const result = await this.analyzeWithOpenAI(messages)

    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)
    const analyzedMonth = startOfMonth.toISOString().slice(0, 10)

    try {
      const convIdParam = conversationId ?? null
      const rows = await prisma.$queryRaw<Array<any>>`
        INSERT INTO client_sentiment_analysis
          (company_id, client_id, conversation_id, analyzed_month, messages_analyzed,
           sentimento_geral, tom_cliente, risco_churn, motivo_principal,
           pontos_criticos, qualidade_atendimento, raw_response)
        VALUES (
          ${companyId},
          ${clientId}::uuid,
          ${convIdParam}::uuid,
          ${analyzedMonth}::date,
          ${messages.length},
          ${result.sentimento_geral},
          ${result.tom_cliente},
          ${result.risco_churn},
          ${result.motivo_principal},
          ${JSON.stringify(result.pontos_criticos)}::jsonb,
          ${result.qualidade_atendimento},
          ${JSON.stringify(result)}::jsonb
        )
        RETURNING *
      `
      return rows[0]
    } catch (err: any) {
      // Prisma raw query unique violation
      if (err?.meta?.code === '23505' || err?.code === 'P2002') {
        throw Object.assign(new Error('Este cliente já foi analisado este mês.'), { statusCode: 429 })
      }
      throw err
    }
  }

  async getSentimentKpi(companyId: number) {
    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT *
      FROM dashboard_sentiment_kpi
      WHERE company_id = ${companyId}
      ORDER BY month DESC
      LIMIT 1
    `
    const data = rows[0] ?? null

    return {
      total_analyzed: Number(data?.total_analyzed ?? 0),
      positive: Number(data?.positive ?? 0),
      neutral: Number(data?.neutral ?? 0),
      negative: Number(data?.negative ?? 0),
      high_churn_risk: Number(data?.high_churn_risk ?? 0),
      medium_churn_risk: Number(data?.medium_churn_risk ?? 0),
      positive_pct: Number(data?.positive_pct ?? 0),
    }
  }
}
