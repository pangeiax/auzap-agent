import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'

export async function chatBusiness(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { message, history } = req.body

    if (!message) {
      return res.status(400).json({ error: 'message is required' })
    }

    const openaiApiKey = process.env.OPENAI_API_KEY
    if (!openaiApiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' })
    }

    // Brasília today
    const nowBRT = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const todayBRT = new Date(nowBRT)
    todayBRT.setUTCHours(0, 0, 0, 0)
    const todayEnd = new Date(todayBRT)
    todayEnd.setUTCHours(23, 59, 59, 999)
    const weekEnd = new Date(todayBRT)
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7)
    const monthAgo = new Date(todayBRT)
    monthAgo.setUTCDate(monthAgo.getUTCDate() - 30)

    // Fetch rich business data
    const [
      petshop,
      appointments_today,
      appointments_week,
      upcoming_appointments,
      total_clients,
      new_clients_week,
      total_pets,
      services,
      recent_appointments,
      messages_today,
      total_revenue_month,
    ] = await Promise.all([
      prisma.saasPetshop.findUnique({
        where: { companyId },
        include: { company: true },
      }),
      prisma.petshopAppointment.count({
        where: { companyId, scheduledDate: { gte: todayBRT, lte: todayEnd }, status: { not: 'cancelled' } },
      }),
      prisma.petshopAppointment.count({
        where: { companyId, scheduledDate: { gte: todayBRT, lte: weekEnd }, status: { not: 'cancelled' } },
      }),
      prisma.petshopAppointment.findMany({
        where: { companyId, scheduledDate: { gte: todayBRT }, status: { in: ['pending', 'confirmed'] } },
        include: {
          client: { select: { name: true } },
          pet: { select: { name: true } },
          service: { select: { name: true } },
          schedule: { select: { startTime: true } },
        },
        orderBy: [{ scheduledDate: 'asc' }],
        take: 10,
      }),
      prisma.client.count({ where: { companyId, isActive: true } }),
      prisma.client.count({ where: { companyId, createdAt: { gte: monthAgo } } }),
      prisma.petshopPet.count({ where: { companyId } }),
      prisma.petshopService.findMany({ where: { companyId, isActive: true }, select: { name: true, price: true } }),
      prisma.petshopAppointment.findMany({
        where: { companyId, scheduledDate: { gte: monthAgo }, status: 'completed' },
        select: { priceCharged: true, scheduledDate: true },
        take: 100,
      }),
      prisma.agentMessage.count({
        where: { companyId, role: 'user', createdAt: { gte: todayBRT, lte: todayEnd } },
      }),
      prisma.petshopAppointment.aggregate({
        where: { companyId, scheduledDate: { gte: monthAgo }, status: 'completed' },
        _sum: { priceCharged: true },
      }),
    ])

    const companyName = petshop?.company?.name ?? 'Petshop'
    const revenue_month = Number(total_revenue_month._sum.priceCharged ?? 0)

    // Format upcoming appointments for context
    const upcomingText = upcoming_appointments.length > 0
      ? upcoming_appointments.map(a => {
          const date = new Date(a.scheduledDate).toLocaleDateString('pt-BR')
          const h = a.schedule ? String(new Date(a.schedule.startTime).getUTCHours()).padStart(2, '0') + ':' + String(new Date(a.schedule.startTime).getUTCMinutes()).padStart(2, '0') : ''
          return `- ${a.client?.name ?? 'Cliente'} | Pet: ${a.pet?.name ?? '-'} | Serviço: ${a.service?.name ?? '-'} | ${date} ${h}`
        }).join('\n')
      : 'Nenhum agendamento próximo.'

    const servicesText = services.length > 0
      ? services.map(s => `${s.name}${s.price ? ` (R$ ${Number(s.price).toFixed(2)})` : ''}`).join(', ')
      : 'Nenhum serviço ativo.'

    const systemPrompt = `Você é um assistente de negócios especializado em petshops.
Você está ajudando o dono do ${companyName} a gerenciar e entender seu negócio.

━━━ DADOS ATUAIS DO NEGÓCIO ━━━
Agendamentos hoje: ${appointments_today}
Agendamentos nos próximos 7 dias: ${appointments_week}
Mensagens recebidas hoje: ${messages_today}
Clientes ativos: ${total_clients}
Novos clientes (últimos 30 dias): ${new_clients_week}
Total de pets cadastrados: ${total_pets}
Faturamento dos últimos 30 dias: R$ ${revenue_month.toFixed(2)}

━━━ PRÓXIMOS AGENDAMENTOS ━━━
${upcomingText}

━━━ SERVIÇOS ATIVOS ━━━
${servicesText}

━━━ REGRAS ━━━
- Responda sempre em português, de forma clara, objetiva e profissional
- Use os dados acima quando o dono perguntar sobre métricas do negócio
- Não invente dados que não foram fornecidos
- Seja proativo em sugerir ações e insights com base nos dados
- Mantenha respostas concisas mas completas`

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(history ?? []),
      { role: 'user', content: message },
    ]

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        max_tokens: 1000,
      }),
    })

    if (!openaiRes.ok) {
      const errBody = await openaiRes.text()
      console.error('[ChatBusiness] OpenAI error:', errBody)
      return res.status(502).json({ error: 'Failed to get AI response' })
    }

    const data = (await openaiRes.json()) as any
    const reply =
      data.choices?.[0]?.message?.content ??
      'Desculpe, não consegui processar sua mensagem.'

    res.json({
      response: reply,
      timestamp: new Date().toISOString(),
      quick_actions: null,
      suggestions: null,
      data_cards: null,
      pending_confirmation: null,
    })
  } catch (error) {
    console.error('Error in chatBusiness:', error)
    res.status(500).json({ error: 'Failed to process message' })
  }
}
