import { prisma } from '../../lib/prisma'
import { isUuidString, parseOptionalUuid } from '../../lib/uuidValidation'
import { computeAvailableSlotsResponse } from '../appointments/availableSlotsQuery'
import { createManualScheduleAppointment } from '../appointments/manualScheduleCore'

function todayBR(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10)
}

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_appointments_today',
      description: 'Retorna a lista completa de agendamentos de hoje com nome do cliente, pet, serviço e status de confirmação.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_upcoming_appointments',
      description: 'Retorna os próximos agendamentos futuros do petshop.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Quantos dias à frente buscar. Padrão: 7.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_lost_clients',
      description: 'Retorna clientes que não agendaram há mais de X dias.',
      parameters: {
        type: 'object',
        properties: {
          min_days: { type: 'number', description: 'Número mínimo de dias de ausência. Padrão: 45.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_revenue_by_month',
      description: 'Retorna o faturamento mensal dos últimos meses.',
      parameters: {
        type: 'object',
        properties: {
          months: { type: 'number', description: 'Quantos meses retroativos. Padrão: 6.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_top_services',
      description: 'Retorna os serviços mais vendidos com participação no faturamento e ticket médio.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_client_info',
      description: 'Busca informações de um cliente pelo nome: pets, histórico de visitas, último agendamento.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nome do cliente (parcial ou completo).' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_lodging_availability',
      description: 'Retorna a disponibilidade de vagas no hotel e creche nos próximos dias. Use para perguntas sobre vagas, hospedagem, hotel cheio.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Quantos dias à frente verificar. Padrão: 14.' },
          type: { type: 'string', description: 'Filtrar por tipo: "hotel" ou "daycare". Omitir para trazer ambos.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_churn_risk_clients',
      description: 'Retorna clientes com risco alto de churn com base nas análises de sentimento do mês.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pet_birthdays',
      description: 'Retorna pets que fazem aniversário em breve.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Quantos dias à frente verificar. Padrão: 7.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_uncharged_appointments',
      description: 'Retorna agendamentos concluídos sem valor registrado, que afetam o faturamento do dashboard.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_cancellations_analysis',
      description:
        'Retorna análise de cancelamentos recentes. Use quando o usuário perguntar sobre cancelamentos ou quando houver alerta de cancelamentos em série.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Janela em dias. Padrão: 7.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_revenue_forecast',
      description:
        'Projeta o faturamento do mês atual com base no ritmo de agendamentos concluídos até hoje. Use para projeção, meta ou tendência do mês.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_best_clients',
      description:
        'Retorna ranking dos melhores clientes por valor gasto e frequência de visitas (concluídos).',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Quantidade de clientes. Padrão: 5.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_idle_slots',
      description:
        'Identifica dias da semana com menor volume de agendamentos nos últimos 60 dias. Use para promoção ou ajuste de capacidade.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_high_value_lost_clients',
      description:
        'Clientes com histórico de gasto que estão ausentes há mais de X dias. Ideal para campanhas de reativação.',
      parameters: {
        type: 'object',
        properties: {
          min_days: { type: 'number', description: 'Mínimo de dias ausente. Padrão: 30.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_campaign_draft',
      description:
        'Monta draft de campanha de reativação: retorna JSON type campaign_draft para o painel enviar pelo WhatsApp. Use com client_ids e message_template.',
      parameters: {
        type: 'object',
        properties: {
          client_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'IDs (UUID) dos clientes alvo.',
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

export async function executeTool(name: string, args: any, companyId: number): Promise<string> {
  switch (name) {

    case 'get_appointments_today': {
      const today = todayBR()
      const data = await prisma.$queryRaw<Array<{ service_name: string; confirmed: boolean; status: string; client_id: string }>>`
        SELECT service_name, confirmed, status, client_id
        FROM dashboard_appointment_metrics
        WHERE company_id = ${companyId}
          AND scheduled_date::text = ${today}
          AND status <> 'cancelled'
      `

      if (!data || data.length === 0) return 'Nenhum agendamento para hoje.'

      const clientIds = [...new Set(data.map(d => d.client_id))]
      const clients = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT id, name FROM clients WHERE id = ANY(${clientIds}::uuid[])
      `
      const clientMap = Object.fromEntries(clients.map(c => [c.id, c.name]))

      return data.map(a =>
        `• ${clientMap[a.client_id] ?? 'Cliente'} — ${a.service_name} — ${a.confirmed ? '✅ Confirmado' : '⏳ Pendente'}`
      ).join('\n')
    }

    case 'get_upcoming_appointments': {
      const days = args.days ?? 7
      const today = todayBR()
      const future = new Date()
      future.setDate(future.getDate() + days)
      const futureStr = future.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10)

      const data = await prisma.$queryRaw<Array<{ scheduled_date: string | Date; service_name: string; confirmed: boolean; client_id: string }>>`
        SELECT scheduled_date, service_name, confirmed, client_id
        FROM dashboard_appointment_metrics
        WHERE company_id = ${companyId}
          AND status = 'pending'
          AND scheduled_date > ${today}::date
          AND scheduled_date <= ${futureStr}::date
        ORDER BY scheduled_date
      `

      if (!data || data.length === 0) return `Nenhum agendamento nos próximos ${days} dias.`

      const clientIds = [...new Set(data.map(d => d.client_id))]
      const clients = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT id, name FROM clients WHERE id = ANY(${clientIds}::uuid[])
      `
      const clientMap = Object.fromEntries(clients.map(c => [c.id, c.name]))

      return `${data.length} agendamento(s) nos próximos ${days} dias:\n` +
        data.map(a => {
          const date = new Date(String(a.scheduled_date) + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })
          return `• ${date} — ${clientMap[a.client_id] ?? 'Cliente'} — ${a.service_name} — ${a.confirmed ? '✅' : '⏳ não confirmado'}`
        }).join('\n')
    }

    case 'get_lost_clients': {
      const minDays = args.min_days ?? 45
      const data = await prisma.$queryRaw<Array<{ client_name: string; pet_name: string; last_visit: string | null; days_absent: number }>>`
        SELECT client_name, pet_name, last_visit, days_absent
        FROM dashboard_client_recurrence
        WHERE company_id = ${companyId}
          AND days_absent > ${minDays}
        ORDER BY days_absent DESC
      `

      if (!data || data.length === 0) return `Nenhum cliente sumido há mais de ${minDays} dias.`
      return `${data.length} cliente(s) sumidos há mais de ${minDays} dias:\n` +
        data.map(c =>
          `• ${c.client_name} (${c.pet_name}) — última visita: ${c.last_visit ? new Date(String(c.last_visit) + 'T12:00:00').toLocaleDateString('pt-BR') : 'nunca'} (${c.days_absent} dias atrás)`
        ).join('\n')
    }

    case 'get_revenue_by_month': {
      const months = args.months ?? 6
      const startDate = new Date()
      startDate.setMonth(startDate.getMonth() - (months - 1))
      startDate.setDate(1)
      const startStr = startDate.toISOString().slice(0, 10)

      const data = await prisma.$queryRaw<Array<{ month: string | Date; revenue: number | null }>>`
        SELECT month, revenue
        FROM dashboard_appointment_metrics
        WHERE company_id = ${companyId}
          AND status = 'completed'
          AND scheduled_date >= ${startStr}::date
      `

      const grouped: Record<string, number> = {}
      for (const row of data ?? []) {
        const key = String(row.month).slice(0, 7)
        grouped[key] = (grouped[key] ?? 0) + Number(row.revenue ?? 0)
      }

      const MONTHS: Record<string, string> = {
        '01': 'Jan', '02': 'Fev', '03': 'Mar', '04': 'Abr',
        '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Ago',
        '09': 'Set', '10': 'Out', '11': 'Nov', '12': 'Dez',
      }

      if (Object.keys(grouped).length === 0) return 'Sem dados de faturamento para o período.'
      return Object.entries(grouped)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, total]) => {
          const [year, m] = month.split('-')
          return `• ${MONTHS[m!] ?? m}/${year}: R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
        }).join('\n')
    }

    case 'get_top_services': {
      const data = await prisma.$queryRaw<Array<{ service_name: string; revenue: number | null }>>`
        SELECT service_name, revenue
        FROM dashboard_appointment_metrics
        WHERE company_id = ${companyId}
          AND status = 'completed'
      `

      const grouped: Record<string, { total: number; revenue: number }> = {}
      let grand = 0
      for (const row of data ?? []) {
        if (!grouped[row.service_name]) grouped[row.service_name] = { total: 0, revenue: 0 }
        grouped[row.service_name]!.total++
        grouped[row.service_name]!.revenue += Number(row.revenue ?? 0)
        grand += Number(row.revenue ?? 0)
      }

      if (Object.keys(grouped).length === 0) return 'Sem dados de serviços.'
      return Object.entries(grouped)
        .sort(([, a], [, b]) => b.revenue - a.revenue)
        .map(([name, v]) => {
          const pct = grand > 0 ? ((v.revenue / grand) * 100).toFixed(1) : '0'
          const ticket = v.total > 0 ? (v.revenue / v.total).toFixed(2) : '0'
          return `• ${name}: ${v.total} atendimentos — R$ ${v.revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${pct}%) — ticket médio R$ ${Number(ticket).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
        }).join('\n')
    }

    case 'get_client_info': {
      const searchName = `%${args.name}%`
      const clients = await prisma.$queryRaw<Array<{ id: string; name: string | null; phone: string; last_message_at: string | null }>>`
        SELECT id, name, phone, last_message_at
        FROM clients
        WHERE company_id = ${companyId}
          AND name ILIKE ${searchName}
        LIMIT 5
      `

      if (!clients || clients.length === 0) return `Nenhum cliente encontrado com o nome "${args.name}".`
      const client = clients[0]!

      const pets = await prisma.$queryRaw<Array<{ name: string; species: string; breed: string | null; size: string | null }>>`
        SELECT name, species, breed, size
        FROM petshop_pets
        WHERE client_id = ${client.id}::uuid
          AND is_active = true
      `

      const lastAppt = await prisma.$queryRaw<Array<{ scheduled_date: string | Date; service_name: string; status: string }>>`
        SELECT scheduled_date, service_name, status
        FROM dashboard_appointment_metrics
        WHERE company_id = ${companyId}
          AND client_id = ${client.id}::uuid
          AND status = 'completed'
        ORDER BY scheduled_date DESC
        LIMIT 3
      `

      const petsStr = pets?.map(p => `${p.name} (${p.species}, ${p.breed ?? 'Sem raça definida'}, porte ${p.size ?? '?'})`).join(', ') ?? 'nenhum pet cadastrado'
      const histStr = lastAppt?.map(a => `${new Date(String(a.scheduled_date) + 'T12:00:00').toLocaleDateString('pt-BR')} — ${a.service_name}`).join('\n  ') ?? 'sem histórico'
      return `👤 ${client.name}\n📱 ${client.phone}\n🐾 Pets: ${petsStr}\n📋 Últimas visitas:\n  ${histStr}`
    }

    case 'get_lodging_availability': {
      const days = args.days ?? 14
      const today = todayBR()
      const future = new Date()
      future.setDate(future.getDate() + days)
      const futureStr = future.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10)

      type LodgingRow = { check_date: string | Date; type: string; max_capacity: number; occupied_capacity: number; available_capacity: number }
      type RoomTypeRow = { lodging_type: string; room_type_name: string; daily_rate: string; total_capacity: number; min_available: number }

      // Fetch global availability (respects fallback: room types > legacy capacity)
      let data: LodgingRow[]
      if (args.type) {
        data = await prisma.$queryRaw<LodgingRow[]>`
          SELECT check_date, type, max_capacity, occupied_capacity, available_capacity
          FROM vw_lodging_availability
          WHERE company_id = ${companyId}
            AND check_date >= ${today}::date
            AND check_date <= ${futureStr}::date
            AND type = ${args.type}
          ORDER BY check_date
        `
      } else {
        data = await prisma.$queryRaw<LodgingRow[]>`
          SELECT check_date, type, max_capacity, occupied_capacity, available_capacity
          FROM vw_lodging_availability
          WHERE company_id = ${companyId}
            AND check_date >= ${today}::date
            AND check_date <= ${futureStr}::date
          ORDER BY check_date
        `
      }

      if (!data || data.length === 0) return 'Sem dados de disponibilidade para o período.'

      // Fetch room type breakdown (only if room types are configured)
      const roomTypeData = await prisma.$queryRaw<RoomTypeRow[]>`
        SELECT
          lodging_type,
          room_type_name,
          daily_rate::text,
          total_capacity,
          MIN(available_capacity) AS min_available
        FROM vw_room_type_availability
        WHERE company_id = ${companyId}
          AND check_date >= ${today}::date
          AND check_date <= ${futureStr}::date
        GROUP BY lodging_type, room_type_id, room_type_name, daily_rate, total_capacity
        ORDER BY lodging_type, daily_rate::numeric ASC
      `

      const byType: Record<string, LodgingRow[]> = {}
      for (const row of data) {
        if (!byType[row.type]) byType[row.type] = []
        byType[row.type]!.push(row)
      }

      const roomTypesByLodging: Record<string, RoomTypeRow[]> = {}
      for (const row of roomTypeData) {
        if (!roomTypesByLodging[row.lodging_type]) roomTypesByLodging[row.lodging_type] = []
        roomTypesByLodging[row.lodging_type]!.push(row)
      }

      return Object.entries(byType).map(([type, rows]) => {
        const label = type === 'hotel' ? '🏨 Hotel' : '🐾 Creche'
        const lines = rows.map(r => {
          const date = new Date(String(r.check_date) + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
          const status = r.available_capacity === 0 ? '🔴 LOTADO' : r.available_capacity === 1 ? '🟡 quase cheio' : '🟢 disponível'
          return `  ${date}: ${r.occupied_capacity}/${r.max_capacity} ocupados ${status}`
        }).join('\n')

        // Append room type breakdown if configured
        const rtRows = roomTypesByLodging[type] ?? []
        const rtSection = rtRows.length > 0
          ? '\n  Tipos de quarto:\n' + rtRows.map(rt => {
              const avail = Number(rt.min_available)
              const statusIcon = avail === 0 ? '🔴' : avail === 1 ? '🟡' : '🟢'
              return `    ${statusIcon} ${rt.room_type_name}: ${avail}/${rt.total_capacity} vagas — R$${Number(rt.daily_rate).toFixed(2)}/dia`
            }).join('\n')
          : ''

        return `${label}:\n${lines}${rtSection}`
      }).join('\n\n')
    }

    case 'get_churn_risk_clients': {
      const data = await prisma.$queryRaw<Array<{ client_id: string; tom_cliente: string; motivo_principal: string }>>`
        SELECT client_id, tom_cliente, motivo_principal
        FROM client_sentiment_analysis
        WHERE company_id = ${companyId}
          AND risco_churn = 'alto'
          AND analyzed_month >= date_trunc('month', now())::date
      `

      if (!data || data.length === 0) return 'Nenhum cliente com risco alto de churn neste mês.'

      const clientIds = data.map(d => d.client_id)
      const clients = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT id, name FROM clients WHERE id = ANY(${clientIds}::uuid[])
      `
      const clientMap = Object.fromEntries(clients.map(c => [c.id, c.name]))

      return `${data.length} cliente(s) com risco alto de churn:\n` +
        data.map(d =>
          `• ${clientMap[d.client_id] ?? 'Cliente'} — tom: ${d.tom_cliente} — motivo: ${d.motivo_principal}`
        ).join('\n')
    }

    case 'get_pet_birthdays': {
      const days = args.days ?? 7
      try {
        const data = await prisma.$queryRaw<Array<{ pet_name: string; client_name: string; birth_date: string; days_until: number }>>`
          SELECT * FROM get_pet_birthdays_next_days(${companyId}::int, ${days}::int)
        `
        if (!data || data.length === 0) return `Nenhum pet faz aniversário nos próximos ${days} dias.`
        return `${data.length} pet(s) fazem aniversário nos próximos ${days} dias:\n` +
          data.map(p => {
            const bday = new Date(String(p.birth_date) + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
            return `• ${p.pet_name} (tutor: ${p.client_name}) — aniversário: ${bday} — em ${p.days_until} dia(s)`
          }).join('\n')
      } catch {
        return `Nenhum pet faz aniversário nos próximos ${days} dias.`
      }
    }

    case 'get_uncharged_appointments': {
      const data = await prisma.$queryRaw<Array<{ id: string; scheduled_date: string | Date; client_id: string }>>`
        SELECT id, scheduled_date, client_id
        FROM petshop_appointments
        WHERE company_id = ${companyId}
          AND status = 'completed'
          AND price_charged IS NULL
        ORDER BY scheduled_date DESC
        LIMIT 20
      `

      if (!data || data.length === 0) return 'Todos os atendimentos concluídos têm valor registrado. ✅'

      const clientIds = [...new Set(data.map(d => d.client_id))]
      const clients = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT id, name FROM clients WHERE id = ANY(${clientIds}::uuid[])
      `
      const clientMap = Object.fromEntries(clients.map(c => [c.id, c.name]))

      return `${data.length} atendimento(s) sem valor registrado:\n` +
        data.map(a => {
          const date = new Date(String(a.scheduled_date) + 'T12:00:00').toLocaleDateString('pt-BR')
          return `• ${date} — ${clientMap[a.client_id] ?? 'Cliente'}`
        }).join('\n')
    }

    case 'get_cancellations_analysis': {
      const days = args.days ?? 7
      const since = new Date()
      since.setDate(since.getDate() - days)
      const sinceIso = since.toISOString()

      const rows = await prisma.$queryRaw<
        Array<{ scheduled_date: Date | string; cancel_reason: string | null; service_id: number; client_id: string }>
      >`
        SELECT scheduled_date, cancel_reason, service_id, client_id
        FROM petshop_appointments
        WHERE company_id = ${companyId}
          AND status = 'cancelled'
          AND cancelled_at IS NOT NULL
          AND cancelled_at >= ${sinceIso}::timestamptz
      `

      if (!rows || rows.length === 0) return `Nenhum cancelamento nos últimos ${days} dias.`

      const serviceIds = [...new Set(rows.map((d) => d.service_id))]
      const services = await prisma.petshopService.findMany({
        where: { id: { in: serviceIds }, companyId },
        select: { id: true, name: true },
      })
      const svcMap = Object.fromEntries(services.map((s) => [s.id, s.name]))

      const byReason: Record<string, number> = {}
      for (const a of rows) {
        const r = a.cancel_reason || 'Motivo não informado'
        byReason[r] = (byReason[r] ?? 0) + 1
      }

      const lines = Object.entries(byReason)
        .sort(([, a], [, b]) => b - a)
        .map(([reason, count]) => `• ${reason}: ${count}x`)

      return `${rows.length} cancelamento(s) nos últimos ${days} dias:\n${lines.join('\n')}\n\nServiços: ${rows
        .map((a) => svcMap[a.service_id] ?? `#${a.service_id}`)
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .join(', ')}`
    }

    case 'get_revenue_forecast': {
      const today = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10)
      const startOfMonth = `${today.slice(0, 7)}-01`
      const dayOfMonth = parseInt(today.slice(8, 10), 10)
      const y = parseInt(today.slice(0, 4), 10)
      const m = parseInt(today.slice(5, 7), 10)
      const daysInMonth = new Date(y, m, 0).getDate()

      const appts = await prisma.$queryRaw<Array<{ price_charged: unknown; service_id: number }>>`
        SELECT price_charged, service_id
        FROM petshop_appointments
        WHERE company_id = ${companyId}
          AND status = 'completed'
          AND scheduled_date >= ${startOfMonth}::date
          AND scheduled_date <= ${today}::date
      `

      const svcList = await prisma.petshopService.findMany({
        where: { companyId },
        select: { id: true, price: true },
      })
      const svcMap = Object.fromEntries(svcList.map((s) => [s.id, Number(s.price ?? 0)]))

      const realized = (appts ?? []).reduce((sum, a) => {
        return sum + Number(a.price_charged ?? svcMap[a.service_id] ?? 0)
      }, 0)

      const dailyRate = dayOfMonth > 0 ? realized / dayOfMonth : 0
      const projected = dailyRate * daysInMonth

      return `Faturamento realizado até hoje (dia ${dayOfMonth}): R$ ${realized.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\nProjeção para o mês (${daysInMonth} dias): R$ ${projected.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\nRitmo diário atual: R$ ${dailyRate.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/dia`
    }

    case 'get_best_clients': {
      const limit = args.limit ?? 5
      const appts = await prisma.$queryRaw<Array<{ client_id: string; price_charged: unknown; service_id: number }>>`
        SELECT client_id, price_charged, service_id
        FROM petshop_appointments
        WHERE company_id = ${companyId}
          AND status = 'completed'
      `

      const svcList = await prisma.petshopService.findMany({
        where: { companyId },
        select: { id: true, price: true },
      })
      const svcMap = Object.fromEntries(svcList.map((s) => [s.id, Number(s.price ?? 0)]))

      const clientStats: Record<string, { total: number; visits: number }> = {}
      for (const a of appts ?? []) {
        if (!clientStats[a.client_id]) clientStats[a.client_id] = { total: 0, visits: 0 }
        clientStats[a.client_id]!.total += Number(a.price_charged ?? svcMap[a.service_id] ?? 0)
        clientStats[a.client_id]!.visits++
      }

      const top = Object.entries(clientStats)
        .sort(([, a], [, b]) => b.total - a.total)
        .slice(0, limit)

      const clientIds = top.map(([id]) => id)
      if (clientIds.length === 0) return 'Sem clientes com histórico de atendimentos concluídos.'

      const clients = await prisma.client.findMany({
        where: { id: { in: clientIds }, companyId },
        select: { id: true, name: true },
      })
      const clientMap = Object.fromEntries(clients.map((c) => [c.id, c.name]))

      return (
        `Top ${limit} clientes por faturamento:\n` +
        top
          .map(
            ([id, s], i) =>
              `${i + 1}. ${clientMap[id] ?? 'Cliente'} — R$ ${s.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${s.visits} visitas)`,
          )
          .join('\n')
      )
    }

    case 'get_idle_slots': {
      const since = new Date()
      since.setDate(since.getDate() - 60)
      const sinceStr = since.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10)

      const data = await prisma.$queryRaw<Array<{ scheduled_date: Date | string }>>`
        SELECT scheduled_date
        FROM petshop_appointments
        WHERE company_id = ${companyId}
          AND status <> 'cancelled'
          AND scheduled_date >= ${sinceStr}::date
      `

      if (!data || data.length === 0) return 'Dados insuficientes para análise de ociosidade.'

      const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
      const byDay: Record<number, number> = {}
      for (const a of data) {
        const dstr = typeof a.scheduled_date === 'string' ? a.scheduled_date : a.scheduled_date.toISOString().slice(0, 10)
        const dow = new Date(`${dstr}T12:00:00`).getDay()
        byDay[dow] = (byDay[dow] ?? 0) + 1
      }

      const sorted = Object.entries(byDay).sort(([, a], [, b]) => a - b)
      const idle = sorted.slice(0, 3).map(
        ([dow, count]) => `• ${DAYS[parseInt(dow, 10)]}: ${count} agendamentos nos últimos 60 dias`,
      )

      return `Dias com menor volume de agendamentos (últimos 60 dias):\n${idle.join('\n')}\n\nSugestão: considere promoções ou ajuste de capacidade nesses dias.`
    }

    case 'get_high_value_lost_clients': {
      const minDays = args.min_days ?? 30

      const appts = await prisma.$queryRaw<Array<{ client_id: string; price_charged: unknown; service_id: number }>>`
        SELECT client_id, price_charged, service_id
        FROM petshop_appointments
        WHERE company_id = ${companyId}
          AND status = 'completed'
      `

      const svcList = await prisma.petshopService.findMany({
        where: { companyId },
        select: { id: true, price: true },
      })
      const svcMap = Object.fromEntries(svcList.map((s) => [s.id, Number(s.price ?? 0)]))

      const stats: Record<string, number> = {}
      for (const a of appts ?? []) {
        stats[a.client_id] = (stats[a.client_id] ?? 0) + Number(a.price_charged ?? svcMap[a.service_id] ?? 0)
      }

      const lost = await prisma.$queryRaw<
        Array<{ client_id: string; client_name: string | null; days_absent: number; phone: string | null }>
      >`
        SELECT client_id, client_name, days_absent, phone
        FROM dashboard_client_recurrence
        WHERE company_id = ${companyId}
          AND days_absent >= ${minDays}
      `

      if (!lost || lost.length === 0) return `Nenhum cliente sumido há mais de ${minDays} dias.`

      const ranked = lost
        .map((c) => ({ ...c, total: stats[c.client_id] ?? 0 }))
        .filter((c) => c.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)

      if (ranked.length === 0) return 'Nenhum cliente de alto valor sumido no período.'

      return ranked
        .map(
          (c) =>
            `• ${c.client_name ?? 'Cliente'} — R$ ${c.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} histórico — sumido há ${c.days_absent} dias — tel: ${c.phone ?? '—'}`,
        )
        .join('\n')
    }

    case 'create_campaign_draft': {
      const client_ids: string[] = args.client_ids ?? []
      const message_template: string = args.message_template ?? ''
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
            name: args.name,
            phone,
            email: args.email?.trim() || null,
            source: 'manual',
            conversationStage: 'initial',
          },
          select: { id: true, name: true, phone: true },
        })

        return JSON.stringify({
          type: 'client_created',
          client: { id: data.id, name: data.name, phone: data.phone },
        })
      } catch (e: any) {
        if (e?.code === 'P2002') {
          return 'Já existe cliente com este telefone nesta empresa. Use search_clients para localizar.'
        }
        return `Erro ao criar cliente: ${e?.message ?? String(e)}`
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
        notes: args.notes ?? null,
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
