import { Request, Response } from 'express'
import { sendCampaignMessages } from './campaigns.service'

/**
 * POST /campaigns/send
 * Body flexível: { clients?: { id, phone }[], message?: string }
 */
export async function sendCampaign(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const body = req.body ?? {}
    const clients = Array.isArray(body.clients) ? body.clients : []
    const message = typeof body.message === 'string' ? body.message : ''

    if (!clients.length) {
      return res.status(400).json({ error: 'Informe clients (array com id e phone)' })
    }

    const normalized = clients
      .map((c: { id?: unknown; phone?: unknown }) => ({
        id: String(c?.id ?? ''),
        phone: String(c?.phone ?? ''),
      }))
      .filter((c: { id: string; phone: string }) => c.id && c.phone)

    if (!normalized.length) {
      return res.status(400).json({ error: 'Nenhum destino válido (id + phone)' })
    }

    const result = await sendCampaignMessages(companyId, normalized, message)
    return res.json(result)
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : 'Falha ao enviar campanha'
    const status = msg.includes('não conectado') ? 503 : 500
    console.error('[campaigns/send]', err)
    return res.status(status).json({ error: msg })
  }
}
