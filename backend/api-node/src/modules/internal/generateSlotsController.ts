import { Request, Response } from 'express'
import { generateSlotsForCompany, MAX_DAYS_AHEAD } from '../../services/slotGeneratorService'

// POST /internal/generate-slots — rota interna Docker (sem autenticação JWT)
// Aceita company_id opcional; se omitido, gera para todas as empresas ativas.
export async function generateSlotsInternal(req: Request, res: Response) {
  try {
    const { company_id, days = MAX_DAYS_AHEAD } = req.body

    const companyId = company_id ? Number(company_id) : undefined
    const result = await generateSlotsForCompany(companyId, Number(days))
    res.json({
      success: true,
      ...result,
    })
  } catch (error) {
    console.error('[Internal] Erro ao gerar slots:', error)
    res.status(500).json({ error: 'Falha ao gerar slots' })
  }
}
