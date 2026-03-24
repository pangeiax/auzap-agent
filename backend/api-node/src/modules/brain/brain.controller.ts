import { Request, Response } from 'express'
import { BrainService } from './brain.service'
import { buildBrainSuggestionPrompts } from './brain.context'

const service = new BrainService()

export async function suggestions(req: Request, res: Response) {
  try {
    const prompts = await buildBrainSuggestionPrompts(req.user!.companyId)
    res.json({ suggestions: prompts })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
}

export async function chat(req: Request, res: Response) {
  try {
    const { message, history = [] } = req.body

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Mensagem não pode ser vazia.' })
    }

    const result = await service.chat(req.user!.companyId, message.trim(), history)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
}
