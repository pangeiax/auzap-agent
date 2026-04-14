/**
 * ════════════════════════════════════════════════════════════════
 * FOLLOW-UP 1: LEMBRETE DE AGENDAMENTO
 * ════════════════════════════════════════════════════════════════
 *
 * O que faz:
 *   Busca agendamentos de AMANHÃ que ainda não foram confirmados
 *   e envia um lembrete via WhatsApp para o cliente.
 *
 * Quando roda:
 *   A cada 30 minutos (via setInterval)
 *
 * Banco de dados:
 *   SOMENTE LEITURA — não altera nenhum registro
 *
 * Anti-duplicação:
 *   Usa um Set em memória com a data do dia. Se o appointment já
 *   recebeu lembrete hoje, não envia de novo. O Set reseta
 *   automaticamente quando o dia muda.
 */

import { prisma } from '../lib/prisma'
import { sendTextMessage } from '../services/baileysService'

// ─── Controle anti-duplicação ──────────────────────────────────
// Armazena IDs de agendamentos que já receberam lembrete HOJE.
// Quando o dia muda, o Set é limpo automaticamente.
let sentToday = new Set<string>()
let lastResetDate = ''

function resetIfNewDay(): void {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  if (today !== lastResetDate) {
    sentToday = new Set()
    lastResetDate = today
  }
}

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

// ─── Intervalo ─────────────────────────────────────────────────
const THIRTY_MINUTES = 30 * 60 * 1000

// ─── Função principal ──────────────────────────────────────────
async function run(): Promise<void> {
  resetIfNewDay()

  const tomorrow = tomorrowBR()
  console.log(`[FollowUp:Reminder] Verificando agendamentos para ${tomorrow}...`)

  try {
    // LEITURA: busca agendamentos de amanhã não confirmados e não cancelados
    const appointments = await prisma.petshopAppointment.findMany({
      where: {
        scheduledDate: new Date(tomorrow + 'T12:00:00Z'),
        confirmed: false,
        status: { not: 'cancelled' },
      },
      include: {
        client: { select: { phone: true, name: true } },
        pet: { select: { name: true } },
        service: { select: { name: true } },
        saasCompany: { select: { id: true } },
      },
    })

    if (appointments.length === 0) {
      console.log('[FollowUp:Reminder] Nenhum agendamento pendente para amanhã.')
      return
    }

    let sent = 0

    for (const apt of appointments) {
      // Anti-duplicação: pula se já enviou hoje
      if (sentToday.has(apt.id)) continue

      const phone = apt.client?.phone
      if (!phone) continue

      const clientName = apt.client?.name || 'Cliente'
      const petName = apt.pet?.name || 'seu pet'
      const serviceName = apt.service?.name || 'atendimento'
      const horario = formatTime(apt.startTime)
      const companyId = String(apt.saasCompany.id)

      // Monta o JID (identificador do WhatsApp)
      const jid = phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`

      // Monta a mensagem personalizada
      const message = [
        `Olá, ${clientName}! Tudo bem? 🐾`,
        '',
        `Passando para lembrar que ${petName} tem ${serviceName} marcado para amanhã${horario ? ` às ${horario}` : ''}.`,
        '',
        'Podemos confirmar sua presença? Responda *SIM* para confirmar ou entre em contato caso precise reagendar.',
        '',
        'Obrigado! 😊',
      ].join('\n')

      try {
        await sendTextMessage(companyId, jid, message)
        sentToday.add(apt.id)
        sent++
        // Delay entre mensagens para não sobrecarregar (450ms como no campaigns)
        await new Promise((r) => setTimeout(r, 450))
      } catch (err) {
        console.error(`[FollowUp:Reminder] Erro ao enviar para ${phone}:`, err)
      }
    }

    console.log(`[FollowUp:Reminder] ${sent} lembrete(s) enviado(s) de ${appointments.length} agendamento(s).`)
  } catch (err) {
    console.error('[FollowUp:Reminder] Erro geral:', err)
  }
}

// ─── Exporta o starter ─────────────────────────────────────────
export function startFollowUpReminder(): void {
  run()
  setInterval(run, THIRTY_MINUTES)
  console.log('[FollowUp:Reminder] Ativo — verifica a cada 30 min')
}
