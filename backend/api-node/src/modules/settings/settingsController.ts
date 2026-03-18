import { Request, Response } from 'express'
import { generateSlotsForCompany } from '../../services/slotGeneratorService'

const MAX_DAYS = 60

// POST /settings/generate-slots — Authenticated, gera slots da empresa do usuário
export async function generateSlotsManual(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const daysRequested = Number(req.body.days ?? 30)
    const daysGenerated = Math.min(daysRequested, MAX_DAYS)

    const result = await generateSlotsForCompany(companyId, daysGenerated)

    const fromDate = new Date()
    const toDate = new Date()
    toDate.setDate(toDate.getDate() + daysGenerated)

    const response: Record<string, unknown> = {
      success: true,
      slots_created: result.slots_processed,
      days_requested: daysRequested,
      days_generated: daysGenerated,
      period: {
        from: fromDate.toISOString().slice(0, 10),
        to: toDate.toISOString().slice(0, 10),
      },
    }

    if (daysRequested > MAX_DAYS) {
      response.warning = `O máximo permitido é ${MAX_DAYS} dias. Geração limitada a ${MAX_DAYS} dias.`
    }

    res.json(response)
  } catch (error) {
    console.error('[GenerateSlots] Erro ao gerar slots manuais:', error)
    res.status(500).json({ error: 'Falha ao gerar slots' })
  }
}
