/**
 * Ferramentas de ação (agendamento manual, campanha, cadastro).
 * Usadas por `brainActionAgent.ts` no chat do painel (modo action).
 */
import { prisma } from '../../lib/prisma'
import { BRAIN_MANUAL_PHONE_EMPTY_LABEL } from './brainManualPhoneLabel'
import {
  BRAIN_BATCH_APPOINTMENTS_MAX,
  BRAIN_SEARCH_APPOINTMENTS_MAX,
  resolveSecondBrainPlanLimits,
  SECOND_BRAIN_CAMPAIGN_DRAFT_MAX_TARGETS,
} from './brainPlanConstants'
import { isUuidString, parseOptionalUuid } from '../../lib/uuidValidation'
import { cancelPetshopAppointment } from '../appointments/appointmentCancelCore'
import { computeStaffAvailability } from '../staff/staffController'

export function normalizeHhMm(input: string): string | null {
  const t = input.trim().toLowerCase().replace(/\s+/g, '')
  let h: number
  let min = 0
  const withColon = t.match(/^(\d{1,2}):(\d{2})$/)
  const withH = t.match(/^(\d{1,2})h(\d{2})?$/)
  if (withColon) {
    h = Number.parseInt(withColon[1]!, 10)
    min = Number.parseInt(withColon[2]!, 10)
  } else if (withH) {
    h = Number.parseInt(withH[1]!, 10)
    min = withH[2] ? Number.parseInt(withH[2]!, 10) : 0
  } else if (/^\d{1,2}$/.test(t)) {
    h = Number.parseInt(t, 10)
  } else {
    return null
  }
  if (!Number.isFinite(h) || h < 0 || h > 23 || min < 0 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** Resolve id numérico do serviço: valida id ou, se inválido, casa por nome (evita rascunho com id inventado). */
async function resolveActionBrainServiceId(
  companyId: number,
  serviceIdRaw: unknown,
  serviceNameRaw: unknown,
): Promise<{ id: number; name: string } | { error: string }> {
  const sidNum = typeof serviceIdRaw === 'number' ? serviceIdRaw : Number(serviceIdRaw)
  const nameCandidate =
    serviceNameRaw != null && String(serviceNameRaw).trim() !== '' ? String(serviceNameRaw).trim() : ''

  if (Number.isFinite(sidNum)) {
    const byId = await prisma.petshopService.findFirst({
      where: { id: sidNum, companyId, isActive: true },
      select: { id: true, name: true },
    })
    if (byId) return { id: byId.id, name: byId.name }
  }

  if (nameCandidate) {
    const exact = await prisma.petshopService.findMany({
      where: {
        companyId,
        isActive: true,
        name: { equals: nameCandidate, mode: 'insensitive' },
      },
      select: { id: true, name: true },
      take: 2,
    })
    if (exact.length === 1) return { id: exact[0]!.id, name: exact[0]!.name }

    const partial = await prisma.petshopService.findMany({
      where: {
        companyId,
        isActive: true,
        name: { contains: nameCandidate, mode: 'insensitive' },
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 8,
    })
    if (partial.length === 1) return { id: partial[0]!.id, name: partial[0]!.name }
    if (partial.length > 1) {
      return {
        error: `Vários serviços combinam com «${nameCandidate}». Use list_active_services e o id exato: ${partial.map((p) => `${p.id}=${p.name}`).join('; ')}.`,
      }
    }
  }

  return {
    error:
      'Serviço não identificado. Chame list_active_services e use o campo id do JSON (número inteiro) do serviço escolhido.',
  }
}

/** Valida UUID do pet do cliente ou resolve por nome (evita UUID inventado pelo modelo). */
async function resolveActionBrainPetId(
  companyId: number,
  clientIdUuid: string,
  petIdRaw: unknown,
  petNameRaw: unknown,
): Promise<{ id: string; name: string } | { error: string }> {
  const nameCandidate =
    petNameRaw != null && String(petNameRaw).trim() !== '' ? String(petNameRaw).trim() : ''
  const petRaw = petIdRaw != null && String(petIdRaw).trim() !== '' ? String(petIdRaw).trim() : ''
  const petUuid = parseOptionalUuid(petRaw)

  if (petUuid) {
    const byId = await prisma.petshopPet.findFirst({
      where: { id: petUuid, companyId, clientId: clientIdUuid, isActive: true },
      select: { id: true, name: true },
    })
    if (byId) return { id: byId.id, name: byId.name }
  }

  if (nameCandidate) {
    const exact = await prisma.petshopPet.findMany({
      where: {
        companyId,
        clientId: clientIdUuid,
        isActive: true,
        name: { equals: nameCandidate, mode: 'insensitive' },
      },
      select: { id: true, name: true },
      take: 2,
    })
    if (exact.length === 1) return { id: exact[0]!.id, name: exact[0]!.name }

    const partial = await prisma.petshopPet.findMany({
      where: {
        companyId,
        clientId: clientIdUuid,
        isActive: true,
        name: { contains: nameCandidate, mode: 'insensitive' },
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 8,
    })
    if (partial.length === 1) return { id: partial[0]!.id, name: partial[0]!.name }
    if (partial.length > 1) {
      return {
        error: `Vários pets combinam com «${nameCandidate}» neste cliente: ${partial.map((p) => `${p.name} (id ${p.id})`).join('; ')}. Use o id exato do JSON pets_catalog.`,
      }
    }
  }

  return {
    error:
      'Pet não identificado para este cliente. Chame get_client_pets_for_scheduling e use o id (UUID) do array pets; inclua pet_name igual ao campo name.',
  }
}

/** Resolve slot_id diretamente do banco por data+hora+especialidade do serviço. */
async function resolveSlotIdFromAvailable(
  companyId: number,
  scheduledDateYmd: string,
  serviceId: number,
  _petIdUuid: string | undefined,
  timeRaw: string,
): Promise<string | null> {
  const want = normalizeHhMm(timeRaw)
  if (!want) return null
  const [year, month, day] = scheduledDateYmd.split('-').map(Number)
  if (!year || !month || !day) return null
  const slotDate = new Date(Date.UTC(year, month - 1, day))
  const [hh, mm] = want.split(':').map(Number)
  const slotTime = new Date(Date.UTC(1970, 0, 1, hh, mm, 0))

  const service = await prisma.petshopService.findFirst({
    where: { id: serviceId, companyId },
    select: { specialtyId: true },
  })
  if (!service?.specialtyId) return null

  const slot = await prisma.petshopSlot.findFirst({
    where: {
      companyId,
      specialtyId: service.specialtyId,
      slotDate,
      slotTime,
      isBlocked: false,
    },
    select: { id: true, maxCapacity: true, usedCapacity: true },
  })
  if (!slot || slot.maxCapacity - slot.usedCapacity <= 0) return null
  return slot.id
}

function formatUtcHhMm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

type ManualScheduleItemPayload = {
  client_id: string
  client_name?: string
  pet_id: string
  pet_name: string
  service_id: number
  service_name: string
  slot_id: string
  scheduled_date: string
  time: string
  scheduled_at: string
  notes: string | null
}

/** Resolve slot e identidades; não grava agendamento (confirmação é no painel). */
async function brainResolveManualScheduleItem(
  companyId: number,
  raw: Record<string, unknown>,
): Promise<{ ok: true; item: ManualScheduleItemPayload } | { ok: false; message: string }> {
  let scheduled_date = String(raw.scheduled_date ?? '').trim()
  const clientRawManual = String(raw.client_id ?? '').trim()
  const timeRaw = raw.time != null ? String(raw.time).trim() : ''

  if (!isUuidString(clientRawManual)) {
    return { ok: false, message: 'client_id inválido.' }
  }

  const resolvedPetManual = await resolveActionBrainPetId(companyId, clientRawManual, raw.pet_id, raw.pet_name)
  if ('error' in resolvedPetManual) return { ok: false, message: resolvedPetManual.error }

  const resolvedSvc = await resolveActionBrainServiceId(companyId, raw.service_id, raw.service_name)
  if ('error' in resolvedSvc) return { ok: false, message: resolvedSvc.error }
  const service_id = resolvedSvc.id

  let slotId = String(raw.slot_id ?? '').trim()
  if ((!slotId || !isUuidString(slotId)) && timeRaw && /^\d{4}-\d{2}-\d{2}$/.test(scheduled_date)) {
    const resolved = await resolveSlotIdFromAvailable(
      companyId,
      scheduled_date,
      service_id,
      resolvedPetManual.id,
      timeRaw,
    )
    if (resolved) slotId = resolved
  }

  let timeNorm: string | null = normalizeHhMm(timeRaw)

  if (isUuidString(slotId)) {
    const slotProbe = await prisma.petshopSlot.findUnique({
      where: { id: slotId },
      select: { companyId: true, slotDate: true, slotTime: true },
    })
    if (!slotProbe || slotProbe.companyId !== companyId) {
      return { ok: false, message: 'slot_id inválido para esta empresa.' }
    }
    const slotDateKey = slotProbe.slotDate.toISOString().slice(0, 10)
    if (scheduled_date && scheduled_date !== slotDateKey) {
      return { ok: false, message: `scheduled_date (${scheduled_date}) não coincide com a data do slot (${slotDateKey}).` }
    }
    scheduled_date = slotDateKey
    if (!timeNorm) timeNorm = formatUtcHhMm(slotProbe.slotTime)
  }

  if (!isUuidString(slotId)) {
    return { ok: false, message: 'Informe slot_id (UUID) ou time (HH:MM) com scheduled_date.' }
  }
  if (!timeNorm) {
    return { ok: false, message: 'Informe time (HH:MM) ou slot_id com horário na grade.' }
  }

  const clientRow = await prisma.client.findFirst({
    where: { id: clientRawManual, companyId },
    select: { name: true },
  })

  const notes = raw.notes == null || raw.notes === '' ? null : String(raw.notes)

  return {
    ok: true,
    item: {
      client_id: clientRawManual,
      client_name: clientRow?.name ?? undefined,
      pet_id: resolvedPetManual.id,
      pet_name: resolvedPetManual.name,
      service_id,
      service_name: resolvedSvc.name,
      slot_id: slotId,
      scheduled_date,
      time: timeNorm,
      scheduled_at: `${scheduled_date}T${timeNorm}:00`,
      notes,
    },
  }
}

export const ACTION_BRAIN_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_campaign_draft',
      description:
        `Monta rascunho de campanha (JSON campaign_draft). **Uma** chamada com todos os client_ids. **message_template** = texto WhatsApp final, **sem** placeholders com chaves (ex.: nada de «duas chaves + nome»); saudação neutra («Olá,» / «Olá!») quando vários destinatários. Com **dois ou mais** client_ids, se o aviso for sobre **agendamento, remarcação ou cancelamento**, o texto deve ser **genérico**: a mesma mensagem para todos — **não** coloque nome de pet, data, hora ou serviço **de um** cliente que não se aplique aos outros. Para texto **100% personalizado** por cliente, use **uma campanha por vez** ou só um client_id. Promoções/avisos gerais: texto comum. Até ${SECOND_BRAIN_CAMPAIGN_DRAFT_MAX_TARGETS} UUIDs; max_recipients_per_send do plano.`,
      parameters: {
        type: 'object',
        properties: {
          client_ids: {
            type: 'array',
            items: { type: 'string' },
            description: `Todos os UUIDs dos clientes nesta campanha — até ${SECOND_BRAIN_CAMPAIGN_DRAFT_MAX_TARGETS} na lista (uma chamada só).`,
          },
          message_template: {
            type: 'string',
            description:
              'Texto único para todos; **sem** marcadores entre chaves duplas. 2+ clientes + aviso de agenda: texto genérico, sem dados de um agendamento que não valha para os outros.',
          },
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
      description:
        'Lista pets ativos: JSON type pets_catalog com array pets {id, name, species, breed, size}. Use sempre o id desse array; repasse também name em create_appointment_draft (pet_name).',
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
        'Lista serviços ativos: retorna JSON com type services_catalog e array services {id, name}. Sempre use o id desse JSON em get_available_times e nos rascunhos — não chute números.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_available_times',
      description:
        'Horários livres em uma data (YYYY-MM-DD). Serviço: service_id ou service_name (catálogo). Pet: pet_id do pets_catalog e pet_name (nome do animal); se o UUID estiver errado, passe client_id + pet_name para o servidor localizar.',
      parameters: {
        type: 'object',
        properties: {
          target_date: { type: 'string', description: 'Data YYYY-MM-DD.' },
          service_id: { type: 'number', description: 'ID numérico do catálogo (list_active_services).' },
          service_name: {
            type: 'string',
            description: 'Nome exato do serviço no catálogo, se precisar resolver o id (ex.: após o dono escolher por nome).',
          },
          client_id: { type: 'string', description: 'UUID do cliente (ajuda a corrigir pet_id errado).' },
          pet_id: { type: 'string', description: 'UUID do pet (pets_catalog).' },
          pet_name: { type: 'string', description: 'Nome do pet como no pets_catalog (obrigatório se pet_id puder estar errado).' },
        },
        required: ['target_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_appointment_draft',
      description:
        'Cartão de confirmação no painel. Sempre inclua pet_name (nome do animal como no pets_catalog) junto de pet_id — o servidor corrige UUID inventado pelo nome+cliente. Idem service_id + service_name.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string' },
          client_name: { type: 'string', description: 'Nome para exibição (opcional).' },
          pet_id: { type: 'string', description: 'UUID do pets_catalog (pode ser corrigido com pet_name).' },
          pet_name: { type: 'string', description: 'Nome do pet como no pets_catalog (obrigatório).' },
          service_id: { type: 'number', description: 'Preferir o id do list_active_services; pode omitir se só tiver service_name.' },
          service_name: { type: 'string', description: 'Nome do serviço como no catálogo (obrigatório se não tiver service_id válido).' },
          scheduled_date: { type: 'string', description: 'YYYY-MM-DD.' },
          time: { type: 'string', description: 'Horário como na grade (ex.: 09:00 ou 14:30).' },
          slot_id: {
            type: 'string',
            description: 'UUID do slot de get_available_times; se omitido ou inválido, resolve por data+serviço+time.',
          },
          notes: { type: 'string' },
          uses_consecutive_slots: { type: 'boolean' },
          paired_slot_time: { type: 'string' },
        },
        required: ['client_id', 'pet_id', 'pet_name', 'scheduled_date', 'time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_manual_appointment',
      description:
        'Gera rascunho de um agendamento para o dono confirmar no painel (não grava até o botão). Preferir create_appointment_draft quando quiser cartão com edição de notas. Passe time (HH:MM) ou slot_id.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string' },
          pet_id: { type: 'string' },
          pet_name: { type: 'string', description: 'Nome do pet (pets_catalog); corrige UUID errado.' },
          service_id: { type: 'number', description: 'Do catálogo; se duvidar, use service_name.' },
          service_name: { type: 'string', description: 'Nome do serviço como no catálogo (ajuda se o id estiver errado).' },
          slot_id: { type: 'string', description: 'UUID de get_available_times, se souber.' },
          time: { type: 'string', description: 'HH:MM — use se o dono escolheu um horário da lista e você não tem o slot_id.' },
          scheduled_date: { type: 'string', description: 'YYYY-MM-DD (deve bater com a data do slot).' },
          notes: { type: 'string' },
        },
        required: ['client_id', 'pet_id', 'pet_name', 'scheduled_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_appointments',
      description: `Lista agendamentos de **serviços na grade** (banho, consulta, etc.) em petshop_appointments — até ${BRAIN_SEARCH_APPOINTMENTS_MAX} com appointment_id (UUID) para cancelar/remarcar. **Não inclui hotel nem creche**; para hospedagem use search_lodging_reservations. Se o dono pedir cancelar vários sem ids, chame com from_date = hoje e to_date conforme o período.`,
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'UUID do cliente.' },
          pet_id: { type: 'string', description: 'UUID do pet.' },
          from_date: {
            type: 'string',
            description: 'YYYY-MM-DD inclusive (scheduledDate >=). Para “próximos” incluindo hoje, use a data de hoje do contexto.',
          },
          to_date: { type: 'string', description: 'YYYY-MM-DD inclusive (scheduledDate <=).' },
          include_cancelled: {
            type: 'boolean',
            description: 'Se true, inclui cancelados e no_show; padrão só ativos (pending, confirmed, …).',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_lodging_reservations',
      description:
        'Lista **reservas já existentes** de hotel ou creche (hospedagem). Não agenda nova hospedagem pelo assistente: para **criar** reserva ou ver **vagas/disponibilidade** na grade de hotel/creche, o dono deve usar a **guia Hospedagem** do painel. Use esta tool só para consultar reservas (quem, datas, tipo) quando o dono perguntar.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'UUID do cliente (opcional).' },
          type: {
            type: 'string',
            description: 'hotel | daycare ou omitir para ambos.',
            enum: ['hotel', 'daycare'],
          },
          from_date: {
            type: 'string',
            description: 'YYYY-MM-DD — reservas que ainda envolvem essa data (sobreposição com período).',
          },
          to_date: { type: 'string', description: 'YYYY-MM-DD inclusive (janela de busca).' },
          include_cancelled: {
            type: 'boolean',
            description: 'Se true, inclui canceladas; padrão só ativas/confirmadas/check-in.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_manual_appointments_batch',
      description: `Rascunho de vários agendamentos (máx. ${BRAIN_BATCH_APPOINTMENTS_MAX}) para confirmar no painel. Cada item: mesmo formato que create_manual_appointment.`,
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Lista de agendamentos.',
            maxItems: BRAIN_BATCH_APPOINTMENTS_MAX,
            items: {
              type: 'object',
              properties: {
                client_id: { type: 'string' },
                pet_id: { type: 'string' },
                pet_name: { type: 'string' },
                service_id: { type: 'number' },
                service_name: { type: 'string' },
                scheduled_date: { type: 'string' },
                time: { type: 'string' },
                slot_id: { type: 'string' },
                notes: { type: 'string' },
              },
              required: ['client_id', 'pet_id', 'pet_name', 'scheduled_date'],
            },
          },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reschedule_appointments_batch',
      description: `Rascunho para remarcar vários (máx. ${BRAIN_BATCH_APPOINTMENTS_MAX}) na grade; o dono confirma no painel. Por item: appointment_id + (new_slot_id OU new_scheduled_date + new_time). Par G/GG: cancelar e recriar.`,
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            maxItems: BRAIN_BATCH_APPOINTMENTS_MAX,
            items: {
              type: 'object',
              properties: {
                appointment_id: { type: 'string' },
                new_slot_id: { type: 'string' },
                new_scheduled_date: { type: 'string', description: 'YYYY-MM-DD com new_time.' },
                new_time: { type: 'string', description: 'HH:MM' },
              },
              required: ['appointment_id'],
            },
          },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_appointments_batch',
      description: `Rascunho para cancelar vários (máx. ${BRAIN_BATCH_APPOINTMENTS_MAX}); confirmação no painel. Par G/GG cancela em conjunto ao confirmar cada id.`,
      parameters: {
        type: 'object',
        properties: {
          appointment_ids: {
            type: 'array',
            items: { type: 'string' },
            maxItems: BRAIN_BATCH_APPOINTMENTS_MAX,
          },
          cancel_reason: { type: 'string', description: 'Motivo comum (opcional).' },
        },
        required: ['appointment_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_appointment',
      description:
        'Rascunho de cancelamento; o dono confirma no painel. UUID de search_appointments ou SQL. Par G/GG: ao confirmar, cancela o vínculo.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'UUID do agendamento.' },
          cancel_reason: { type: 'string', description: 'Motivo (opcional).' },
        },
        required: ['appointment_id'],
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
        select: { id: true, name: true, phone: true, manualPhone: true },
      })

      if (!found.length) return 'Nenhum cliente encontrado com os IDs fornecidos.'

      return JSON.stringify({
        type: 'campaign_draft',
        clients: found.map((c) => ({
          id: c.id,
          name: c.name ?? 'Cliente',
          manual_phone: (c.manualPhone ?? '').trim() || BRAIN_MANUAL_PHONE_EMPTY_LABEL,
          /** Canal WhatsApp (painel usa no envio; não exibir ao dono). */
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
        select: { id: true, name: true, manualPhone: true },
        take: 5,
      })

      if (!data.length) return JSON.stringify({ type: 'clients_not_found', name: q })

      return JSON.stringify({
        type: 'clients_found',
        clients: data.map((c) => ({
          id: c.id,
          name: c.name ?? '',
          manual_phone: (c.manualPhone ?? '').trim() || BRAIN_MANUAL_PHONE_EMPTY_LABEL,
        })),
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
            manualPhone: phone,
            email: (typeof args.email === 'string' ? args.email.trim() : null) || null,
            source: 'manual',
            conversationStage: 'initial',
          },
          select: { id: true, name: true, manualPhone: true },
        })

        return JSON.stringify({
          type: 'client_created',
          client: {
            id: data.id,
            name: data.name,
            manual_phone: (data.manualPhone ?? '').trim() || BRAIN_MANUAL_PHONE_EMPTY_LABEL,
          },
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
        type: 'pets_catalog',
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
      return JSON.stringify({
        type: 'services_catalog',
        services: rows.map((s) => ({ id: s.id, name: s.name })),
      })
    }

    case 'get_available_times': {
      const target_date = String(args.target_date ?? '')
      const clientForPet = String(args.client_id ?? '').trim()
      const petNameHint = String(args.pet_name ?? '').trim()
      const petArg =
        args.pet_id != null && String(args.pet_id).trim() !== '' ? String(args.pet_id).trim() : undefined

      const hasName = String(args.service_name ?? '').trim() !== ''
      const sidArg = args.service_id
      if (!Number.isFinite(Number(sidArg)) && !hasName) {
        return 'Informe service_id (número do JSON services_catalog) ou service_name exatamente como no catálogo.'
      }

      let pet_id: string | undefined
      if (isUuidString(clientForPet) && (petArg || petNameHint)) {
        const pr = await resolveActionBrainPetId(companyId, clientForPet, petArg, petNameHint || undefined)
        if ('error' in pr) return pr.error
        pet_id = pr.id
      } else if (petArg) {
        const u = parseOptionalUuid(petArg)
        if (!u) {
          return 'pet_id inválido: use o UUID do JSON pets_catalog. Se necessário, passe client_id e pet_name para localizar o pet.'
        }
        const ex = await prisma.petshopPet.findFirst({
          where: { id: u, companyId, isActive: true },
          select: { id: true },
        })
        if (!ex) {
          return 'pet_id não encontrado. Passe client_id (UUID) e pet_name como no pets_catalog.'
        }
        pet_id = u
      } else if (petNameHint && !isUuidString(clientForPet)) {
        return 'Para usar pet_name na grade, informe também client_id (UUID do cliente).'
      }

      const resolvedSvc = await resolveActionBrainServiceId(companyId, sidArg, args.service_name)
      if ('error' in resolvedSvc) return resolvedSvc.error
      const service_id = resolvedSvc.id

      // Resolve specialty_id from service
      const svcForSpec = await prisma.petshopService.findFirst({
        where: { id: service_id, companyId },
        select: { specialtyId: true },
      })
      if (!svcForSpec?.specialtyId) return 'Serviço não tem especialidade vinculada.'

      const result = await computeStaffAvailability(companyId, {
        specialty_id: svcForSpec.specialtyId,
        date: target_date,
        service_id: String(service_id),
        pet_id,
      })
      return JSON.stringify({
        type: 'available_times',
        date: result.date,
        available_times: result.available_slots,
        total_available: result.available_slots.length,
      })
    }

    case 'create_appointment_draft': {
      const scheduled_date = String(args.scheduled_date ?? '').trim()
      const timeRaw = String(args.time ?? '').trim()
      const clientRaw = String(args.client_id ?? '').trim()

      if (!isUuidString(clientRaw)) {
        return 'client_id inválido: use o UUID de search_clients.'
      }

      const resolvedPet = await resolveActionBrainPetId(companyId, clientRaw, args.pet_id, args.pet_name)
      if ('error' in resolvedPet) return resolvedPet.error
      const petCanonicalId = resolvedPet.id

      const resolvedSvc = await resolveActionBrainServiceId(companyId, args.service_id, args.service_name)
      if ('error' in resolvedSvc) return resolvedSvc.error
      const service_id = resolvedSvc.id
      const serviceNameCanonical = resolvedSvc.name
      if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduled_date)) {
        return 'scheduled_date deve ser YYYY-MM-DD.'
      }
      const timeNorm = normalizeHhMm(timeRaw)
      if (!timeNorm) {
        return 'Informe time no formato HH:MM (ex.: 14:30).'
      }

      let slotId = String(args.slot_id ?? '').trim()
      if (!isUuidString(slotId)) {
        const resolved = await resolveSlotIdFromAvailable(
          companyId,
          scheduled_date,
          service_id,
          petCanonicalId,
          timeRaw,
        )
        if (!resolved) {
          return 'Não encontrei esse horário livre na grade para essa data/serviço/pet. Chame get_available_times de novo e use um horário listado.'
        }
        slotId = resolved
      }

      const slotProbe = await prisma.petshopSlot.findUnique({
        where: { id: slotId },
        select: { companyId: true, slotDate: true },
      })
      if (!slotProbe || slotProbe.companyId !== companyId) {
        return 'Slot inválido para esta empresa.'
      }

      const petDisplayName =
        args.pet_name != null && String(args.pet_name).trim() !== '' ? String(args.pet_name).trim() : resolvedPet.name

      return JSON.stringify({
        type: 'appointment_draft',
        client_id: clientRaw,
        client_name: args.client_name != null ? String(args.client_name) : undefined,
        pet_id: petCanonicalId,
        pet_name: petDisplayName,
        service_id,
        service_name:
          args.service_name != null && String(args.service_name).trim() !== ''
            ? String(args.service_name)
            : serviceNameCanonical,
        slot_id: slotId,
        scheduled_date,
        time: timeNorm,
        notes: args.notes == null || args.notes === '' ? null : String(args.notes),
        uses_consecutive_slots: args.uses_consecutive_slots === true ? true : undefined,
        paired_slot_time:
          args.paired_slot_time != null && String(args.paired_slot_time).trim() !== ''
            ? String(args.paired_slot_time).trim()
            : undefined,
      })
    }

    case 'create_manual_appointment': {
      const out = await brainResolveManualScheduleItem(companyId, args)
      if (!out.ok) return `Rascunho inválido: ${out.message}`
      return JSON.stringify({ type: 'manual_schedule_draft', ...out.item })
    }

    case 'search_appointments': {
      const includeCancelled = args.include_cancelled === true
      const where: {
        companyId: number
        clientId?: string
        petId?: string
        status?: { notIn: string[] }
        scheduledDate?: { gte?: Date; lte?: Date }
      } = { companyId }
      const scid = String(args.client_id ?? '').trim()
      if (scid && isUuidString(scid)) where.clientId = scid
      const spid = String(args.pet_id ?? '').trim()
      if (spid && isUuidString(spid)) where.petId = spid
      if (!includeCancelled) {
        where.status = { notIn: ['cancelled', 'no_show'] }
      }
      const fd = String(args.from_date ?? '').trim()
      const td = String(args.to_date ?? '').trim()
      const scheduledFilter: { gte?: Date; lte?: Date } = {}
      if (/^\d{4}-\d{2}-\d{2}$/.test(fd)) {
        const y = Number(fd.slice(0, 4))
        const m = Number(fd.slice(5, 7))
        const d = Number(fd.slice(8, 10))
        scheduledFilter.gte = new Date(Date.UTC(y, m - 1, d))
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(td)) {
        const y = Number(td.slice(0, 4))
        const m = Number(td.slice(5, 7))
        const d = Number(td.slice(8, 10))
        scheduledFilter.lte = new Date(Date.UTC(y, m - 1, d))
      }
      if (scheduledFilter.gte != null || scheduledFilter.lte != null) {
        where.scheduledDate = scheduledFilter
      }

      const rows = await prisma.petshopAppointment.findMany({
        where,
        take: BRAIN_SEARCH_APPOINTMENTS_MAX,
        orderBy: { scheduledDate: 'desc' },
        select: {
          id: true,
          clientId: true,
          petId: true,
          serviceId: true,
          slotId: true,
          status: true,
          scheduledDate: true,
          client: { select: { name: true } },
          pet: { select: { name: true } },
          service: { select: { name: true } },
          slot: { select: { slotDate: true, slotTime: true } },
        },
      })

      return JSON.stringify({
        type: 'appointments_found',
        total_returned: rows.length,
        appointments: rows.map((r) => ({
          appointment_id: r.id,
          client_id: r.clientId,
          client_name: r.client?.name ?? null,
          pet_id: r.petId,
          pet_name: r.pet?.name ?? null,
          service_id: r.serviceId,
          service_name: r.service?.name ?? null,
          slot_id: r.slotId,
          status: r.status,
          scheduled_date: r.scheduledDate ? r.scheduledDate.toISOString().slice(0, 10) : null,
          time: r.slot?.slotTime ? formatUtcHhMm(r.slot.slotTime) : null,
        })),
      })
    }

    case 'search_lodging_reservations': {
      const includeLodgingCancelled = args.include_cancelled === true
      const where: {
        companyId: number
        clientId?: string
        type?: string
        status?: { notIn: string[] }
        AND?: Array<Record<string, unknown>>
      } = { companyId }
      const lcid = String(args.client_id ?? '').trim()
      if (lcid && isUuidString(lcid)) where.clientId = lcid
      const lodgType = String(args.type ?? '').trim().toLowerCase()
      if (lodgType === 'hotel' || lodgType === 'daycare') where.type = lodgType
      if (!includeLodgingCancelled) {
        where.status = { notIn: ['cancelled'] }
      }
      const lf = String(args.from_date ?? '').trim()
      const lt = String(args.to_date ?? '').trim()
      if (/^\d{4}-\d{2}-\d{2}$/.test(lf) && /^\d{4}-\d{2}-\d{2}$/.test(lt)) {
        const y1 = Number(lf.slice(0, 4))
        const m1 = Number(lf.slice(5, 7))
        const d1 = Number(lf.slice(8, 10))
        const y2 = Number(lt.slice(0, 4))
        const m2 = Number(lt.slice(5, 7))
        const d2 = Number(lt.slice(8, 10))
        const start = new Date(Date.UTC(y1, m1 - 1, d1))
        const end = new Date(Date.UTC(y2, m2 - 1, d2))
        where.AND = [{ checkinDate: { lte: end } }, { checkoutDate: { gte: start } }]
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(lf)) {
        const y = Number(lf.slice(0, 4))
        const m = Number(lf.slice(5, 7))
        const d = Number(lf.slice(8, 10))
        const start = new Date(Date.UTC(y, m - 1, d))
        where.AND = [{ checkoutDate: { gte: start } }]
      }

      const lrows = await prisma.petshopLodgingReservation.findMany({
        where,
        take: BRAIN_SEARCH_APPOINTMENTS_MAX,
        orderBy: { checkinDate: 'asc' },
        select: {
          id: true,
          type: true,
          status: true,
          checkinDate: true,
          checkoutDate: true,
          client: { select: { name: true } },
          pet: { select: { name: true } },
          roomType: { select: { name: true } },
        },
      })

      return JSON.stringify({
        type: 'lodging_reservations_found',
        total_returned: lrows.length,
        reservations: lrows.map((r) => ({
          reservation_id: r.id,
          lodging_type: r.type === 'daycare' ? 'creche' : 'hotel',
          status: r.status,
          checkin_date: r.checkinDate ? r.checkinDate.toISOString().slice(0, 10) : null,
          checkout_date: r.checkoutDate ? r.checkoutDate.toISOString().slice(0, 10) : null,
          client_name: r.client?.name ?? null,
          pet_name: r.pet?.name ?? null,
          room_type_name: r.roomType?.name ?? null,
        })),
      })
    }

    case 'create_manual_appointments_batch': {
      const rawItems = Array.isArray(args.items) ? args.items : []
      const items = rawItems.slice(0, BRAIN_BATCH_APPOINTMENTS_MAX) as Record<string, unknown>[]
      if (!items.length) return 'Informe items (array não vazio).'
      const resolved: ManualScheduleItemPayload[] = []
      for (let i = 0; i < items.length; i++) {
        const o = await brainResolveManualScheduleItem(companyId, items[i]!)
        if (!o.ok) return `Item ${i}: ${o.message}`
        resolved.push(o.item)
      }
      return JSON.stringify({
        type: 'manual_schedule_batch_draft',
        items: resolved,
      })
    }

    case 'reschedule_appointments_batch': {
      const rawRe = Array.isArray(args.items) ? args.items : []
      const reItems = rawRe.slice(0, BRAIN_BATCH_APPOINTMENTS_MAX) as Record<string, unknown>[]
      if (!reItems.length) return 'Informe items (array não vazio).'
      const actionable: Record<string, unknown>[] = []
      for (const it of reItems) {
        const aid = String(it.appointment_id ?? '').trim()
        if (!isUuidString(aid)) continue
        const row = await prisma.petshopAppointment.findFirst({
          where: { id: aid, companyId },
          include: {
            client: { select: { name: true } },
            pet: { select: { name: true } },
            service: { select: { name: true } },
            slot: { select: { slotDate: true, slotTime: true } },
          },
        })
        if (!row || row.status === 'cancelled' || row.status === 'no_show') continue
        const nsRaw = String(it.new_slot_id ?? '').trim()
        const nd = String(it.new_scheduled_date ?? '').trim()
        const ntRaw = String(it.new_time ?? '').trim()
        const hasSlot = isUuidString(nsRaw)
        const ntNorm = normalizeHhMm(ntRaw)
        const hasDateTime = /^\d{4}-\d{2}-\d{2}$/.test(nd) && ntNorm != null
        if (!hasSlot && !hasDateTime) continue
        const d = row.scheduledDate ? row.scheduledDate.toISOString().slice(0, 10) : ''
        const t = row.slot?.slotTime ? formatUtcHhMm(row.slot.slotTime) : ''
        const summary = [row.client?.name, row.pet?.name, row.service?.name, d && t ? `${d} ${t}` : '']
          .filter((x) => x && String(x).trim() !== '')
          .join(' · ')
        actionable.push({
          appointment_id: aid,
          ...(hasSlot ? { new_slot_id: nsRaw } : {}),
          ...(hasDateTime ? { new_scheduled_date: nd, new_time: ntNorm } : {}),
          summary,
        })
      }
      if (!actionable.length) {
        return 'Nenhuma remarcação válida para montar o rascunho. Use appointment_id (UUID) retornado por search_appointments, agendamento ainda ativo, e informe new_slot_id OU new_scheduled_date + new_time (HH:MM). Não invente UUIDs se a busca não retornou agendamentos.'
      }
      return JSON.stringify({
        type: 'reschedule_appointments_batch_draft',
        items: actionable,
      })
    }

    case 'cancel_appointments_batch': {
      const rawIds = Array.isArray(args.appointment_ids) ? args.appointment_ids : []
      const ids = rawIds.slice(0, BRAIN_BATCH_APPOINTMENTS_MAX).map((x) => String(x).trim())
      if (!ids.length) return 'Informe appointment_ids (array não vazio).'
      const reason =
        args.cancel_reason != null && String(args.cancel_reason).trim() !== ''
          ? String(args.cancel_reason).trim()
          : null
      const valid: { appointment_id: string; summary: string }[] = []
      for (const id of ids) {
        if (!isUuidString(id)) continue
        const row = await prisma.petshopAppointment.findFirst({
          where: { id, companyId },
          include: {
            client: { select: { name: true } },
            pet: { select: { name: true } },
            service: { select: { name: true } },
            slot: { select: { slotDate: true, slotTime: true } },
          },
        })
        if (!row || row.status === 'cancelled' || row.status === 'no_show') continue
        const d = row.scheduledDate ? row.scheduledDate.toISOString().slice(0, 10) : ''
        const t = row.slot?.slotTime ? formatUtcHhMm(row.slot.slotTime) : ''
        const summary = [row.client?.name, row.pet?.name, row.service?.name, d && t ? `${d} ${t}` : '']
          .filter((x) => x && String(x).trim() !== '')
          .join(' · ')
        valid.push({ appointment_id: id, summary })
      }
      if (!valid.length) {
        return 'Nenhum cancelamento em lote: nenhum appointment_id válido e ativo encontrado. Chame search_appointments e use só UUIDs retornados por ela. Se não houver agendamentos no período, explique isso ao dono **sem** enviar JSON de rascunho.'
      }
      return JSON.stringify({
        type: 'cancel_appointments_batch_draft',
        appointment_ids: valid.map((v) => v.appointment_id),
        cancel_reason: reason,
        summaries: valid,
      })
    }

    case 'cancel_appointment': {
      const aid = String(args.appointment_id ?? '').trim()
      const reasonRaw = args.cancel_reason
      const cancel_reason =
        reasonRaw != null && String(reasonRaw).trim() !== '' ? String(reasonRaw).trim() : null
      if (!isUuidString(aid)) return 'appointment_id inválido.'
      const row = await prisma.petshopAppointment.findFirst({
        where: { id: aid, companyId },
        include: {
          client: { select: { name: true } },
          pet: { select: { name: true } },
          service: { select: { name: true } },
          slot: { select: { slotDate: true, slotTime: true } },
        },
      })
      if (!row) return 'Agendamento não encontrado.'
      if (row.status === 'cancelled' || row.status === 'no_show') {
        return 'Este agendamento já está encerrado ou cancelado.'
      }
      const d = row.scheduledDate ? row.scheduledDate.toISOString().slice(0, 10) : ''
      const t = row.slot?.slotTime ? formatUtcHhMm(row.slot.slotTime) : ''
      const summary = [row.client?.name, row.pet?.name, row.service?.name, d && t ? `${d} ${t}` : '']
        .filter((x) => x && String(x).trim() !== '')
        .join(' · ')
      return JSON.stringify({
        type: 'cancel_appointment_draft',
        appointment_id: aid,
        cancel_reason,
        summary,
      })
    }

    default:
      return 'Ferramenta não encontrada.'
  }
}
