// @ts-ignore
import { proto, downloadMediaMessage } from '@whiskeysockets/baileys'
import { prisma } from '../../lib/prisma'
import { sendTextMessage, sendTyping, clearTyping } from '../../services/baileysService'
import { runAgent, popFromHistory } from '../../agent/AgentService'
import { linkLidToManualIfMatch } from './senderPnMatch'

const DEBOUNCE_MS = 8000

function getClientIdentifierFromJid(jid: string): string {
  const knownSuffixes = ['@s.whatsapp.net', '@g.us']

  for (const suffix of knownSuffixes) {
    if (jid.endsWith(suffix)) {
      return jid.slice(0, -suffix.length)
    }
  }

  return jid
}

// ─────────────────────────────────────────
// Tipos de mensagem que são silenciosamente ignorados
// (notificações internas do WhatsApp, reações, etc.)
// ─────────────────────────────────────────
const SILENT_TYPES = new Set([
  'protocolMessage',
  'reactionMessage',
  'senderKeyDistributionMessage',
  'messageContextInfo',
])

// ─────────────────────────────────────────
// Debounce: acumula mensagens cortadas do mesmo cliente
// Chave: "companyId:phone"
// ─────────────────────────────────────────
interface PendingEntry {
  timer: ReturnType<typeof setTimeout>
  parts: string[]
  jid: string
  pushName: string | null
}

const pendingMessages = new Map<string, PendingEntry>()

// ─────────────────────────────────────────
// Lock de processamento por cliente
// Se chegar mensagem durante processamento da IA,
// a resposta atual é descartada e tudo é reprocessado
// ─────────────────────────────────────────
const processingLock = new Map<string, boolean>()
const invalidated = new Map<string, boolean>()

interface QueuedMessage {
  parts: string[]
  jid: string
  pushName: string | null
  socket: any
  imageBase64?: string
  realPhone?: string | null
}

const queuedMessages = new Map<string, QueuedMessage>()

const ROUTER_STAGE_TO_CRM_STAGE: Record<string, string> = {
  WELCOME: 'initial',
  PET_REGISTRATION: 'onboarding',
  SERVICE_SELECTION: 'booking',
  SCHEDULING: 'booking',
  AWAITING_CONFIRMATION: 'booking',
  COMPLETED: 'completed',
}

function normalizeRouterStage(stage?: string | null): string | null {
  if (!stage) {
    return null
  }

  return ROUTER_STAGE_TO_CRM_STAGE[stage] ?? null
}

async function persistConversationStage(
  clientId: string,
  previousStage: string | null | undefined,
  normalizedRouterStage: string | null
): Promise<string | null> {
  const freshClient = await prisma.client.findUnique({
    where: { id: clientId },
    select: { conversationStage: true },
  })

  const freshStage = freshClient?.conversationStage ?? null

  // If a tool updated the CRM stage during agent execution, that stage is authoritative.
  if (freshStage && freshStage !== (previousStage ?? null)) {
    return freshStage
  }

  if (!normalizedRouterStage || normalizedRouterStage === freshStage) {
    return freshStage
  }

  const updatedClient = await prisma.client.update({
    where: { id: clientId },
    data: { conversationStage: normalizedRouterStage },
    select: { conversationStage: true },
  })

  return updatedClient.conversationStage ?? null
}

async function waitForPendingDebounceFlush(
  companyId: number,
  phone: string,
  key: string
): Promise<void> {
  if (!invalidated.get(key) || queuedMessages.has(key) || !pendingMessages.has(key)) {
    return
  }

  console.log(`[Concurrency][company:${companyId}] Aguardando debounce pendente de ${phone} fechar antes de continuar.`)
  while (pendingMessages.has(key) && !queuedMessages.has(key)) {
    await new Promise(resolve => setTimeout(resolve, 150))
  }
}

// ─────────────────────────────────────────
// Transcreve áudio via OpenAI Whisper
// ─────────────────────────────────────────
async function transcribeAudio(socket: any, msg: proto.IWebMessageInfo): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.warn('[Transcription] OPENAI_API_KEY não configurada — não é possível transcrever áudios')
    return null
  }

  try {
    const buffer = await downloadMediaMessage(msg, 'buffer', {}) as Buffer

    const formData = new FormData()
    const blob = new Blob([new Uint8Array(buffer)], { type: 'audio/ogg' })
    formData.append('file', blob, 'audio.ogg')
    formData.append('model', 'whisper-1')
    formData.append('language', 'pt')

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    })

    if (!response.ok) {
      console.error('[Transcription] Erro na API OpenAI Whisper:', await response.text())
      return null
    }

    const data = await response.json() as { text: string }
    const text = data.text?.trim() || null
    if (text) {
      console.log(
        `[Transcription] Whisper | model=whisper-1 | chars=${text.length}`
      )
    }
    return text
  } catch (err) {
    console.error('[Transcription] Erro ao transcrever áudio:', err)
    return null
  }
}

// ─────────────────────────────────────────
// Adiciona texto ao debounce
// ─────────────────────────────────────────
function enqueueDebounce(
  companyId: number,
  socket: any,
  jid: string,
  phone: string,
  pushName: string | null,
  text: string,
  realPhone?: string | null
): void {
  const key = `${companyId}:${phone}`
  const existing = pendingMessages.get(key)

  if (existing) {
    clearTimeout(existing.timer)
    existing.parts.push(text)
  }

  const parts = existing ? existing.parts : [text]

  const timer = setTimeout(async () => {
    pendingMessages.delete(key)
    const fullMessage = parts.join('\n')
    console.log(
      `[Handler][company:${companyId}] Processando mensagem consolidada de ${phone} (${parts.length} parte(s)): ${fullMessage}`
    )
    await enqueueProcessing(companyId, socket, jid, phone, pushName, fullMessage, undefined, realPhone)
  }, DEBOUNCE_MS)

  pendingMessages.set(key, { timer, parts, jid, pushName })
}

// ─────────────────────────────────────────
// Processa mensagem recebida do Baileys
// ─────────────────────────────────────────
export async function handleIncomingMessage(
  companyId: number,
  socket: any,
  msg: proto.IWebMessageInfo,
  senderPn?: string | null
): Promise<void> {
  const jid = msg.key.remoteJid!

  // A IA só atende conversas 1-a-1 (@s.whatsapp.net ou @lid). Qualquer outro
  // canal — grupo (@g.us), broadcast/status (@broadcast), canal/newsletter
  // (@newsletter) — é ignorado silenciosamente. Whitelist em vez de blocklist
  // pra que sufixos novos do WhatsApp não vazem por default.
  if (!jid || !(jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'))) {
    console.log(`[Handler][company:${companyId}] Ignorando JID fora de DM: ${jid}`)
    return
  }

  const phone = getClientIdentifierFromJid(jid)
  const pushName = msg.pushName || null
  const key = `${companyId}:${phone}`

  // Extrai telefone real do senderPn (ex: "5513991839119@s.whatsapp.net" → "5513991839119")
  const realPhone = senderPn ? getClientIdentifierFromJid(senderPn) : null

  const isAudio = !!(msg.message?.audioMessage || msg.message?.ptvMessage)
  const isImage = !!msg.message?.imageMessage

  // ── Áudio/voz: transcreve e enfileira como texto ──────────
  if (isAudio) {
    if (processingLock.get(key)) {
      invalidated.set(key, true)
      console.log(`[Concurrency][company:${companyId}] ⚡ Áudio de ${phone} chegou durante processamento. Resposta atual será bloqueada.`)
    }
    console.log(`[Handler][company:${companyId}] Áudio recebido de ${phone}, transcrevendo...`)
    const transcription = await transcribeAudio(socket, msg)
    if (!transcription) {
      await sendTextMessage(
        String(companyId), jid,
        'Recebi seu áudio, mas não consegui transcrever. Pode escrever sua mensagem?'
      )
      return
    }
    console.log(`[Handler][company:${companyId}] Transcrição de ${phone}: ${transcription}`)
    enqueueDebounce(companyId, socket, jid, phone, pushName, transcription, realPhone)
    return
  }

  // ── Imagem: baixa e envia ao agente via vision ────────────
  if (isImage) {
    if (processingLock.get(key)) {
      invalidated.set(key, true)
      console.log(`[Concurrency][company:${companyId}] ⚡ Imagem de ${phone} chegou durante processamento. Resposta atual será bloqueada.`)
    }
    const caption = msg.message!.imageMessage!.caption || ''
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {}) as Buffer
      const imageBase64 = buffer.toString('base64')
      console.log(`[Handler][company:${companyId}] Imagem recebida de ${phone} (legenda: "${caption}")`)
      await enqueueProcessing(companyId, socket, jid, phone, pushName, caption, imageBase64, realPhone)
    } catch (err) {
      console.error(`[Handler][company:${companyId}] Erro ao baixar imagem:`, err)
      await sendTextMessage(
        String(companyId), jid,
        'Recebi sua imagem, mas não consegui processá-la. Pode descrever o que precisa em texto ou áudio?'
      )
    }
    return
  }

  // ── Texto ─────────────────────────────────────────────────
  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    ''

  if (text) {
    if (processingLock.get(key)) {
      invalidated.set(key, true)
      console.log(`[Concurrency][company:${companyId}] ⚡ Texto de ${phone} chegou durante processamento. Resposta atual será bloqueada. Texto: "${text.substring(0, 80)}"`)
    }
    console.log(`[Handler][company:${companyId}] Mensagem de ${phone}: ${text}`)
    enqueueDebounce(companyId, socket, jid, phone, pushName, text, realPhone)
    return
  }

  // ── Tipos silenciosos (reações, protocolos internos, etc.) ─
  const messageKeys = Object.keys(msg.message || {})
  if (messageKeys.every(k => SILENT_TYPES.has(k))) {
    return
  }

  // ── Qualquer outra mídia não suportada ────────────────────
  console.log(`[Handler][company:${companyId}] Mídia não suportada de ${phone}: ${messageKeys.join(', ')}`)
  await sendTextMessage(
    String(companyId), jid,
    'Não consegui compreender o conteúdo enviado. Pode escrever sua mensagem ou enviar um áudio?'
  )
}

// ─────────────────────────────────────────
// Enfileira processamento com lock por cliente
// Se já está processando → salva msg do user no banco,
// marca como invalidada, e a resposta atual será descartada.
// Após descartar, a IA reprocessa com o histórico completo.
// ─────────────────────────────────────────
async function enqueueProcessing(
  companyId: number,
  socket: any,
  jid: string,
  phone: string,
  pushName: string | null,
  text: string,
  imageBase64?: string,
  realPhone?: string | null
): Promise<void> {
  const key = `${companyId}:${phone}`

  if (processingLock.get(key)) {
    const existing = queuedMessages.get(key)
    if (existing) {
      existing.parts.push(text)
      if (imageBase64) {
        existing.imageBase64 = imageBase64
      }
      console.log(`[Concurrency][company:${companyId}] Batch acumulado para ${phone}. Total pendente: ${existing.parts.length}`)
    } else {
      console.log(`[Concurrency][company:${companyId}] Batch debounced de ${phone} caiu durante processamento. Acumulando para reprocesso.`)
      queuedMessages.set(key, {
        parts: [text],
        jid,
        pushName,
        socket,
        ...(imageBase64 ? { imageBase64 } : {}),
        ...(realPhone ? { realPhone } : {}),
      })
      console.log(`[Concurrency][company:${companyId}] Primeiro batch pendente registrado para ${phone}`)
    }

    return
  }

  // Adquire lock e processa
  processingLock.set(key, true)
  console.log(`[Concurrency][company:${companyId}] Lock adquirido para ${phone}`)
  await sendTyping(String(companyId), jid)
  try {
    try {
      await processMessage(companyId, socket, jid, phone, pushName, text, imageBase64, false, realPhone)
    } catch (err) {
      console.error(`[Handler][company:${companyId}] Erro ao processar mensagem de ${phone}:`, err)
    }

    if (invalidated.get(key)) {
      console.log(`[Concurrency][company:${companyId}] Resposta em andamento para ${phone} foi invalidada por mensagem nova.`)
    }

    await waitForPendingDebounceFlush(companyId, phone, key)
    invalidated.delete(key)

    while (queuedMessages.has(key)) {
      const queued = queuedMessages.get(key)!
      queuedMessages.delete(key)
      const queuedText = queued.parts.join('\n')

      console.log(`[Concurrency][company:${companyId}] 🔄 Reprocessando ${phone} com ${queued.parts.length} batch(es) acumulado(s).`)

      invalidated.delete(key)
      try {
        await processMessage(
          companyId,
          queued.socket,
          queued.jid,
          phone,
          queued.pushName,
          queuedText,
          queued.imageBase64,
          false,
          queued.realPhone
        )
      } catch (err) {
        console.error(`[Handler][company:${companyId}] Erro ao reprocessar mensagem de ${phone}:`, err)
      }

      await waitForPendingDebounceFlush(companyId, phone, key)

      if (queuedMessages.has(key)) {
        console.log(`[Concurrency][company:${companyId}] 🔄 Novos batches entraram para ${phone} durante o reprocessamento. Continuando drenagem...`)
      }
    }
  } finally {
    invalidated.delete(key)
    console.log(`[Concurrency][company:${companyId}] Lock liberado para ${phone}`)
    processingLock.delete(key)
    await clearTyping(String(companyId), jid)
  }
}

// ─────────────────────────────────────────
// Processa a mensagem consolidada após o debounce
// skipSave=true quando é reprocessamento (msg já salva no banco)
// ─────────────────────────────────────────
async function processMessage(
  companyId: number,
  socket: any,
  jid: string,
  phone: string,
  pushName: string | null,
  text: string,
  imageBase64?: string,
  skipSave: boolean = false,
  realPhone?: string | null
): Promise<void> {
  // ── 1. Busca ou cria o cliente ───────────
  let client = await prisma.client.findUnique({
    where: { companyId_phone: { companyId, phone } },
  })

  // Match por senderPn → manual_phone (cenário A1): só roda na PRIMEIRA mensagem
  // do @lid. Se casar, o registro manual adota o @lid como phone. Sem senderPn,
  // sem match, ou se o @lid já existe, segue fluxo normal (cadastro cuida do merge).
  client = await linkLidToManualIfMatch({
    companyId,
    phone,
    realPhone,
    client,
    pushName,
  })

  if (!client) {
    client = await prisma.client.create({
      data: {
        companyId,
        phone,
        name: pushName,
        conversationStage: 'initial',
        lastMessageAt: new Date(),
      },
    })
    console.log(`[Handler][company:${companyId}] Novo cliente criado: ${phone} (${pushName ?? 'sem nome'})`)
  } else if (!realPhone || !client.manualPhone) {
    // Update normal (sem senderPn ou já tratado acima)
    await prisma.client.update({
      where: { id: client.id },
      data: {
        lastMessageAt: new Date(),
        ...(pushName ? { name: pushName } : {}),
      },
    })
  }

  // ── 2. Busca ou cria conversa ────────────
  let conversation = await prisma.agentConversation.findFirst({
    where: { companyId, clientId: client.id },
    orderBy: { startedAt: 'desc' },
  })

  if (!conversation) {
    conversation = await prisma.agentConversation.create({
      data: {
        companyId,
        clientId: client.id,
        whatsappNumber: phone,
        lastMessageAt: new Date(),
      },
    })
  } else {
    await prisma.agentConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    })
  }

  // ── 3. Salva mensagem do usuário ─────────
  if (!skipSave) {
    const savedContent = imageBase64
      ? (text ? `[imagem] ${text}` : '[imagem]')
      : text

    await prisma.agentMessage.create({
      data: {
        conversationId: conversation.id,
        companyId,
        role: 'user',
        content: savedContent,
      },
    })
  }

  // ── 4. Gera e envia resposta do agente ───
  const key = `${companyId}:${phone}`
  if (!client.aiPaused) {
    const messageForAgent = text
    const previousConversationStage = client.conversationStage ?? null

    const agentResponse = await generateAgentReply(companyId, phone, messageForAgent, imageBase64)

    // Se chegou mensagem nova durante o processamento, descarta esta resposta
    if (invalidated.get(key)) {
      console.log(`[Concurrency][company:${companyId}] DESCARTANDO resposta para ${phone}: "${agentResponse?.reply?.substring(0, 80) ?? '(vazio)'}..."`)
      // Remove do Redis apenas a resposta descartada (assistant)
      // A msg do user(A) continua no Redis — e a msg(B) será salva pelo /run do reprocessamento
      await popFromHistory(companyId, phone, 1)
      return
    }

    if (agentResponse) {
      await prisma.agentMessage.create({
        data: {
          conversationId: conversation.id,
          companyId,
          role: 'assistant',
          content: agentResponse.reply,
        },
      })

      const persistedStage = await persistConversationStage(
        client.id,
        previousConversationStage,
        normalizeRouterStage(agentResponse.stage)
      )

      markMessageAsSaved(companyId, jid, agentResponse.reply)
      await sendTextMessage(String(companyId), jid, agentResponse.reply)
      console.log(
        `[Handler][company:${companyId}] Resposta enviada para ${phone} | agente: ${agentResponse.agent_used ?? 'n/a'} | estágio router: ${agentResponse.stage ?? 'n/a'} | estágio CRM: ${persistedStage ?? 'n/a'}`
      )

      // Qualquer agente pode chamar escalate_to_human (lodging, faq, etc.) — o mesmo template do dono
      // só deve ir quando a IA pausou com motivo [ESCALONAMENTO] (ver guard dentro da função).
      _notifyEscalationToOwner(companyId, phone, client.name).catch((err) =>
        console.error(`[Escalation][company:${companyId}] Falha ao notificar owner:`, err)
      )
    }
  } else {
    console.log(`[Handler][company:${companyId}] IA pausada para ${phone}, mensagem salva sem resposta.`)
  }
}

// ─────────────────────────────────────────
// Notifica owner do petshop quando cliente é escalado
// ─────────────────────────────────────────
async function _notifyEscalationToOwner(
  companyId: number,
  clientPhone: string,
  clientName: string | null
): Promise<void> {
  const freshClient = await prisma.client.findUnique({
    where: { companyId_phone: { companyId, phone: clientPhone } },
    select: { aiPaused: true, aiPauseReason: true },
  })

  if (!freshClient?.aiPaused) return

  const raw = freshClient.aiPauseReason ?? ''
  // Pausa manual ou outro motivo — não dispara alerta de escalonamento
  if (!raw.includes('[ESCALONAMENTO]')) return

  const petshop = await prisma.petshopProfile.findUnique({
    where: { companyId },
    select: { ownerPhone: true },
  })

  if (!petshop?.ownerPhone) {
    console.warn(`[Escalation][company:${companyId}] owner_phone não cadastrado`)
    return
  }
  const match = raw.match(/\[ESCALONAMENTO\] ([\s\S]*?) \| Última msg: ([\s\S]*)/)
  const summary = match?.[1] ?? raw
  const lastMessage = match?.[2] ?? ''

  const cleanPhone = clientPhone.replace(/@\S+/g, '')

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
  const conversationLink = `${frontendUrl}/conversations/${cleanPhone}`

  const message =
    `🔔 *Atendimento escalado!*\n\n` +
    `*Cliente:* ${clientName ?? 'Cliente'}\n` +
    `*Telefone/Idetificador:* +${cleanPhone}\n\n` +
    `*Resumo:*\n${summary}\n\n` +
    `*Última mensagem:*\n"${lastMessage}"\n\n` +
    `🔗 ${conversationLink}`

  const ownerJid = `${petshop.ownerPhone.replace(/\D/g, '')}@s.whatsapp.net`
  await sendTextMessage(String(companyId), ownerJid, message)
  console.log(`[Escalation][company:${companyId}] Notificação enviada para ${petshop.ownerPhone}`)
}

// ─────────────────────────────────────────
// Chama o ai-service para gerar resposta
// ─────────────────────────────────────────
async function generateAgentReply(
  companyId: number,
  phone: string,
  userMessage: string,
  imageBase64?: string
): Promise<{ reply: string; agent_used?: string; stage?: string } | null> {
  try {
    const response = await runAgent(companyId, phone, userMessage, imageBase64)
    return response
  } catch (err) {
    console.error(`[Handler][company:${companyId}] Erro ao chamar AgentService:`, err)
    return {
      reply: 'Desculpe, estou com dificuldades técnicas no momento. Tente novamente em alguns instantes.',
    }
  }
}

// ─────────────────────────────────────────
// Mensagens enviadas pelo próprio número (fromMe)
// Salva como role: 'staff' para distinguir de respostas da IA
// ─────────────────────────────────────────

// IDs de mensagens já salvas pela IA ou dashboard (evita duplicar)
const recentlySavedOutgoing = new Map<string, number>()

/** Marca uma mensagem como já salva (chamado pelo sendTextMessage da IA) */
export function markMessageAsSaved(companyId: number, jid: string, text: string) {
  const key = `${companyId}:${jid}:${text.slice(0, 100)}`
  recentlySavedOutgoing.set(key, Date.now())
  // Limpa após 30s
  setTimeout(() => recentlySavedOutgoing.delete(key), 30000)
}

export async function handleOutgoingMessage(
  companyId: number,
  msg: proto.IWebMessageInfo
): Promise<void> {
  const jid = msg.key.remoteJid
  if (!jid || jid.includes('@broadcast') || jid.includes('@g.us')) return

  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    ''
  if (!text) return

  const phone = getClientIdentifierFromJid(jid)

  // Verifica se esta mensagem já foi salva pela IA ou dashboard
  const dedupKey = `${companyId}:${jid}:${text.slice(0, 100)}`
  if (recentlySavedOutgoing.has(dedupKey)) {
    recentlySavedOutgoing.delete(dedupKey)
    return
  }

  // Busca conversa existente do cliente
  const client = await prisma.client.findUnique({
    where: { companyId_phone: { companyId, phone } },
  })
  if (!client) return

  const conversation = await prisma.agentConversation.findFirst({
    where: { companyId, clientId: client.id },
    orderBy: { startedAt: 'desc' },
  })
  if (!conversation) return

  await prisma.agentMessage.create({
    data: {
      conversationId: conversation.id,
      companyId,
      role: 'staff',
      content: text,
    },
  })

  await prisma.agentConversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  })

  console.log(`[Handler][company:${companyId}] Mensagem enviada (staff) para ${phone}: ${text.substring(0, 80)}`)
}
