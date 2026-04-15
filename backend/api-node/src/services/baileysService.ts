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
import { handleIncomingMessage, handleOutgoingMessage } from '../modules/webhook/messageHandle'

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
// Cleanup: fecha socket antigo e remove listeners
// ─────────────────────────────────────────
function cleanupExistingSocket(companyIdStr: string): void {
  const oldSocket = activeSockets.get(companyIdStr)
  if (oldSocket) {
    try {
      oldSocket.ev.removeAllListeners('connection.update')
      oldSocket.ev.removeAllListeners('creds.update')
      oldSocket.ev.removeAllListeners('messages.upsert')
      oldSocket.end(undefined)
    } catch (err) {
      console.warn(`[Baileys][company:${companyIdStr}] Erro ao limpar socket antigo:`, err)
    }
    activeSockets.delete(companyIdStr)
  }
  clearTypingIntervalsForCompany(companyIdStr)
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

  // Limpa socket anterior antes de criar novo (evita listeners duplicados e QR múltiplo)
  cleanupExistingSocket(companyIdStr)

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

    // Ignora eventos de sockets que já foram substituídos
    if (activeSockets.get(companyIdStr) !== socket) return

    if (qr && onQR) {
      console.log(`[Baileys][company:${companyIdStr}] QR gerado`)
      onQR(qr)
      await upsertSession(companyId, 'connecting')
    }

    if (connection === 'close') {
      // Verifica novamente se este socket ainda é o ativo (pode ter mudado durante async)
      if (activeSockets.get(companyIdStr) !== socket) return

      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
      const wasAuthenticated = !!socket.user?.id
      // 515 = stream restart (normal após pairing ou reconexão) — sempre reconectar
      const isRestartRequired = statusCode === 515 || statusCode === DisconnectReason.restartRequired
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut && (wasAuthenticated || isRestartRequired)

      console.log(`[Baileys][company:${companyIdStr}] Desconectado (code: ${statusCode}). Autenticado: ${wasAuthenticated}. Restart: ${isRestartRequired}. Reconectar: ${shouldReconnect}`)
      clearTypingIntervalsForCompany(companyIdStr)

      if (shouldReconnect) {
        // Socket autenticado ou restart necessário — reconecta
        console.log(`[Baileys][company:${companyIdStr}] Reconectando (${isRestartRequired ? 'restart required' : 'close transitório'})...`)
        // Remove listeners do socket antigo mas não chama .end() (evita loop de close events)
        try {
          socket.ev.removeAllListeners('connection.update')
          socket.ev.removeAllListeners('creds.update')
          socket.ev.removeAllListeners('messages.upsert')
        } catch {}
        activeSockets.delete(companyIdStr)
        setTimeout(() => startBaileysSession(companyIdStr), isRestartRequired ? 1000 : 5000)
      } else if (statusCode === DisconnectReason.loggedOut) {
        // Logout explícito — limpa sessão
        console.log(`[Baileys][company:${companyIdStr}] Logout. Removendo sessão.`)
        await upsertSession(companyId, 'disconnected')
        cleanupExistingSocket(companyIdStr)
        fs.rmSync(sessionDir, { recursive: true, force: true })
      } else {
        // Não autenticado (QR expirou, etc.) — para de reconectar
        console.log(`[Baileys][company:${companyIdStr}] Sessão não autenticada. Parando reconexão.`)
        await upsertSession(companyId, 'disconnected')
        cleanupExistingSocket(companyIdStr)
      }
    }

    if (connection === 'open') {
      const jid = socket.user?.id || ''
      const phone = jid.split(':')[0]
      console.log(`[Baileys][company:${companyIdStr}] Conectado como ${phone}`)
      await upsertSession(companyId, 'connected', phone).catch(err =>
        console.error(`[Baileys][company:${companyIdStr}] Erro ao salvar status connected:`, err)
      )
    }
  })

  // ── Evento: salva credenciais ─────────────
  socket.ev.on('creds.update', saveCreds)

  // ── Evento: mensagens recebidas ───────────
  socket.ev.on('messages.upsert', async ({ messages, type }: any) => {
    if (type !== 'notify') return

    // Ignora eventos de sockets que já foram substituídos
    if (activeSockets.get(companyIdStr) !== socket) return

    const now = Math.floor(Date.now() / 1000)

    for (const msg of messages) {
      if (!msg.message) continue

      // Ignora mensagens antigas (offline/histórico) — evita duplicatas na reconexão
      const msgTimestamp = typeof msg.messageTimestamp === 'number'
        ? msg.messageTimestamp
        : Number(msg.messageTimestamp?.low ?? msg.messageTimestamp ?? 0)

      if (msgTimestamp > 0 && (now - msgTimestamp) > 60) {
        continue
      }

      if (msg.key.fromMe) {
        // Mensagem enviada pelo próprio número (WhatsApp direto, celular, etc.)
        try {
          await handleOutgoingMessage(companyId, msg)
        } catch (err) {
          console.error(`[Baileys][company:${companyIdStr}] Erro ao salvar mensagem enviada:`, err)
        }
        continue
      }

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
  const socket = activeSockets.get(companyIdStr)
  if (socket) {
    try {
      await socket.logout()
    } catch (err) {
      console.warn(`[Baileys][company:${companyIdStr}] Erro no logout:`, err)
    }
  }
  cleanupExistingSocket(companyIdStr)
}

// ─────────────────────────────────────────
// Restaura sessões ativas ao iniciar o backend
// ─────────────────────────────────────────
export async function restoreActiveSessions(): Promise<void> {
  const sessions = await prisma.whatsappSession.findMany({
    where: { status: { in: ['connected', 'reconnecting'] } },
  })

  for (const session of sessions) {
    const companyIdStr = String(session.companyId)
    if (activeSockets.has(companyIdStr)) {
      console.log(`[Baileys] Sessão da company ${companyIdStr} já ativa, pulando restauração`)
      continue
    }
    console.log(`[Baileys] Restaurando sessão da company ${companyIdStr}`)
    await startBaileysSession(companyIdStr)
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
