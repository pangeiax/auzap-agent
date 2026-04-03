/**
 * Ferramentas de ação (agendamento manual, campanha, cadastro).
 * Usadas por `brainActionAgent.ts` no chat do painel (modo action).
 */
import { prisma } from '../../lib/prisma'
import {
  resolveSecondBrainPlanLimits,
  SECOND_BRAIN_CAMPAIGN_DRAFT_MAX_TARGETS,
} from './brainPlanConstants'
import { isUuidString, parseOptionalUuid } from '../../lib/uuidValidation'
import { computeAvailableSlotsResponse } from '../appointments/availableSlotsQuery'
import { createManualScheduleAppointment } from '../appointments/manualScheduleCore'

export const ACTION_BRAIN_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_campaign_draft',
      description:
        `Monta draft de campanha: JSON type campaign_draft para o painel. Inclua até ${SECOND_BRAIN_CAMPAIGN_DRAFT_MAX_TARGETS} UUIDs para o dono escolher destinatários; o envio real respeita o limite do plano (campo max_recipients_per_send no JSON).`,
      parameters: {
        type: 'object',
        properties: {
          client_ids: {
            type: 'array',
            items: { type: 'string' },
            description: `UUIDs dos clientes — até ${SECOND_BRAIN_CAMPAIGN_DRAFT_MAX_TARGETS} na lista do rascunho.`,
          },
          message_template: { type: 'string', description: 'Texto sugerido da mensagem.' },
        },
        required: ['client_ids', 'message_template'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_clients',
      description: 'Busca clientes pelo nome (agendamento manual).',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Nome parcial ou completo.' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_client',
      description:
        'Cria cliente novo. Telefone em dígitos (ex.: 5511999999999). Email opcional.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['name', 'phone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_client_pets_for_scheduling',
      description: 'Lista pets ativos do cliente para agendamento manual.',
      parameters: {
        type: 'object',
        properties: { client_id: { type: 'string', description: 'UUID do cliente.' } },
        required: ['client_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_active_services',
      description:
        'Lista serviços ativos com id numérico e nome. Use para obter service_id antes de get_available_times.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_available_times',
      description:
        'Horários livres em uma data (YYYY-MM-DD). Passe service_id e, se possível, pet_id para regras de porte G/GG.',
      parameters: {
        type: 'object',
        properties: {
          target_date: { type: 'string', description: 'Data YYYY-MM-DD.' },
          service_id: { type: 'number', description: 'ID do serviço.' },
          pet_id: { type: 'string', description: 'UUID do pet (opcional mas recomendado).' },
        },
        required: ['target_date', 'service_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_manual_appointment',
      description:
        'Cria agendamento na plataforma após confirmar slot com get_available_times. Retorna JSON type appointment_created.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string' },
          pet_id: { type: 'string' },
          service_id: { type: 'number' },
          slot_id: { type: 'string' },
          scheduled_date: { type: 'string', description: 'YYYY-MM-DD (deve bater com a data do slot).' },
          notes: { type: 'string' },
        },
        required: ['client_id', 'pet_id', 'service_id', 'slot_id', 'scheduled_date'],
      },
    },
  },
]

export async function executeActionBrainTool(name: string, args: Record<string, unknown>, companyId: number): Promise<string> {
  switch (name) {
    case 'create_campaign_draft': {
      const planRow = await prisma.saasCompany.findUnique({
        where: { id: companyId },
        select: { plan: true },
      })
      const planLimits = resolveSecondBrainPlanLimits(planRow?.plan)
      const maxRecipientsPerSend = planLimits.campaignSendMaxRecipients

      const rawIds = Array.isArray(args.client_ids) ? (args.client_ids as string[]) : []
      const client_ids = rawIds.slice(0, SECOND_BRAIN_CAMPAIGN_DRAFT_MAX_TARGETS)
      const message_template = String(args.message_template ?? '')
      if (!client_ids.length) return 'Nenhum cliente selecionado para a campanha.'

      const found = await prisma.client.findMany({
        where: { companyId, id: { in: client_ids } },
        select: { id: true, name: true, phone: true },
      })

      if (!found.length) return 'Nenhum cliente encontrado com os IDs fornecidos.'

      return JSON.stringify({
        type: 'campaign_draft',
        clients: found.map((c) => ({
          id: c.id,
          name: c.name ?? 'Cliente',
          phone: c.phone,
        })),
        message: message_template,
        total: found.length,
        max_recipients_per_send: maxRecipientsPerSend,
        ...(rawIds.length > SECOND_BRAIN_CAMPAIGN_DRAFT_MAX_TARGETS
          ? {
              note: `Apenas os ${SECOND_BRAIN_CAMPAIGN_DRAFT_MAX_TARGETS} primeiros client_ids entraram no rascunho.`,
            }
          : {}),
      })
    }

    case 'search_clients': {
      const q = String(args.name ?? '').trim()
      if (!q) return JSON.stringify({ type: 'clients_not_found', name: args.name })

      const data = await prisma.client.findMany({
        where: {
          companyId,
          name: { contains: q, mode: 'insensitive' },
        },
        select: { id: true, name: true, phone: true },
        take: 5,
      })

      if (!data.length) return JSON.stringify({ type: 'clients_not_found', name: q })

      return JSON.stringify({
        type: 'clients_found',
        clients: data.map((c) => ({ id: c.id, name: c.name ?? '', phone: c.phone })),
      })
    }

    case 'create_client': {
      const phone = String(args.phone).replace(/\D/g, '')
      if (!phone) return 'Telefone inválido após normalização.'

      try {
        const data = await prisma.client.create({
          data: {
            companyId,
            name: String(args.name ?? ''),
            phone,
            email: (typeof args.email === 'string' ? args.email.trim() : null) || null,
            source: 'manual',
            conversationStage: 'initial',
          },
          select: { id: true, name: true, phone: true },
        })

        return JSON.stringify({
          type: 'client_created',
          client: { id: data.id, name: data.name, phone: data.phone },
        })
      } catch (e: unknown) {
        const code = e && typeof e === 'object' && 'code' in e ? (e as { code?: string }).code : undefined
        if (code === 'P2002') {
          return 'Já existe cliente com este telefone nesta empresa. Use search_clients para localizar.'
        }
        const msg = e instanceof Error ? e.message : String(e)
        return `Erro ao criar cliente: ${msg}`
      }
    }

    case 'get_client_pets_for_scheduling': {
      const clientIdRaw = String(args.client_id ?? '').trim()
      if (!isUuidString(clientIdRaw)) {
        return JSON.stringify({
          type: 'invalid_client_id',
          message:
            'client_id deve ser o UUID do cliente (campo id retornado por search_clients), não o nome nem o telefone.',
        })
      }
      const pets = await prisma.petshopPet.findMany({
        where: {
          companyId,
          clientId: clientIdRaw,
          isActive: true,
        },
        select: { id: true, name: true, species: true, breed: true, size: true },
      })

      if (!pets.length) return JSON.stringify({ type: 'no_pets', client_id: clientIdRaw })

      return JSON.stringify({
        type: 'pets_found',
        pets: pets.map((p) => ({
          id: p.id,
          name: p.name,
          species: p.species,
          breed: p.breed,
          size: p.size,
        })),
      })
    }

    case 'list_active_services': {
      const rows = await prisma.petshopService.findMany({
        where: { companyId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
      if (!rows.length) return 'Nenhum serviço ativo cadastrado.'
      return rows.map((s) => `• id ${s.id}: ${s.name}`).join('\n')
    }

    case 'get_available_times': {
      const target_date = String(args.target_date ?? '')
      const service_id = Number(args.service_id)
      const petRaw = args.pet_id != null && args.pet_id !== '' ? String(args.pet_id) : undefined
      const pet_id = parseOptionalUuid(petRaw)

      if (!Number.isFinite(service_id)) return 'Informe service_id numérico válido (use list_active_services).'
      if (petRaw && !pet_id) {
        return 'pet_id inválido: use o UUID do pet (campo id de get_client_pets_for_scheduling), não o nome do animal.'
      }

      const result = await computeAvailableSlotsResponse(companyId, target_date, service_id, pet_id)
      if ('error' in result) return `Erro: ${result.error}`
      return JSON.stringify({
        type: 'available_times',
        date: result.date,
        available_times: result.available_slots,
        total_available: result.total_available,
      })
    }

    case 'create_manual_appointment': {
      const out = await createManualScheduleAppointment(companyId, {
        client_id: String(args.client_id),
        pet_id: String(args.pet_id),
        service_id: Number(args.service_id),
        slot_id: String(args.slot_id),
        scheduled_date: String(args.scheduled_date),
        notes: args.notes == null || args.notes === '' ? null : String(args.notes),
      })

      if (!out.ok) return `Erro ao criar agendamento: ${out.message}`

      return JSON.stringify({
        type: 'appointment_created',
        appointment_id: out.appointment_id,
        scheduled_date: out.scheduled_date,
        service_id: args.service_id,
        pet_id: args.pet_id,
        client_id: args.client_id,
      })
    }

    default:
      return 'Ferramenta não encontrada.'
  }
}
