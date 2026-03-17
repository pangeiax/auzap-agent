import { proto } from '@whiskeysockets/baileys'
import { prisma } from '../../lib/prisma'
import { sendTextMessage, sendTyping, clearTyping } from '../../services/baileysService'
import { runAgent } from '../../agent/AgentService'

const DEBOUNCE_MS = 8000

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

  // Extrai texto da mensagem
  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    ''

  if (!text) {
    console.log(`[Handler][company:${companyId}] Mensagem sem texto, ignorando.`)
    return
  }

  console.log(`[Handler][company:${companyId}] Mensagem de ${phone}: ${text}`)

  const key = `${companyId}:${phone}`
  const existing = pendingMessages.get(key)

  if (existing) {
    // Cancela o timer anterior e acumula a nova parte
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
// Processa a mensagem consolidada após o debounce
// ─────────────────────────────────────────
async function processMessage(
  companyId: number,
  socket: any,
  jid: string,
  phone: string,
  pushName: string | null,
  text: string
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
  await prisma.agentMessage.create({
    data: {
      conversationId: conversation.id,
      companyId,
      role: 'user',
      content: text,
    },
  })

  // ── 4. Gera e envia resposta do agente ───
  if (!client.aiPaused) {
    // Inicia "digitando..." enquanto o agente processa
    await sendTyping(String(companyId), jid)

    const agentResponse = await generateAgentReply(companyId, phone, text)

    // Para "digitando..."
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

      // Detecta escalonamento: notifica owner via WhatsApp sem chamar serviço externo
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

  if (!freshClient?.aiPaused) return  // escalação não confirmada no DB

  const petshop = await prisma.saasPetshop.findUnique({
    where: { companyId },
    select: { ownerPhone: true },
  })

  if (!petshop?.ownerPhone) {
    console.warn(`[Escalation][company:${companyId}] owner_phone não cadastrado`)
    return
  }

  // Parseia "[ESCALONAMENTO] summary | Última msg: last_msg"
  const raw = freshClient.aiPauseReason ?? ''
  const match = raw.match(/\[ESCALONAMENTO\] ([\s\S]*?) \| Última msg: ([\s\S]*)/)
  const summary = match?.[1] ?? raw
  const lastMessage = match?.[2] ?? ''

  // Remove sufixos JID (@s.whatsapp.net, @lid, etc.) para exibição limpa
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
  userMessage: string
): Promise<{ reply: string; agent_used?: string; stage?: string } | null> {
  try {
    const response = await runAgent(companyId, phone, userMessage)
    return response
  } catch (err) {
    console.error(`[Handler][company:${companyId}] Erro ao chamar AgentService:`, err)
    return {
      reply: 'Desculpe, estou com dificuldades técnicas no momento. Tente novamente em alguns instantes. 🐾',
    }
  }
}
