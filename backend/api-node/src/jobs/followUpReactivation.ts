/**
 * ════════════════════════════════════════════════════════════════
 * FOLLOW-UP 3: REATIVAÇÃO DE CLIENTES INATIVOS
 * ════════════════════════════════════════════════════════════════
 *
 * O que faz:
 *   Busca clientes que não enviam mensagem há 30+ dias e envia
 *   uma mensagem amigável de reativação via WhatsApp.
 *
 * Quando roda:
 *   A cada 6 horas (via setInterval)
 *
 * Banco de dados:
 *   SOMENTE LEITURA
 *
 * Filtros de segurança:
 *   - Apenas clientes com isActive = true
 *   - Ignora clientes com aiPaused = true (estão em atendimento humano)
 *   - Somente clientes que JÁ tiveram ao menos 1 mensagem (lastMessageAt != null)
 *   - Máximo de 20 mensagens por execução (evita spam)
 *
 * Anti-duplicação:
 *   Set em memória com IDs dos clientes já contatados.
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

// ─── Configuração ──────────────────────────────────────────────
const SIX_HOURS = 6 * 60 * 60 * 1000
const DAYS_INACTIVE = 30
const MAX_PER_RUN = 20

// ─── Função principal ──────────────────────────────────────────
async function run(): Promise<void> {
  resetIfNewDay()

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - DAYS_INACTIVE)

  console.log(`[FollowUp:Reactivation] Buscando clientes inativos há ${DAYS_INACTIVE}+ dias...`)

  try {
    // LEITURA: busca clientes inativos em todas as companies ativas
    const clients = await prisma.client.findMany({
      where: {
        isActive: true,
        aiPaused: { not: true },
        lastMessageAt: {
          not: null,
          lt: cutoffDate,
        },
      },
      select: {
        id: true,
        phone: true,
        name: true,
        companyId: true,
        saasCompany: { select: { id: true, name: true } },
      },
      take: MAX_PER_RUN * 2, // busca mais do que precisa para compensar filtros
    })

    if (clients.length === 0) {
      console.log('[FollowUp:Reactivation] Nenhum cliente inativo encontrado.')
      return
    }

    // Verifica quais companies têm WhatsApp conectado (LEITURA)
    const companyIds = [...new Set(clients.map((c: { companyId: number }) => c.companyId))]
    const activeSessions = await prisma.whatsappSession.findMany({
      where: {
        companyId: { in: companyIds },
        status: 'connected',
      },
      select: { companyId: true },
    })
    const connectedCompanies = new Set(activeSessions.map((s: { companyId: number }) => s.companyId))

    let sent = 0

    for (const client of clients) {
      if (sent >= MAX_PER_RUN) break
      if (sentToday.has(client.id)) continue
      if (!connectedCompanies.has(client.companyId)) continue

      const phone = client.phone
      if (!phone) continue

      const clientName = client.name || 'Cliente'
      const shopName = client.saasCompany?.name || 'nosso petshop'
      const companyId = String(client.companyId)

      const jid = phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`

      const message = [
        `Olá, ${clientName}! Sentimos sua falta por aqui 🐾`,
        '',
        `Faz um tempinho que não vemos você na ${shopName}. Seu pet está bem?`,
        '',
        'Estamos com a agenda aberta e adoraríamos receber vocês novamente! Se quiser agendar um horário, é só responder essa mensagem.',
        '',
        'Até breve! 😊',
      ].join('\n')

      try {
        await sendTextMessage(companyId, jid, message)
        sentToday.add(client.id)
        sent++
        await new Promise((r) => setTimeout(r, 450))
      } catch (err) {
        console.error(`[FollowUp:Reactivation] Erro ao enviar para ${phone}:`, err)
      }
    }

    console.log(`[FollowUp:Reactivation] ${sent} mensagem(ns) de reativação enviada(s).`)
  } catch (err) {
    console.error('[FollowUp:Reactivation] Erro geral:', err)
  }
}

// ─── Exporta o starter ─────────────────────────────────────────
export function startFollowUpReactivation(): void {
  run()
  setInterval(run, SIX_HOURS)
  console.log('[FollowUp:Reactivation] Ativo — verifica a cada 6 horas')
}
