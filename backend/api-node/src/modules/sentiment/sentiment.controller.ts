import { Request, Response } from 'express'
import { SentimentService } from './sentiment.service'

const service = new SentimentService()

// GET /sentiment/client/:clientId
export async function getClientStatus(req: Request, res: Response) {
  try {
    const { clientId } = req.params
    if (!clientId) {
      res.status(400).json({ error: 'clientId é obrigatório' })
      return
    }
    const data = await service.getClientSentimentStatus(req.user!.companyId, clientId)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
}

// POST /sentiment/client/:clientId/analyze
export async function analyzeClient(req: Request, res: Response) {
  try {
    const { clientId } = req.params
    if (!clientId) {
      res.status(400).json({ error: 'clientId é obrigatório' })
      return
    }
    const { conversation_id } = req.body ?? {}
    const data = await service.analyzeClient(req.user!.companyId, clientId, conversation_id)
    res.json(data)
  } catch (err: any) {
    const status = err.statusCode ?? 500
    res.status(status).json({ error: err.message })
  }
}

// GET /sentiment/kpi
export async function getSentimentKpi(req: Request, res: Response) {
  try {
    const data = await service.getSentimentKpi(req.user!.companyId)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
}
