import {
  OPENAI_RESPONSES_URL,
  extractResponsesAssistantText,
  responsesUserMessage,
} from '../../secondBrain/openaiResponses'
import { BRAIN_ROUTER_HISTORY_LIMIT } from './brainPlanConstants'
import type { BrainChatMode, BrainMessage } from './brain.types'

/**
 * Respostas curtas do tipo “às 10”, “sim”, “pode ser” após o assistente listar horários
 * não contêm palavras-chave de ação; sem isso o roteador manda para SQL e o agendamento quebra.
 */
export function inferActionFromSchedulingFollowUp(message: string, history: BrainMessage[]): boolean {
  const t = message.trim()
  if (t.length > 160) return false

  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant' && (m.content ?? '').trim().length > 0)
  if (!lastAssistant?.content) return false

  const a = lastAssistant.content
  const schedulingCue =
    /hor[áa]rios?|\bvagas\b|dispon[ií]ve|dispon[ií]veis|\bagend|\bmarcar\b|\bslots?\b|escol(h|)a\s+um\s+hor|qual\s+hor/i.test(
      a,
    )
  if (!schedulingCue) return false

  return (
    /^\s*(sim|confirmo|confirmar|pode\s+ser|é\s+esse|esse|essa|ok|fecha|fechado|isso|perfeito)\b/i.test(t) ||
    /\b\d{1,2}\s*[:h]\s*\d{2}\b/i.test(t) ||
    /\b\d{1,2}\s*h\b/i.test(t)
  )
}

/**
 * Após o assistente listar agendamentos (texto ou SQL), pedidos do tipo "cancelar todos" iam parar em SQL
 * e falhavam. Força modo action para usar search_appointments + cancel_appointments_batch (rascunho).
 */
export function inferActionFromAgendaFollowUp(message: string, history: BrainMessage[]): boolean {
  const t = message.trim()
  if (t.length > 240) return false

  const wantsMutation =
    /\bcancel(ar|a|em)?\b|\bdesmarc(ar|a)?\b|\bremarc(ar|a)?\b|\breagendar\b|\banular\b|\bexcluir\s+agend/i.test(t)
  const wantsBulk =
    /\btodos\b|\btodas\b|\bcada\s+um\b|\bos\s+mesmos\b|\besse(s)?\s+agend|\bda\s+lista\b|\bacima\b|\bque\s+voc(ê|e)\s+(mostrou|listou|citou|trouxe)/i.test(
      t,
    ) ||
    /\bcancel(ar|a|em)?\b.*\btodos\b|\btodos\b.*\bcancel/i.test(t) ||
    /\b(eles|elas|esses|essas|os\s+dois|as\s+duas)\b/i.test(t)
  if (!wantsMutation || !wantsBulk) return false

  const lastAssistant = [...history]
    .reverse()
    .find((m) => m.role === 'assistant' && (m.content ?? '').trim().length > 0)
  if (!lastAssistant?.content) return false
  const a = lastAssistant.content
  const hadAgendaContext =
    /\bagendamento/i.test(a) ||
    /petshop_appointments/i.test(a) ||
    /\bSELECT\b/i.test(a) ||
    /\d{1,2}\s+de\s+\w+\s+de\s+\d{4}/i.test(a) ||
    /\d{4}-\d{2}-\d{2}/.test(a)
  return hadAgendaContext
}

/**
 * Após cancelar/remarcar ou falar de cliente, o dono pede "avisar", "mandar mensagem", "informar no WhatsApp".
 * Isso é campanha/rascunho no painel — deve ir para action, não converse.
 */
export function inferActionFromNotifyClientFollowUp(message: string, history: BrainMessage[]): boolean {
  const t = message.trim()
  if (t.length > 320) return false

  const wantsClientMessage =
    /\b(mandar|enviar)\s+mensagem\b/i.test(t) ||
    /\bmensagem\s+(no\s+)?whatsapp\b/i.test(t) ||
    /\bwhatsapp\s+(pra|para|pro|ao|à)\b/i.test(t) ||
    (/\bavis(ar|e)\b/i.test(t) && /\b(ele|ela|eles|elas|cliente|tutor|dono\s+do\s+pet)\b/i.test(t)) ||
    (/\binform(ar|e)\b/i.test(t) &&
      /\b(ele|ela|eles|elas|cliente|tutor|pra\s+ele|pra\s+ela|por\s+favor)\b/i.test(t)) ||
    /\b(contar|comunicar)\s+(pra|para|ao|à)\s+(ele|ela|cliente)\b/i.test(t)

  if (!wantsClientMessage) return false

  const lastAssistant = [...history]
    .reverse()
    .find((m) => m.role === 'assistant' && (m.content ?? '').trim().length > 0)
  if (!lastAssistant?.content) return false
  const a = lastAssistant.content
  const hadRelevantContext =
    /\bcancelamento|\bcancelar|\bagendamento|\bremarca|\bconfirm(ar|e)\s+no\s+botão|rascunho|\bcliente\b|\bserviço\b|\bpet\b/i.test(a)
  return hadRelevantContext
}

function compactHistory(history: BrainMessage[], max: number): BrainMessage[] {
  return history
    .filter((m) => m && typeof m.content === 'string')
    .slice(-max)
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
}

/**
 * Atalho sem LLM: cumprimentos curtos sem pedido de dado ou ação.
 */
export function heuristicBrainMode(message: string): BrainChatMode | null {
  const t = message.trim()
  if (t.length > 120) return null

  const asksData =
    /\b(quantos|quantas|quanto|liste|listar|total|faturamento|receita|ticket|relatório|relatorio|ranking|média|media|estatística|estatistica|últim|ultim|quantidade de|gráfico|grafico|mostrar|exibir|buscar no sistema|dados de)\b/i.test(
      t,
    )
  const asksAction =
    /\b(agendar|agendamento|marcar|cancelar|desmarcar|cancelamento|remarcar|reagendar|em lote|vários agend|varios agend|lista(r)? agend|horário|horarios|disponível|disponiveis|vagas|slot|campanha|cadastrar cliente|criar cliente|novo cliente|reativação|reativacao|mensagem em massa|draft de campanha|horários livres|horarios livres|mandar\s+mensagem|enviar\s+mensagem|whatsapp\s+(pra|para|pro|ao))\b/i.test(
      t,
    )

  if (asksData || asksAction) return null

  const lower = t.toLowerCase().trim()
  // Sem \b no fim: em JS, \b após letras acentuadas quebra ("Olá" virava match de "ola" + lixo).
  const compact = lower.replace(/^[\s,!?.…]+/u, '').replace(/[\s,!?.…]+$/u, '')
  const isGreetingStart =
    /^(oi|olá|ola|hey|hi|hello|bom dia|boa tarde|boa noite|salve)(\s|$|[,!?.…])/i.test(compact) ||
    /^e\s+a[ií]\??$/i.test(compact) ||
    /^e\s+ai\??$/i.test(compact)
  const isThanksStart = /^(obrigad|valeu|thanks|thank you)(\s|$|[,!?.…])/i.test(compact)
  if (isGreetingStart || isThanksStart || /^oi[\s,!.]*pessoal/i.test(lower)) {
    return 'converse'
  }

  return null
}

/** Pedido operacional óbvio — usado quando o classificador LLM falha (evita cair no braço de SQL). */
export function messageLooksLikeBrainAction(message: string): boolean {
  const t = message.trim()
  if (t.length > 2000) return false
  return /\b(agendar|agendamento|marcar|realize|realizar|fazer\s+um\s+agend|cancelar|desmarcar|cancelamento|remarcar|reagendar|em lote|vários agend|varios agend|lista(r)?\s+agend|horário|horarios|disponível|disponiveis|vagas|slot|campanha|cadastrar cliente|criar cliente|novo cliente|reativação|reativacao|mensagem em massa|mandar\s+mensagem|enviar\s+mensagem|whatsapp\s+(pra|para|pro|ao)|horários livres|horarios livres)\b/i.test(
    t,
  )
}

/** Dono citou nome de ferramenta do brain / UUIDs de cliente — deve ir para action, não SQL. */
export function inferActionFromBrainToolCue(message: string): boolean {
  const t = message.trim()
  if (t.length > 8000) return false
  if (/\bget_available_times\b/i.test(t)) return true
  if (
    /\b(search_clients|get_client_pets_for_scheduling|list_active_services|create_appointment_draft|create_manual_appointment|search_appointments|search_lodging_reservations|cancel_appointment|cancel_appointments_batch|reschedule_appointments_batch|create_campaign_draft)\b/i.test(
      t,
    )
  ) {
    return true
  }
  if (/\b(client_id|pet_id)\b\s*[:=]\s*[a-f0-9-]{10,}/i.test(t)) return true
  if (/\btarget_date\b\s*[:=]\s*\d{4}-\d{2}-\d{2}/i.test(t)) return true
  return false
}

/** Pedido explícito de localizar cliente no cadastro (agenda manual). */
export function inferActionFromClientLookup(message: string): boolean {
  const t = message.trim()
  if (t.length > 400) return false
  return /\b(busque|busca|procure|encontre|localize)\s+(o\s+|a\s+)?cliente\b/i.test(t)
}

export async function classifyBrainMode(params: {
  apiKey: string
  model: string
  message: string
  history: BrainMessage[]
  petshopName: string
}): Promise<BrainChatMode> {
  if (inferActionFromSchedulingFollowUp(params.message, params.history)) return 'action'
  if (inferActionFromAgendaFollowUp(params.message, params.history)) return 'action'
  if (inferActionFromNotifyClientFollowUp(params.message, params.history)) return 'action'
  if (inferActionFromBrainToolCue(params.message)) return 'action'
  if (inferActionFromClientLookup(params.message)) return 'action'

  const quick = heuristicBrainMode(params.message)
  if (quick) return quick

  const hist = compactHistory(params.history, BRAIN_ROUTER_HISTORY_LIMIT)
  const histText = hist.map((m) => `${m.role}: ${m.content}`).join('\n')

  const system = `Classifique a intenção da última mensagem do dono do petshop "${params.petshopName}" no painel.

Responda só com JSON: {"mode":"converse"|"sql"|"action"}

- converse: cumprimentos, agradecimentos, despedidas, conversa social, meta ("o que você faz?", "como funciona?"), opinião sem pedir número nem ação no sistema.
- sql: perguntas de dados em leitura — quantos/quem/quanto, listagens, relatórios, faturamento, histórico de clientes/agenda/conversas, estatísticas, rankings. Tudo que exige consultar o banco em SELECT. Não use sql para cancelar, remarcar ou criar agendamento.
- action: operações — agendar manualmente (um ou vários), cancelar ou remarcar agendamentos (um ou em lote), listar agendamentos, ver horários livres, criar cliente, buscar cliente para marcar, campanha de reativação, rascunho de mensagem para vários clientes. Qualquer fluxo que use ferramentas de agendamento ou campanha. Se o dono pedir "cancelar todos" / "cancelar esses" logo após ver uma lista de agendamentos no chat, é action (não sql). Se pedir para **avisar**, **informar**, **mandar mensagem** ou **WhatsApp** a um cliente (sobretudo após cancelamento ou mudança na agenda), é **action** (rascunho de campanha no painel), **não** converse.

Se a mensagem misturar relatório + agendar, prefira action se o foco imediato for agendar; prefira sql se for só análise de dados.`

  const user = `Sua saída deve ser exclusivamente um objeto json com a chave "mode" ("converse", "sql" ou "action").

Histórico recente:
${histText || '(vazio)'}

Última mensagem:
${params.message}`

  const res = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      instructions: system,
      input: [responsesUserMessage(user)],
      temperature: 0,
      max_output_tokens: 80,
      text: { format: { type: 'json_object' } },
      store: false,
    }),
  })

  if (!res.ok) {
    return messageLooksLikeBrainAction(params.message) ? 'action' : 'sql'
  }

  const data = (await res.json()) as { output?: unknown[]; output_text?: string }
  const raw = extractResponsesAssistantText(data)
  try {
    const parsed = JSON.parse(raw) as { mode?: string }
    if (parsed.mode === 'converse' || parsed.mode === 'sql' || parsed.mode === 'action') {
      return parsed.mode
    }
  } catch {
    /* fallback */
  }
  return messageLooksLikeBrainAction(params.message) ? 'action' : 'sql'
}
