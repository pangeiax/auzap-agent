// @ts-ignore
import makeWASocket, {
  // @ts-expect-error - Baileys types not properly exported
  DisconnectReason,
  // @ts-expect-error - Baileys types not properly exported
  fetchLatestBaileysVersion,
  // @ts-expect-error - Baileys types not properly exported
  makeCacheableSignalKeyStore,
  // @ts-expect-error - Baileys types not properly exported
  useMultiFileAuthState,
} from '@whiskeysockets/baileys'
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
    shouldIgnoreJid: (jid: string) =>
      jid.includes('@broadcast') || jid === 'status@broadcast',
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
// Envia mensagem de texto
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
  await socket.sendMessage(jid, { text })
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