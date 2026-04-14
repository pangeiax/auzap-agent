/**
 * ════════════════════════════════════════════════════════════════
 * FOLLOW-UP 2: PÓS-ATENDIMENTO
 * ════════════════════════════════════════════════════════════════
 *
 * O que faz:
 *   Busca atendimentos que foram CONCLUÍDOS ontem e envia uma
 *   mensagem de agradecimento ao cliente via WhatsApp.
 *
 * Quando roda:
 *   A cada 1 hora (via setInterval)
 *
 * Banco de dados:
 *   SOMENTE LEITURA
 *
 * Anti-duplicação:
 *   Set em memória com IDs dos agendamentos já notificados.
 *   Reseta a cada dia.
 */

import { prisma } from '../lib/prisma'
import { sendTextMessage } from '../services/baileysService'

// ─── Controle anti-duplicação ──────────────────────────────────
let sentToday = new Set<string>()
let lastResetDate = ''

function resetIfNewDay(): void {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  if (today !== lastResetDate) {
    sentToday = new Set()
    lastResetDate = today
  }
}

// ─── Helper: data de ontem no fuso BRT ─────────────────────────
function yesterdayBR(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}

// ─── Intervalo ─────────────────────────────────────────────────
const ONE_HOUR = 60 * 60 * 1000

// ─── Função principal ──────────────────────────────────────────
async function run(): Promise<void> {
  resetIfNewDay()

  const yesterday = yesterdayBR()
  console.log(`[FollowUp:PostService] Verificando atendimentos concluídos em ${yesterday}...`)

  try {
    // LEITURA: busca atendimentos concluídos ontem
    const appointments = await prisma.petshopAppointment.findMany({
      where: {
        scheduledDate: new Date(yesterday + 'T12:00:00Z'),
        status: 'completed',
      },
      include: {
        client: { select: { phone: true, name: true } },
        pet: { select: { name: true } },
        service: { select: { name: true } },
        saasCompany: { select: { id: true, name: true } },
      },
    })

    if (appointments.length === 0) {
      console.log('[FollowUp:PostService] Nenhum atendimento concluído ontem.')
      return
    }

    let sent = 0

    for (const apt of appointments) {
      if (sentToday.has(apt.id)) continue

      const phone = apt.client?.phone
      if (!phone) continue

      const clientName = apt.client?.name || 'Cliente'
      const petName = apt.pet?.name || 'seu pet'
      const serviceName = apt.service?.name || 'atendimento'
      const shopName = apt.saasCompany?.name || 'nosso petshop'
      const companyId = String(apt.saasCompany.id)

      const jid = phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`

      const message = [
        `Olá, ${clientName}! 😊`,
        '',
        `Esperamos que ${petName} tenha curtido o ${serviceName} aqui na ${shopName}!`,
        '',
        'Se tiver qualquer dúvida ou quiser agendar o próximo atendimento, é só nos chamar por aqui.',
        '',
        'Obrigado pela confiança! 🐾',
      ].join('\n')

      try {
        await sendTextMessage(companyId, jid, message)
        sentToday.add(apt.id)
        sent++
        await new Promise((r) => setTimeout(r, 450))
      } catch (err) {
        console.error(`[FollowUp:PostService] Erro ao enviar para ${phone}:`, err)
      }
    }

    console.log(`[FollowUp:PostService] ${sent} mensagem(ns) pós-atendimento enviada(s).`)
  } catch (err) {
    console.error('[FollowUp:PostService] Erro geral:', err)
  }
}

// ─── Exporta o starter ─────────────────────────────────────────
export function startFollowUpPostService(): void {
  run()
  setInterval(run, ONE_HOUR)
  console.log('[FollowUp:PostService] Ativo — verifica a cada 1 hora')
}
