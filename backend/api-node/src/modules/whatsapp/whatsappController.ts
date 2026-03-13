import { Request, Response } from 'express'
import QRCode from 'qrcode'
import { startBaileysSession, disconnectSession } from '../../services/baileysService'
import { prisma } from '../../lib/prisma'

// ─────────────────────────────────────────
// Helper: valida e converte companyId
// ─────────────────────────────────────────
function parseCompanyId(param: string | undefined): number | null {
  const id = Number(param)
  return isNaN(id) ? null : id
}

// ─────────────────────────────────────────
// GET /whatsapp/status/:companyId
// Retorna status da sessão WhatsApp
// ─────────────────────────────────────────
export async function getStatus(req: Request, res: Response) {
  const companyId = parseCompanyId(req.params.companyId)
  if (!companyId) return res.status(400).json({ error: 'companyId inválido' })

  const session = await prisma.whatsappSession.findUnique({
    where: { companyId },
  })

  if (!session) {
    return res.json({ status: 'disconnected', phoneNumber: null })
  }

  return res.json({
    status: session.status,
    phoneNumber: session.phoneNumber,
    instanceName: session.instanceName,
    connectedAt: session.connectedAt,
  })
}

// ─────────────────────────────────────────
// POST /whatsapp/connect/:companyId
// Inicia sessão e retorna QR code em base64
// ─────────────────────────────────────────
export async function connectWhatsApp(req: Request, res: Response) {
  const companyId = parseCompanyId(req.params.companyId)
  if (!companyId) return res.status(400).json({ error: 'companyId inválido' })

  // Verifica se a company existe
  const company = await prisma.saasCompany.findUnique({ where: { id: companyId } })
  if (!company) return res.status(404).json({ error: 'Company não encontrada' })

  // Verifica se já existe sessão conectada
  const existing = await prisma.whatsappSession.findUnique({ where: { companyId } })
  if (existing?.status === 'connected') {
    return res.status(409).json({
      error: 'Esta company já possui uma sessão WhatsApp ativa.',
      phoneNumber: existing.phoneNumber,
    })
  }

  return new Promise<void>((resolve) => {
    let responded = false

    startBaileysSession(String(companyId), async (qr) => {
      if (!responded) {
        responded = true
        try {
          const qrBase64 = await QRCode.toDataURL(qr)
          res.json({ qrCode: qrBase64, status: 'connecting' })
        } catch {
          res.status(500).json({ error: 'Erro ao gerar QR code' })
        }
        resolve()
      }
    })

    // Timeout de 30s
    setTimeout(() => {
      if (!responded) {
        responded = true
        res.status(408).json({ error: 'Timeout ao gerar QR code. Tente novamente.' })
        resolve()
      }
    }, 30000)
  })
}

// ─────────────────────────────────────────
// POST /whatsapp/disconnect/:companyId
// Desconecta a sessão
// ─────────────────────────────────────────
export async function disconnectWhatsApp(req: Request, res: Response) {
  const companyId = parseCompanyId(req.params.companyId)
  if (!companyId) return res.status(400).json({ error: 'companyId inválido' })

  await disconnectSession(String(companyId))
  return res.json({ message: 'Sessão desconectada com sucesso.' })
}