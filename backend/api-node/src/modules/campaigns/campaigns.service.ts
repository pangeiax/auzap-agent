import { prisma } from '../../lib/prisma'
import { sendTextMessage } from '../../services/baileysService'

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
): Promise<{
  sent: number
  total: number
  results: { client_id: string; success: boolean; error?: string }[]
}> {
  const session = await prisma.whatsappSession.findUnique({ where: { companyId } })
  if (!session || session.status !== 'connected') {
    throw new Error('WhatsApp não conectado para este petshop')
  }

  const text = String(message ?? '').trim()
  if (!text) throw new Error('Mensagem vazia')

  const results: { client_id: string; success: boolean; error?: string }[] = []
  const companyIdStr = String(companyId)

  for (const client of clients) {
    try {
      const jid = toWhatsAppJid(client.phone)
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
