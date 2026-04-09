import makeWASocket from '@whiskeysockets/baileys'
import { DisconnectReason } from '@whiskeysockets/baileys/lib/Types/index.js'
import {
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys/lib/Utils/index.js'
import { Boom } from '@hapi/boom'
import path from 'path'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { prisma } from '../lib/prisma'
import { handleIncomingMessage } from '../modules/webhook/messageHandle'

// ─────────────────────────────────────────
// Mapa de sockets ativos em memória
// companyId (string) → socket do Baileys
// ─────────────────────────────────────────
const activeSockets = new Map<string, ReturnType<typeof makeWASocket>>()
const typingIntervals = new Map<string, ReturnType<typeof setInterval>>()

function getTypingKey(companyIdStr: string, jid: string): string {
  return `${companyIdStr}:${jid}`
}

function clearTypingIntervalsForCompany(companyIdStr: string): void {
  for (const [key, interval] of typingIntervals.entries()) {
    if (key.startsWith(`${companyIdStr}:`)) {
      clearInterval(interval)
      typingIntervals.delete(key)
    }
  }
}

// ─────────────────────────────────────────
// Inicia sessão Baileys para uma company
// ─────────────────────────────────────────
export async function startBaileysSession(
  companyIdStr: string,
  onQR?: (qr: string) => void
): Promise<void> {
  const companyId = Number(companyIdStr)
  const sessionsPath = process.env.BAILEYS_SESSIONS_PATH || './sessions'
  const sessionDir = path.join(sessionsPath, companyIdStr)

  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true })
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir)
  const { version } = await fetchLatestBaileysVersion()

  const socket = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, undefined as any),
    },
    printQRInTerminal: false,
    shouldIgnoreJid: (jid?: string) =>
      !jid || jid.includes('@broadcast') || jid === 'status@broadcast',
  })

  activeSockets.set(companyIdStr, socket)

  // ── Evento: atualização de conexão ───────
  socket.ev.on('connection.update', async (update: any) => {
    const { connection, lastDisconnect, qr } = update

    if (qr && onQR) {
      console.log(`[Baileys][company:${companyIdStr}] QR gerado`)
      onQR(qr)
      await upsertSession(companyId, 'connecting')
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      console.log(`[Baileys][company:${companyIdStr}] Desconectado. Reconectar: ${shouldReconnect}`)
      await upsertSession(companyId, 'disconnected')
      clearTypingIntervalsForCompany(companyIdStr)

      if (shouldReconnect) {
        setTimeout(() => startBaileysSession(companyIdStr), 3000)
      } else {
        activeSockets.delete(companyIdStr)
        fs.rmSync(sessionDir, { recursive: true, force: true })
      }
    }

    if (connection === 'open') {
      const jid = socket.user?.id || ''
      const phone = jid.split(':')[0]
      console.log(`[Baileys][company:${companyIdStr}] Conectado como ${phone}`)
      await upsertSession(companyId, 'connected', phone)
    }
  })

  // ── Evento: salva credenciais ─────────────
  socket.ev.on('creds.update', saveCreds)

  // ── Evento: mensagens recebidas ───────────
  socket.ev.on('messages.upsert', async ({ messages, type }: any) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      if (msg.key.fromMe || !msg.message) continue

      try {
        await handleIncomingMessage(companyId, socket, msg)
      } catch (err) {
        console.error(`[Baileys][company:${companyIdStr}] Erro ao processar mensagem:`, err)
      }
    }
  })
}

// ─────────────────────────────────────────
// Envia mensagem de texto (com retry)
// ─────────────────────────────────────────
export async function sendTextMessage(
  companyIdStr: string,
  jid: string,
  text: string
): Promise<void> {
  const socket = activeSockets.get(companyIdStr)
  if (!socket) {
    throw new Error(`[Baileys] Nenhum socket ativo para company ${companyIdStr}`)
  }

  const MAX_RETRIES = 2
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await socket.sendMessage(jid, { text })
      return
    } catch (err: any) {
      const isTimeout = err?.output?.statusCode === 408 || err?.message === 'Timed Out'
      if (isTimeout && attempt < MAX_RETRIES) {
        console.warn(
          `[Baileys][company:${companyIdStr}] Timeout ao enviar mensagem (tentativa ${attempt}/${MAX_RETRIES}), retentando em 3s...`
        )
        await new Promise(r => setTimeout(r, 3000))
        continue
      }
      console.error(`[Baileys][company:${companyIdStr}] Falha ao enviar mensagem após ${attempt} tentativa(s):`, err?.message)
      throw err
    }
  }
}

// ─────────────────────────────────────────
// Inicia indicador "digitando..." no WhatsApp
// ─────────────────────────────────────────
export async function sendTyping(companyIdStr: string, jid: string): Promise<void> {
  const socket = activeSockets.get(companyIdStr)
  if (!socket) return

  const typingKey = getTypingKey(companyIdStr, jid)
  // Se já há intervalo ativo, ainda assim envia um composing agora (renova antes do próximo tick)
  if (typingIntervals.has(typingKey)) {
    try {
      await socket.sendPresenceUpdate('composing', jid)
    } catch {
      /* ignore */
    }
    return
  }

  try {
    await socket.presenceSubscribe(jid)
    await socket.sendPresenceUpdate('composing', jid)

    // WhatsApp expira o estado "composing" em poucos segundos; renovar com frequência
    const interval = setInterval(() => {
      const activeSocket = activeSockets.get(companyIdStr)
      if (!activeSocket) return
      activeSocket.sendPresenceUpdate('composing', jid).catch(() => {
        // Não crítico
      })
    }, 2000)

    typingIntervals.set(typingKey, interval)
  } catch {
    // Não crítico — não bloqueia o fluxo principal
  }
}

// ─────────────────────────────────────────
// Remove indicador "digitando..."
// ─────────────────────────────────────────
export async function clearTyping(companyIdStr: string, jid: string): Promise<void> {
  const typingKey = getTypingKey(companyIdStr, jid)
  const interval = typingIntervals.get(typingKey)
  if (interval) {
    clearInterval(interval)
    typingIntervals.delete(typingKey)
  }

  const socket = activeSockets.get(companyIdStr)
  if (!socket) return
  try {
    await socket.sendPresenceUpdate('available', jid)
  } catch {
    // Não crítico
  }
}

// ─────────────────────────────────────────
// Retorna socket ativo
// ─────────────────────────────────────────
export function getSocket(companyIdStr: string) {
  return activeSockets.get(companyIdStr)
}

// ─────────────────────────────────────────
// Desconecta sessão
// ─────────────────────────────────────────
export async function disconnectSession(companyIdStr: string): Promise<void> {
  clearTypingIntervalsForCompany(companyIdStr)
  const socket = activeSockets.get(companyIdStr)
  if (socket) {
    await socket.logout()
    activeSockets.delete(companyIdStr)
  }
}

// ─────────────────────────────────────────
// Restaura sessões ativas ao iniciar o backend
// ─────────────────────────────────────────
export async function restoreActiveSessions(): Promise<void> {
  const sessions = await prisma.whatsappSession.findMany({
    where: { status: 'connected' },
  })

  for (const session of sessions) {
    console.log(`[Baileys] Restaurando sessão da company ${session.companyId}`)
    await startBaileysSession(String(session.companyId))
  }
}

// ─────────────────────────────────────────
// Helper: cria ou atualiza registro de sessão
// whatsapp_sessions tem @unique em company_id
// ─────────────────────────────────────────
async function upsertSession(
  companyId: number,
  status: string,
  phoneNumber?: string
): Promise<void> {
  const existing = await prisma.whatsappSession.findUnique({
    where: { companyId },
  })

  if (existing) {
    await prisma.whatsappSession.update({
      where: { companyId },
      data: {
        status,
        phoneNumber: phoneNumber ?? existing.phoneNumber,
        connectedAt: status === 'connected' ? new Date() : existing.connectedAt,
      },
    })
  } else {
    await prisma.whatsappSession.create({
      data: {
        id: uuidv4(),
        companyId,
        instanceName: `company-${companyId}`,
        status,
        phoneNumber: phoneNumber ?? null,
        connectedAt: status === 'connected' ? new Date() : null,
      },
    })
  }
}
