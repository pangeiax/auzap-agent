import { Request, Response } from 'express'
import { sendTextMessage } from '../../services/baileysService'

interface EscalationPayload {
  company_id: number
  owner_phone: string
  client_name: string
  client_phone: string
  summary: string
  last_message: string
  frontend_url: string
}

// ─────────────────────────────────────────
// POST /internal/notify-escalation
// Recebe dados do ai-service e envia mensagem de alerta ao dono do petshop
// ─────────────────────────────────────────
export async function notifyEscalation(req: Request, res: Response) {
  const {
    company_id,
    owner_phone,
    client_name,
    client_phone,
    summary,
    last_message,
    frontend_url,
  } = req.body as EscalationPayload

  if (!company_id || !owner_phone || !client_phone) {
    return res.status(400).json({ error: 'company_id, owner_phone e client_phone são obrigatórios' })
  }

  const conversationLink = `${frontend_url}/conversations/${client_phone}`

  const message =
    `🔔 *Atendimento escalado!*\n\n` +
    `*Cliente:* ${client_name}\n` +
    `*Telefone:* +${client_phone}\n\n` +
    `*Resumo:*\n${summary}\n\n` +
    `*Última mensagem:*\n"${last_message}"\n\n` +
    `🔗 ${conversationLink}`

  try {
    const ownerJid = `${owner_phone.replace(/\D/g, '')}@s.whatsapp.net`
    await sendTextMessage(String(company_id), ownerJid, message)
    console.log(`[Escalation] Notificação enviada para ${owner_phone} | company:${company_id}`)
    res.json({ success: true })
  } catch (err) {
    console.error(`[Escalation] Falha ao notificar dono | company:${company_id}:`, err)
    res.status(500).json({ error: 'Falha ao enviar notificação via WhatsApp' })
  }
}
