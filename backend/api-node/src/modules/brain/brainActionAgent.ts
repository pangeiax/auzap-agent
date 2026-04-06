import { getBrainDateContextPromptLine } from '../../secondBrain/clockContext'
import {
  OPENAI_RESPONSES_URL,
  chatFunctionToolsToResponsesTools,
  extractResponsesAssistantText,
  extractResponsesFunctionCalls,
  responsesChatMessage,
  type ChatStyleFunctionTool,
} from '../../secondBrain/openaiResponses'
import { sanitizeAssistantHistoryContent, sanitizeUserFacingReply } from '../../secondBrain/sanitize'
import { BRAIN_ACTION_HISTORY_LIMIT } from './brainPlanConstants'
import { ACTION_BRAIN_TOOLS, executeActionBrainTool } from './brainActionTools'
import type { BrainMessage } from './brain.types'

const MAX_TOOL_STEPS = 12

const RESPONSE_TOOLS = chatFunctionToolsToResponsesTools(ACTION_BRAIN_TOOLS as unknown as ChatStyleFunctionTool[])

function tryParseStructuredUiPayload(toolOutput: string): string | null {
  const trimmed = toolOutput.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const p = JSON.parse(trimmed) as { type?: string }
    if (
      p.type === 'campaign_draft' ||
      p.type === 'appointment_created' ||
      p.type === 'appointment_draft' ||
      p.type === 'manual_schedule_draft' ||
      p.type === 'manual_schedule_batch_draft' ||
      p.type === 'cancel_appointment_draft' ||
      p.type === 'cancel_appointments_batch_draft' ||
      p.type === 'reschedule_appointments_batch_draft'
    ) {
      return JSON.stringify(p)
    }
  } catch {
    return null
  }
  return null
}

type CampaignDraftClientJson = { id: string; name?: string; manual_phone?: string; phone?: string }

type CampaignDraftJson = {
  type: string
  clients?: CampaignDraftClientJson[]
  message?: string
  /** Quando o texto varia por destinatário (ex.: várias create_campaign_draft no mesmo turno). */
  per_client_messages?: Record<string, string>
  total?: number
  max_recipients_per_send?: number
}

function isCampaignDraftLine(jsonLine: string): boolean {
  try {
    const p = JSON.parse(jsonLine) as { type?: string }
    return p.type === 'campaign_draft'
  } catch {
    return false
  }
}

/** appointment_draft | manual_schedule_draft | manual_schedule_batch_draft — fundir no mesmo turno (várias tools). */
function isSchedulableDraftJsonLine(jsonLine: string): boolean {
  try {
    const p = JSON.parse(jsonLine) as { type?: string }
    return (
      p.type === 'appointment_draft' ||
      p.type === 'manual_schedule_draft' ||
      p.type === 'manual_schedule_batch_draft'
    )
  } catch {
    return false
  }
}

function schedulingToolJsonToItems(jsonStr: string): Record<string, unknown>[] {
  let p: Record<string, unknown>
  try {
    p = JSON.parse(jsonStr) as Record<string, unknown>
  } catch {
    return []
  }
  const t = String(p.type ?? '')
  if (t === 'manual_schedule_batch_draft' && Array.isArray(p.items)) {
    return p.items as Record<string, unknown>[]
  }
  if (t === 'manual_schedule_draft') {
    const { type: _ty, ...rest } = p
    return [rest]
  }
  if (t === 'appointment_draft') {
    const sd = String(p.scheduled_date ?? '')
    const tm = String(p.time ?? '')
    return [
      {
        client_id: p.client_id,
        client_name: p.client_name,
        pet_id: p.pet_id,
        pet_name: p.pet_name,
        service_id: p.service_id,
        service_name: p.service_name != null && String(p.service_name).trim() !== '' ? String(p.service_name) : 'Serviço',
        slot_id: p.slot_id,
        scheduled_date: sd,
        time: tm,
        scheduled_at: `${sd}T${tm}:00`,
        notes: p.notes ?? null,
      },
    ]
  }
  return []
}

function mergeScheduleDraftLines(previous: string, incoming: string): string {
  const items = [...schedulingToolJsonToItems(previous), ...schedulingToolJsonToItems(incoming)]
  return JSON.stringify({ type: 'manual_schedule_batch_draft', items })
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function messagesByClientFromDraft(d: CampaignDraftJson): Record<string, string> {
  const base = String(d.message ?? '').trim()
  const fromMap = d.per_client_messages ?? {}
  const out: Record<string, string> = {}
  for (const c of d.clients ?? []) {
    if (!c?.id) continue
    const spec = fromMap[c.id]
    out[c.id] = spec != null && String(spec).trim() !== '' ? String(spec).trim() : base
  }
  for (const [id, text] of Object.entries(fromMap)) {
    if (id && String(text).trim() !== '') out[id] = String(text).trim()
  }
  return out
}

/** Várias chamadas create_campaign_draft no mesmo turno sobrescreviam o cartão — funde clientes e preserva texto por destinatário quando diferir. */
function mergeCampaignDraftLines(previous: string | null, incoming: string): string {
  if (!previous) return incoming
  let p: CampaignDraftJson
  let n: CampaignDraftJson
  try {
    p = JSON.parse(previous) as CampaignDraftJson
    n = JSON.parse(incoming) as CampaignDraftJson
  } catch {
    return incoming
  }
  if (p.type !== 'campaign_draft' || n.type !== 'campaign_draft') return incoming

  const byId = new Map<string, CampaignDraftClientJson>()
  for (const c of p.clients ?? []) {
    if (c?.id) byId.set(c.id, c)
  }
  for (const c of n.clients ?? []) {
    if (c?.id) byId.set(c.id, c)
  }
  const clients = [...byId.values()]

  const mapP = messagesByClientFromDraft(p)
  const mapN = messagesByClientFromDraft(n)
  const mergedMap: Record<string, string> = { ...mapP, ...mapN }
  for (const c of clients) {
    if (!mergedMap[c.id]) mergedMap[c.id] = String(n.message ?? p.message ?? '').trim()
  }

  const uniqueVals = [...new Set(Object.values(mergedMap).filter((x) => x && x.trim()))]
  let message = uniqueVals.length === 1 ? uniqueVals[0]! : (mergedMap[clients[0]?.id ?? ''] ?? uniqueVals[0] ?? '')

  if (clients.length > 1 && uniqueVals.length === 1) {
    const names = clients.map((c) => (c.name ?? '').trim()).filter((x) => x.length >= 2)
    for (const nm of names) {
      message = message.replace(new RegExp(`Olá\\s+${escapeRegex(nm)}\\s*,`, 'gi'), 'Olá,')
    }
    message = message.replace(/^Olá\s+[^,\n]+,?\s*/i, 'Olá, ')
  }

  const per_client_messages = uniqueVals.length <= 1 ? undefined : mergedMap

  return JSON.stringify({
    type: 'campaign_draft',
    clients,
    message,
    ...(per_client_messages ? { per_client_messages } : {}),
    total: clients.length,
    max_recipients_per_send: n.max_recipients_per_send ?? p.max_recipients_per_send,
  })
}

function buildHistoryMessages(history: BrainMessage[], max: number): Array<{ role: 'user' | 'assistant'; content: string }> {
  return history
    .filter((m) => m && typeof m.content === 'string')
    .slice(-max)
    .map((m): { role: 'user' | 'assistant'; content: string } => {
      const role: 'user' | 'assistant' = m.role === 'assistant' ? 'assistant' : 'user'
      const content = role === 'assistant' ? sanitizeAssistantHistoryContent(m.content) : m.content
      return { role, content }
    })
    .filter((m) => m.content.length > 0)
}

export async function runBrainActionAgent(params: {
  apiKey: string
  model: string
  companyId: number
  petshopName: string
  assistantName: string
  message: string
  history: BrainMessage[]
}): Promise<{ reply: string }> {
  const hist = buildHistoryMessages(params.history, BRAIN_ACTION_HISTORY_LIMIT)

  const system = `Você é ${params.assistantName}, assistente do petshop ${params.petshopName} no painel do dono.
${getBrainDateContextPromptLine()}

Você ajuda com operações: agendamento manual (buscar cliente, pets, serviços, horários livres, confirmar e criar), listar/cancelar/remarcar agendamentos (incluindo em lote), cadastro de cliente, e rascunho de campanha (WhatsApp — o dono confirma no painel).

Regras:
- Use as ferramentas; não invente UUIDs. Cliente: search_clients. Pets: get_client_pets_for_scheduling devolve JSON type pets_catalog com pets[{id,name,...}] — em toda chamada seguinte envie pet_id desse JSON e pet_name igual ao name (o servidor corrige UUID errado pelo nome+cliente). Serviços: list_active_services → services_catalog; id + service_name nos próximos passos.
- Telefone com DDI em dígitos (ex.: 5511999999999).
- Fluxo de agendamento: list_active_services → get_available_times → create_appointment_draft (preferido) ou create_manual_appointment; em ambos o painel só grava após o dono confirmar no botão. Nunca diga que o agendamento já foi criado antes da confirmação. **Vários agendamentos de uma vez:** prefira **uma** chamada create_manual_appointments_batch com todos os items; se usar create_appointment_draft ou create_manual_appointment **mais de uma vez** no mesmo pedido, o painel junta os rascunhos num único lote com checkboxes (como cancelamento/remarcação).
- Vários / cancelar / remarcar: rascunhos só após tools; use **somente** appointment_id de search_appointments. Se a busca vier vazia ou a tool devolver **só texto de erro** (sem JSON de rascunho), explique ao dono e **não** invente UUIDs nem envie JSON de cancel_appointments_batch_draft / reschedule_appointments_batch_draft.
- **Hotel e creche (hospedagem):** não é possível agendar pelo chat. Você pode listar reservas existentes com search_lodging_reservations. Para **nova reserva**, **disponibilidade/vagas** ou alterações na hospedagem, diga sempre ao dono para abrir a **guia Hospedagem** (hotel/creche) no sistema — lá ele faz o agendamento completo.
- **Cancelar dois ou mais agendamentos de uma vez:** use **uma única** chamada cancel_appointments_batch com appointment_ids (array com todos os UUID de search_appointments). **Nunca** coloque vários objetos JSON cancel_appointment_draft na mesma mensagem (isso quebra o painel). O texto ao dono fica amigável; o JSON de rascunho é **um só** (cancel_appointments_batch_draft ou um único cancel_appointment_draft se for só um).
- Linguagem obrigatória: enquanto existir cartão de confirmação (qualquer type *_draft ou campaign_draft), **proibido** afirmar "já cancelamos", "cancelados com sucesso", "já enviei", "mensagem enviada", "feito" ou "concluído". Diga que preparou o rascunho e que o dono deve **confirmar no botão abaixo** para aplicar ou enviar.
- O histórico do chat não guarda slot_id: use scheduled_date + time (HH:MM) + ids corretos; o servidor resolve o slot.
- **Campanha WhatsApp:** uma única create_campaign_draft com todos os client_ids (nunca duas chamadas seguidas). **message_template** é **uma** mensagem para todos — **sem** marcadores entre chaves duplas no texto (isso quebra ou vaza no WhatsApp). Se forem **2+ tutores** e o tema for **novo agendamento, remarcação ou cancelamento**, o texto deve ser **genérico**: sem pet, data, hora ou detalhe que seja só de um cliente. Use saudação neutra (ex.: «Olá,» ou «Olá!») e corpo igual para todos. Detalhes diferentes por pessoa → uma campanha por cliente ou só um client_id. Resposta **curta** ao dono. **É proibido** dizer que você "não envia mensagens aos clientes": o envio é ao confirmar no painel.
- Para campanhas em geral: create_campaign_draft — WhatsApp só após confirmar no painel. Nunca diga que a mensagem já foi entregue antes desse passo.
- Responda ao dono em português brasileiro, caloroso e objetivo. Não cite nomes internos das ferramentas.
- Listagens de clientes: use apenas o campo manual_phone para mostrar telefone; se vier vazio, diga «Numero nao identificado»; nunca repasse o campo phone ao usuário como número de exibição.
- Quando qualquer tool retornar JSON com "type" campaign_draft, appointment_draft, manual_schedule_draft, manual_schedule_batch_draft, cancel_appointment_draft, cancel_appointments_batch_draft ou reschedule_appointments_batch_draft, copie esse objeto JSON inteiro (uma linha, sem markdown) ao final da sua mensagem, depois do texto amigável, para o painel exibir o cartão. **Não** copie JSON de rascunho se a tool só retornou mensagem de erro em texto. appointment_created só se no futuro existir fluxo sem cartão.`

  const input: unknown[] = [
    ...hist.map((m) => responsesChatMessage(m.role, m.content)),
    responsesChatMessage('user', params.message),
  ]

  let lastStructuredLine: string | null = null
  let steps = 0

  while (steps < MAX_TOOL_STEPS) {
    steps += 1

    let res: Response
    try {
      res = await fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: params.model,
          instructions: system,
          input,
          tools: RESPONSE_TOOLS,
          tool_choice: 'auto',
          temperature: 0.2,
          max_output_tokens: 1200,
          store: false,
        }),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[BrainActionAgent] fetch failed:', msg)
      return {
        reply: `Não consegui concluir agendamento/cancelamento/campanha agora (rede: não foi possível chamar a API de IA — ${msg.slice(0, 120)}). Em Docker, verifique DNS, firewall e se o container alcança https://api.openai.com.`,
      }
    }

    if (!res.ok) {
      const t = await res.text()
      const status = res.status
      let apiHint = ''
      try {
        const j = JSON.parse(t) as { error?: { message?: string } }
        if (j.error?.message) apiHint = ` — ${j.error.message.slice(0, 280)}`
      } catch {
        /* ignore */
      }
      console.error('[BrainActionAgent] OpenAI error:', status, t.slice(0, 1200))
      const technical =
        status === 401 || status === 403
          ? 'Configuração da API de IA (chave ou permissões). Avise o suporte.'
          : status === 429
            ? 'Limite de uso da API de IA atingido. Tente de novo em alguns minutos.'
            : status >= 500
              ? 'Serviço de IA instável no momento.'
              : status === 400 || status === 422
                ? `Pedido rejeitado pela API de IA (modelo ou formato).${apiHint}`
                : `Resposta HTTP ${status} da API de IA.${apiHint}`
      return {
        reply: `Não consegui concluir agendamento/cancelamento/campanha agora (${technical}) Se você roda o backend em Docker, confira se OPENAI_API_KEY está definida no container e se há saída HTTPS para api.openai.com. Para só consultar números (clientes, agenda, faturamento), use uma pergunta direta nesse sentido.`,
      }
    }

    const data = (await res.json()) as { output?: unknown[]; output_text?: string }
    const toolCalls = extractResponsesFunctionCalls(data)

    if (toolCalls.length === 0) {
      let reply =
        extractResponsesAssistantText(data) ||
        'Pronto! Se precisar de mais algum agendamento ou campanha, é só falar.'
      if (lastStructuredLine && !reply.includes(lastStructuredLine)) {
        reply = `${reply}\n\n${lastStructuredLine}`
      }
      return { reply: sanitizeUserFacingReply(reply) }
    }

    const out = data.output
    if (Array.isArray(out) && out.length > 0) {
      input.push(...out)
    }

    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.arguments || '{}') as Record<string, unknown>
      } catch {
        args = {}
      }

      let output: string
      try {
        output = await executeActionBrainTool(tc.name, args, params.companyId)
      } catch (e) {
        output = e instanceof Error ? e.message : String(e)
      }

      const structured = tryParseStructuredUiPayload(output)
      if (structured) {
        if (lastStructuredLine && isCampaignDraftLine(lastStructuredLine) && isCampaignDraftLine(structured)) {
          lastStructuredLine = mergeCampaignDraftLines(lastStructuredLine, structured)
        } else if (
          lastStructuredLine &&
          isSchedulableDraftJsonLine(lastStructuredLine) &&
          isSchedulableDraftJsonLine(structured)
        ) {
          lastStructuredLine = mergeScheduleDraftLines(lastStructuredLine, structured)
        } else {
          lastStructuredLine = structured
        }
      }

      const clipped = output.length > 12000 ? output.slice(0, 12000) + '… [truncado]' : output
      input.push({
        type: 'function_call_output',
        call_id: tc.call_id,
        output: clipped,
      })
    }
  }

  return {
    reply: `A conversa com as ferramentas ficou longa demais. Tente dividir em um pedido por vez (ex.: primeiro buscar o cliente, depois escolher horário).`,
  }
}
