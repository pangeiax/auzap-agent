import { prisma } from '../../lib/prisma'

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
] as const

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
      const clients = await prisma.$queryRaw<Array<{ id: number; name: string; phone: string; last_message_at: string | null }>>`
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
        WHERE client_id = ${client.id}
          AND is_active = true
      `

      const lastAppt = await prisma.$queryRaw<Array<{ scheduled_date: string | Date; service_name: string; status: string }>>`
        SELECT scheduled_date, service_name, status
        FROM dashboard_appointment_metrics
        WHERE company_id = ${companyId}
          AND client_id = ${client.id}
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

      const byType: Record<string, LodgingRow[]> = {}
      for (const row of data) {
        if (!byType[row.type]) byType[row.type] = []
        byType[row.type]!.push(row)
      }

      return Object.entries(byType).map(([type, rows]) => {
        const label = type === 'hotel' ? '🏨 Hotel' : '🐾 Creche'
        const lines = rows.map(r => {
          const date = new Date(String(r.check_date) + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
          const status = r.available_capacity === 0 ? '🔴 LOTADO' : r.available_capacity === 1 ? '🟡 quase cheio' : '🟢 disponível'
          return `  ${date}: ${r.occupied_capacity}/${r.max_capacity} ocupados ${status}`
        }).join('\n')
        return `${label}:\n${lines}`
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
          SELECT * FROM get_pet_birthdays_next_days(${companyId}, ${days})
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

    default:
      return 'Ferramenta não encontrada.'
  }
}
