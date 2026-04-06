import { prisma } from '../../lib/prisma'
import { sendTextMessage } from '../../services/baileysService'
import { applyCampaignTemplate } from './campaignPlaceholders'

function toWhatsAppJid(raw: string): string {
  const t = String(raw ?? '').trim()
  if (!t) throw new Error('Destino vazio')
  if (t.includes('@')) return t
  const digits = t.replace(/\D/g, '')
  if (!digits) throw new Error('Telefone inválido')
  return `${digits}@s.whatsapp.net`
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function sendCampaignMessages(
  companyId: number,
  clients: { id: string; phone: string }[],
  message: string,
  perClientMessages?: Record<string, string> | null,
): Promise<{
  sent: number
  total: number
  results: { client_id: string; success: boolean; error?: string }[]
}> {
  const session = await prisma.whatsappSession.findUnique({ where: { companyId } })
  if (!session || session.status !== 'connected') {
    throw new Error('WhatsApp não conectado para este petshop')
  }

  const defaultMsg = String(message ?? '').trim()
  if (!defaultMsg && (!perClientMessages || Object.keys(perClientMessages).length === 0)) {
    throw new Error('Mensagem vazia')
  }

  const ids = [...new Set(clients.map((c) => c.id).filter(Boolean))]
  const nameRows = await prisma.client.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, name: true },
  })
  const nameById = new Map(nameRows.map((r) => [r.id, (r.name ?? '').trim() || 'Cliente']))

  const results: { client_id: string; success: boolean; error?: string }[] = []
  const companyIdStr = String(companyId)

  for (const client of clients) {
    try {
      const jid = toWhatsAppJid(client.phone)
      const raw =
        perClientMessages != null && perClientMessages[client.id] != null && String(perClientMessages[client.id]).trim()
          ? String(perClientMessages[client.id]).trim()
          : defaultMsg
      if (!raw) throw new Error('Mensagem vazia para o destinatário')
      const nomeCliente = nameById.get(client.id) ?? 'Cliente'
      const text = applyCampaignTemplate(raw, nomeCliente)
      await sendTextMessage(companyIdStr, jid, text)
      results.push({ client_id: client.id, success: true })
    } catch (err: any) {
      results.push({
        client_id: client.id,
        success: false,
        error: err?.message ? String(err.message) : String(err),
      })
    }
    await delay(450)
  }

  return {
    sent: results.filter((r) => r.success).length,
    total: clients.length,
    results,
  }
}
