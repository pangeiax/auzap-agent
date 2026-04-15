/**
 * ════════════════════════════════════════════════════════════════
 * FOLLOW-UP 1: LEMBRETE DE AGENDAMENTO
 * ════════════════════════════════════════════════════════════════
 *
 * O que faz:
 *   Busca agendamentos de AMANHÃ de um cliente específico
 *   e envia um lembrete via WhatsApp.
 *
 * Quando roda:
 *   Sob demanda — disparado pelo endpoint POST /appointments/send-reminders
 *
 * Banco de dados:
 *   SOMENTE LEITURA — não altera nenhum registro
 */

import { prisma } from '../lib/prisma'
import { sendTextMessage } from '../services/baileysService'

// ─── Helper: data de amanhã no fuso BRT ────────────────────────
function tomorrowBR(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}

// ─── Helper: formata horário "14:30" a partir de um Date ───────
function formatTime(time: Date | null | undefined): string {
  if (!time) return ''
  const d = new Date(time)
  return d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

// ─── Função principal (por cliente) ────────────────────────────
export async function runReminderForClient(companyId: number, clientId: string): Promise<{
  sent: number
  total: number
  results: { appointmentId: string; service: string; success: boolean; error?: string }[]
}> {
  const tomorrow = tomorrowBR()
  console.log(`[FollowUp:Reminder] Company ${companyId}, Client ${clientId} — verificando agendamentos para ${tomorrow}...`)

  const results: { appointmentId: string; service: string; success: boolean; error?: string }[] = []

  // LEITURA: busca TODOS os agendamentos de amanhã do cliente (exceto cancelados)
  const appointments = await prisma.petshopAppointment.findMany({
    where: {
      companyId,
      clientId,
      scheduledDate: new Date(tomorrow + 'T12:00:00Z'),
      status: { not: 'cancelled' },
    },
    include: {
      client: { select: { phone: true, name: true } },
      pet: { select: { name: true } },
      service: { select: { name: true } },
    },
  })

  if (appointments.length === 0) {
    console.log(`[FollowUp:Reminder] Nenhum agendamento para amanhã.`)
    return { sent: 0, total: 0, results }
  }

  const phone = appointments[0].client?.phone
  if (!phone) {
    return { sent: 0, total: appointments.length, results: [{ appointmentId: '', service: '', success: false, error: 'Cliente sem telefone' }] }
  }

  const clientName = appointments[0].client?.name || 'Cliente'
  const companyIdStr = String(companyId)
  const jid = phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`

  // Monta uma mensagem única com todos os agendamentos do cliente
  const lines = [
    `Olá, ${clientName}! Tudo bem? 🐾`,
    '',
    'Passando para lembrar dos seus agendamentos de amanhã:',
    '',
  ]

  for (const apt of appointments) {
    const petName = apt.pet?.name || 'seu pet'
    const serviceName = apt.service?.name || 'atendimento'
    const horario = formatTime(apt.startTime)
    lines.push(`- ${petName}: ${serviceName}${horario ? ` às ${horario}` : ''}`)
  }

  lines.push('', 'Qualquer dúvida, é só chamar por aqui!', '', 'Até amanhã! 😊')

  const message = lines.join('\n')
  let sent = 0

  try {
    await sendTextMessage(companyIdStr, jid, message)
    sent = 1
    for (const apt of appointments) {
      results.push({ appointmentId: apt.id, service: apt.service?.name || '', success: true })
    }
  } catch (err: any) {
    const errorMsg = err?.message ? String(err.message) : String(err)
    for (const apt of appointments) {
      results.push({ appointmentId: apt.id, service: apt.service?.name || '', success: false, error: errorMsg })
    }
    console.error(`[FollowUp:Reminder] Erro ao enviar para ${phone}:`, errorMsg)
  }

  console.log(`[FollowUp:Reminder] ${sent ? 'Lembrete enviado' : 'Falha no envio'} para ${clientName} (${appointments.length} agendamento(s)).`)
  return { sent, total: appointments.length, results }
}