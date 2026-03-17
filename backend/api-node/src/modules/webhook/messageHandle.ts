// @ts-ignore
import { proto, downloadMediaMessage } from '@whiskeysockets/baileys'
import { prisma } from '../../lib/prisma'
import { sendTextMessage, sendTyping, clearTyping } from '../../services/baileysService'
import { runAgent } from '../../agent/AgentService'

const DEBOUNCE_MS = 8000

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
    const blob = new Blob([buffer], { type: 'audio/ogg' })
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
    return data.text?.trim() || null
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
  text: string
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
    await processMessage(companyId, socket, jid, phone, pushName, fullMessage)
  }, DEBOUNCE_MS)

  pendingMessages.set(key, { timer, parts, jid, pushName })
}

// ─────────────────────────────────────────
// Processa mensagem recebida do Baileys
// ─────────────────────────────────────────
export async function handleIncomingMessage(
  companyId: number,
  socket: any,
  msg: proto.IWebMessageInfo
): Promise<void> {
  const jid = msg.key.remoteJid!
  const phone = jid.replace('@s.whatsapp.net', '').replace('@g.us', '')
  const pushName = msg.pushName || null

  const isAudio = !!(msg.message?.audioMessage || msg.message?.pttMessage)
  const isImage = !!msg.message?.imageMessage

  // ── Áudio/voz: transcreve e enfileira como texto ──────────
  if (isAudio) {
    console.log(`[Handler][company:${companyId}] Áudio recebido de ${phone}, transcrevendo...`)
    const transcription = await transcribeAudio(socket, msg)
    if (!transcription) {
      await sendTextMessage(
        String(companyId), jid,
        'Recebi seu áudio, mas não consegui transcrever. Pode escrever sua mensagem? 🐾'
      )
      return
    }
    console.log(`[Handler][company:${companyId}] Transcrição de ${phone}: ${transcription}`)
    enqueueDebounce(companyId, socket, jid, phone, pushName, transcription)
    return
  }

  // ── Imagem: baixa e envia ao agente via vision ────────────
  if (isImage) {
    const caption = msg.message!.imageMessage!.caption || ''
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {}) as Buffer
      const imageBase64 = buffer.toString('base64')
      console.log(`[Handler][company:${companyId}] Imagem recebida de ${phone} (legenda: "${caption}")`)
      await processMessage(companyId, socket, jid, phone, pushName, caption, imageBase64)
    } catch (err) {
      console.error(`[Handler][company:${companyId}] Erro ao baixar imagem:`, err)
      await sendTextMessage(
        String(companyId), jid,
        'Recebi sua imagem, mas não consegui processá-la. Pode descrever o que precisa em texto ou áudio? 🐾'
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
    console.log(`[Handler][company:${companyId}] Mensagem de ${phone}: ${text}`)
    enqueueDebounce(companyId, socket, jid, phone, pushName, text)
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
    'Não consegui compreender o conteúdo enviado. Pode escrever sua mensagem ou enviar um áudio? 🐾'
  )
}

// ─────────────────────────────────────────
// Processa a mensagem consolidada após o debounce
// ─────────────────────────────────────────
async function processMessage(
  companyId: number,
  socket: any,
  jid: string,
  phone: string,
  pushName: string | null,
  text: string,
  imageBase64?: string
): Promise<void> {
  // ── 1. Busca ou cria o cliente ───────────
  let client = await prisma.client.findUnique({
    where: { companyId_phone: { companyId, phone } },
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
  } else {
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

  // ── 4. Gera e envia resposta do agente ───
  if (!client.aiPaused) {
    await sendTyping(String(companyId), jid)

    const agentResponse = await generateAgentReply(companyId, phone, text, imageBase64)

    await clearTyping(String(companyId), jid)

    if (agentResponse) {
      await prisma.agentMessage.create({
        data: {
          conversationId: conversation.id,
          companyId,
          role: 'assistant',
          content: agentResponse.reply,
        },
      })

      if (agentResponse.stage) {
        await prisma.client.update({
          where: { id: client.id },
          data: { conversationStage: agentResponse.stage },
        })
      }

      await sendTextMessage(String(companyId), jid, agentResponse.reply)
      console.log(
        `[Handler][company:${companyId}] Resposta enviada para ${phone} | agente: ${agentResponse.agent_used ?? 'n/a'} | estágio: ${agentResponse.stage ?? 'n/a'}`
      )

      if (agentResponse.agent_used === 'escalation_agent') {
        _notifyEscalationToOwner(companyId, phone, client.name).catch((err) =>
          console.error(`[Escalation][company:${companyId}] Falha ao notificar owner:`, err)
        )
      }
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

  const petshop = await prisma.saasPetshop.findUnique({
    where: { companyId },
    select: { ownerPhone: true },
  })

  if (!petshop?.ownerPhone) {
    console.warn(`[Escalation][company:${companyId}] owner_phone não cadastrado`)
    return
  }

  const raw = freshClient.aiPauseReason ?? ''
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
      reply: 'Desculpe, estou com dificuldades técnicas no momento. Tente novamente em alguns instantes. 🐾',
    }
  }
}
