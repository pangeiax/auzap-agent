import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'

// ─── Constants ────────────────────────────────────────────────────────────────
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const
const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(t: Date): string {
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`
}

type BhRow = { day_of_week: number; open_time: Date | null; close_time: Date | null; is_closed: boolean }

async function buildAgendaPayload(companyId: number) {
  const [businessHoursRows, specialties] = await Promise.all([
    prisma.$queryRaw<BhRow[]>`
      SELECT day_of_week, open_time, close_time, is_closed
      FROM petshop_business_hours
      WHERE company_id = ${companyId}
    `,
    prisma.petshopSpecialty.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, color: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const days = DAY_ORDER.map((dow) => {
    const bh = businessHoursRows.find((b) => b.day_of_week === dow)
    const isClosed = !bh || bh.is_closed

    return {
      day_of_week: dow,
      day_name: DAY_NAMES[dow]!,
      is_closed: isClosed,
      open_time: bh && !bh.is_closed && bh.open_time ? formatTime(bh.open_time) : '09:00',
      close_time: bh && !bh.is_closed && bh.close_time ? formatTime(bh.close_time) : '18:00',
      capacity_by_specialty: [],
      slots_today: [],
    }
  })

  return { specialties, days }
}

// ─── GET /settings/agenda ─────────────────────────────────────────────────────
export async function getAgenda(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const payload = await buildAgendaPayload(companyId)
    res.json(payload)
  } catch (error) {
    console.error('[Agenda] getAgenda error:', error)
    res.status(500).json({ error: 'Falha ao carregar agenda' })
  }
}

// ─── PUT /settings/agenda ─────────────────────────────────────────────────────
export async function saveAgenda(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { days } = req.body as {
      days: Array<{
        day_of_week: number
        is_closed: boolean
        open_time: string
        close_time: string
      }>
    }

    if (!Array.isArray(days)) {
      return res.status(400).json({ error: 'days é obrigatório' })
    }

    await Promise.all(days.map(async (day) => {
      if (day.is_closed) {
        await prisma.$executeRaw`
          INSERT INTO petshop_business_hours (id, company_id, day_of_week, open_time, close_time, is_closed, updated_at)
          VALUES (gen_random_uuid(), ${companyId}, ${day.day_of_week}, NULL, NULL, TRUE, NOW())
          ON CONFLICT (company_id, day_of_week) DO UPDATE SET
            open_time  = NULL,
            close_time = NULL,
            is_closed  = TRUE,
            updated_at = NOW()
        `
      } else {
        const openStr  = day.open_time  + ':00'
        const closeStr = day.close_time + ':00'

        await prisma.$executeRaw`
          INSERT INTO petshop_business_hours (id, company_id, day_of_week, open_time, close_time, is_closed, updated_at)
          VALUES (gen_random_uuid(), ${companyId}, ${day.day_of_week},
                  ${openStr}::time, ${closeStr}::time, FALSE, NOW())
          ON CONFLICT (company_id, day_of_week) DO UPDATE SET
            open_time  = EXCLUDED.open_time,
            close_time = EXCLUDED.close_time,
            is_closed  = FALSE,
            updated_at = NOW()
        `
      }
    }))

    const agenda = await buildAgendaPayload(companyId)
    res.json({ success: true, specialties: agenda.specialties, days: agenda.days })
  } catch (error) {
    console.error('[Agenda] saveAgenda error:', error)
    res.status(500).json({ error: 'Falha ao salvar agenda' })
  }
}
