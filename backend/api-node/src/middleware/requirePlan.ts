import { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'

const PLAN_ORDER: Record<string, number> = {
  free: 1,
  basic: 2,
  pro: 3,
  premium: 4,
}

export function requirePlan(requiredPlan: 'free' | 'basic' | 'pro' | 'premium') {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const companyId = req.user?.companyId
      if (!companyId) {
        return res.status(401).json({ error: 'Não autenticado.' })
      }

      const company = await prisma.saasCompany.findUnique({
        where: { id: companyId },
        select: { plan: true },
      })

      if (!company) {
        return res.status(403).json({ error: 'Empresa não encontrada.' })
      }

      const currentPlan = company.plan ?? 'free'
      const companyPlanOrder = PLAN_ORDER[currentPlan] ?? 0
      const requiredPlanOrder = PLAN_ORDER[requiredPlan] ?? 99

      if (companyPlanOrder < requiredPlanOrder) {
        return res.status(403).json({
          error: `Este recurso está disponível apenas no plano ${requiredPlan.toUpperCase()} ou superior.`,
          required_plan: requiredPlan,
          current_plan: currentPlan,
        })
      }

      req.company_plan = currentPlan
      next()
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  }
}
