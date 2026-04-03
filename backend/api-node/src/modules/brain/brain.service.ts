import { runAnalyticsBrainChat } from '../../secondBrain'
import { runBrainActionAgent } from './brainActionAgent'
import { buildAlerts } from './brainAlerts'
import { runBrainConverse } from './brainConverse'
import { reserveSecondBrainDailyMessage } from './brainDailyUsage'
import { fetchBrainCompanyContext } from './brainLabels'
import { getBrainOpenAiModel } from './brainModel'
import {
  resolveSecondBrainPlanLimits,
  secondBrainMessageDailyLimitReached,
  SECOND_BRAIN_MESSAGE_PLAN_NOT_AVAILABLE,
} from './brainPlanConstants'
import { classifyBrainMode } from './brainRouter'
import type { BrainAlert, BrainMessage, BrainMeta } from './brain.types'

export class BrainService {
  async chat(
    companyId: number,
    message: string,
    history: BrainMessage[],
  ): Promise<{ reply: string; alerts: BrainAlert[]; meta?: BrainMeta }> {
    const apiKey = process.env.OPENAI_API_KEY
    const alertsPromise = buildAlerts(companyId)
    const ctx = await fetchBrainCompanyContext(companyId)

    if (!apiKey) {
      const alerts = await alertsPromise
      return {
        reply: 'O assistente não está configurado corretamente no servidor. Avise o suporte.',
        alerts,
      }
    }

    const planLimits = resolveSecondBrainPlanLimits(ctx.plan)
    if (!planLimits.secondBrainEnabled) {
      const alerts = await alertsPromise
      return { reply: SECOND_BRAIN_MESSAGE_PLAN_NOT_AVAILABLE, alerts }
    }

    const allowedToday = await reserveSecondBrainDailyMessage(companyId, planLimits.dailyMessageLimit)
    if (!allowedToday) {
      const alerts = await alertsPromise
      return {
        reply: secondBrainMessageDailyLimitReached(planLimits.dailyMessageLimit),
        alerts,
      }
    }

    const model = getBrainOpenAiModel()
    const mode = await classifyBrainMode({
      apiKey,
      model,
      message,
      history,
      petshopName: ctx.petshopName,
    })

    let result: { reply: string; meta?: BrainMeta }

    if (mode === 'converse') {
      result = await runBrainConverse({
        apiKey,
        model,
        petshopName: ctx.petshopName,
        assistantName: ctx.assistantName,
        message,
        history,
      })
    } else if (mode === 'action') {
      result = await runBrainActionAgent({
        apiKey,
        model,
        companyId,
        petshopName: ctx.petshopName,
        assistantName: ctx.assistantName,
        message,
        history,
      })
    } else {
      result = await runAnalyticsBrainChat({
        companyId,
        message,
        history,
        companyLabels: { petshopName: ctx.petshopName, assistantName: ctx.assistantName },
      })
    }

    const alerts = await alertsPromise
    return {
      reply: result.reply,
      alerts,
      meta: { ...result.meta, mode },
    }
  }
}
