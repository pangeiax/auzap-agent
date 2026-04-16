/**
 * ════════════════════════════════════════════════════════════════
 * FOLLOW-UP 1: LEMBRETE DE AGENDAMENTO
 * ════════════════════════════════════════════════════════════════
 *
 * O que faz:
 *   Busca agendamentos FUTUROS de um cliente específico,
 *   calcula quantos dias faltam, e envia um lembrete
 *   personalizado via WhatsApp.
 *
 * Quando roda:
 *   Sob demanda — disparado pelo endpoint POST /appointments/send-reminders
 *
 * Banco de dados:
 *   SOMENTE LEITURA — não altera nenhum registro
 */

import { prisma } from '../lib/prisma'
import { sendTextMessage } from '../services/baileysService'

// ─── Helper: data de hoje no fuso BRT (yyyy-mm-dd) ─────────────
function todayBR(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}

// ─── Helper: calcula dias entre hoje e uma data ────────────────
function daysUntil(scheduledDate: Date): number {
  const today = new Date(todayBR() + 'T12:00:00Z')
  const target = new Date(scheduledDate)
  target.setUTCHours(12, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
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

// ─── Helper: formata data "16/04" a partir de um Date ──────────
function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

// ─── Helper: frase de encerramento baseada nos dias ────────────
function closingPhrase(days: number, multipleAppointments: boolean): string {
  if (multipleAppointments) {
    return 'Estamos preparando tudo para receber vocês! 🐾'
  }
  if (days === 1) {
    return 'Já é amanhã! Estamos te esperando 🐾'
  }
  if (days <= 3) {
    return `Faltam só ${days} dias, estamos ansiosos para receber vocês! 🐾`
  }
  return 'Anotado na agenda? Estamos preparando tudo para receber vocês! 🐾'
}

// ─── Função principal (por cliente) ────────────────────────────
export async function runReminderForClient(companyId: number, clientId: string): Promise<{
  sent: number
  total: number
  results: { appointmentId: string; service: string; success: boolean; error?: string }[]
}> {
  const today = todayBR()
  console.log(`[FollowUp:Reminder] Company ${companyId}, Client ${clientId} — buscando agendamentos futuros...`)

  const results: { appointmentId: string; service: string; success: boolean; error?: string }[] = []

  // LEITURA: busca TODOS os agendamentos futuros do cliente (a partir de amanhã, exceto cancelados)
  const appointments = await prisma.petshopAppointment.findMany({
    where: {
      companyId,
      clientId,
      scheduledDate: { gt: new Date(today + 'T12:00:00Z') },
      status: { not: 'cancelled' },
    },
    include: {
      client: { select: { phone: true, name: true } },
      pet: { select: { name: true } },
      service: { select: { name: true } },
    },
    orderBy: { scheduledDate: 'asc' },
  })

  if (appointments.length === 0) {
    console.log(`[FollowUp:Reminder] Nenhum agendamento futuro encontrado.`)
    return { sent: 0, total: 0, results }
  }

  const phone = appointments[0].client?.phone
  if (!phone) {
    return { sent: 0, total: appointments.length, results: [{ appointmentId: '', service: '', success: false, error: 'Cliente sem telefone' }] }
  }

  const clientName = appointments[0].client?.name || 'Cliente'
  const companyIdStr = String(companyId)

  // Monta o JID: usa o phone do cliente + sufixo correto
  // Se o phone já tem @lid ou @s.whatsapp.net, usa direto
  // Se não tem @, adiciona @s.whatsapp.net
  let jid: string
  if (phone.includes('@')) {
    jid = phone
  } else {
    jid = `${phone}@s.whatsapp.net`
  }

  console.log(`[FollowUp:Reminder] JID: ${jid} | phone original: ${phone}`)

  // Calcula dias para cada agendamento
  const allDays = appointments.map((apt: { scheduledDate: Date | null }) => daysUntil(apt.scheduledDate!))
  const minDays = Math.min(...allDays)
  const hasMultiple = appointments.length > 1

  // Monta a mensagem
  const lines = [
    `Olá, ${clientName}! Tudo bem? 🐾`,
    '',
    'Passando para lembrar dos seus agendamentos:',
    '',
  ]

  for (const apt of appointments) {
    const days = daysUntil(apt.scheduledDate!)
    const petName = apt.pet?.name || 'seu pet'
    const serviceName = apt.service?.name || 'atendimento'
    const horario = formatTime(apt.startTime)

    if (days === 1) {
      lines.push(`- ${petName}: ${serviceName} amanhã${horario ? ` às ${horario}` : ''}`)
    } else {
      lines.push(`- ${petName}: ${serviceName} em ${formatDate(apt.scheduledDate!)}${horario ? ` às ${horario}` : ''}`)
    }
  }

  lines.push('')
  lines.push(closingPhrase(minDays, hasMultiple))
  lines.push('')
  lines.push('Qualquer dúvida é só chamar por aqui. Até lá! 😊')

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