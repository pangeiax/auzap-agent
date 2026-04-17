/**
 * ════════════════════════════════════════════════════════════════
 * FOLLOW-UP 1: LEMBRETE DE AGENDAMENTO
 * ════════════════════════════════════════════════════════════════
 *
 * O que faz:
 *   Envia lembretes via WhatsApp para clientes com agendamento
 *   no dia seguinte.
 *
 * Quando roda:
 *   Automaticamente todos os dias às 12:00 BRT (15:00 UTC).
 *   Também pode ser disparado manualmente pelo endpoint.
 *
 * Banco de dados:
 *   SOMENTE LEITURA — não altera nenhum registro
 */

import { prisma } from '../lib/prisma'
import { sendTextMessage } from '../services/baileysService'
import { enqueueReminder, markDailyScheduled } from './reminderQueue'

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

// ─── Função diária: enfileira na fila Redis os envios de amanhã ───
// Cada envio é agendado com um horário específico (distribuído ao longo de 6h)
// O worker (em reminderWorker.ts) consome essa fila e envia os lembretes
export async function runReminderJobDaily(): Promise<void> {
  const today = todayBR()
  const tomorrow = new Date(today + 'T12:00:00Z')
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)

  // Deduplicação: se já rodou hoje para essa data, não roda de novo
  const canRun = await markDailyScheduled(today)
  if (!canRun) {
    console.log(`[FollowUp:Reminder:Daily] Agendamento de ${today} já foi feito anteriormente. Pulando.`)
    return
  }

  console.log(`[FollowUp:Reminder:Daily] Enfileirando lembretes para agendamentos de ${tomorrowStr}...`)

  // LEITURA: busca todos os agendamentos de amanhã (todas as companies)
  const appointments = await prisma.petshopAppointment.findMany({
    where: {
      scheduledDate: tomorrow,
      status: { not: 'cancelled' },
    },
    select: { companyId: true, clientId: true },
  })

  if (appointments.length === 0) {
    console.log('[FollowUp:Reminder:Daily] Nenhum cliente com agendamento amanhã.')
    return
  }

  // Agrupa por (companyId + clientId) para não enviar lembrete duplicado
  const unique = new Map<string, { companyId: number; clientId: string }>()
  for (const apt of appointments) {
    const key = `${apt.companyId}:${apt.clientId}`
    if (!unique.has(key)) {
      unique.set(key, { companyId: apt.companyId, clientId: apt.clientId })
    }
  }

  const clientsArray = Array.from(unique.values())
  const total = clientsArray.length

  // Janela de envio: 6 horas (das 12:00 BRT / 15:00 UTC até 18:00 BRT / 21:00 UTC)
  const WINDOW_MS = 6 * 60 * 60 * 1000
  const delayBetween = total > 0 ? WINDOW_MS / total : 0
  const startAt = Date.now()

  // Enfileira cada envio no Redis com o horário calculado
  for (let idx = 0; idx < clientsArray.length; idx++) {
    const client = clientsArray[idx]
    const scheduledAt = startAt + Math.round(idx * delayBetween)
    await enqueueReminder(
      {
        companyId: client.companyId,
        clientId: client.clientId,
        retryCount: 0,
        scheduledFor: tomorrowStr,
      },
      scheduledAt
    )
  }

  const delayMinStr = Math.round(delayBetween / 1000 / 60)
  console.log(`[FollowUp:Reminder:Daily] ${total} envio(s) enfileirado(s) no Redis (delay: ${delayMinStr} min entre cada). Último envio: em ${Math.round(((total - 1) * delayBetween) / 1000 / 60)} min.`)
}