import { useAuthContext } from '@/contexts/AuthContext'

const PLAN_ORDER: Record<string, number> = { free: 1, basic: 2, pro: 3 }

export function usePlan() {
  const { user } = useAuthContext()
  const plan = user?.company_plan ?? 'free'

  return {
    plan,
    isPro: (PLAN_ORDER[plan] ?? 0) >= PLAN_ORDER['pro'],
    isBasicOrAbove: (PLAN_ORDER[plan] ?? 0) >= PLAN_ORDER['basic'],
    hasAccess: (required: 'free' | 'basic' | 'pro') =>
      (PLAN_ORDER[plan] ?? 0) >= PLAN_ORDER[required],
  }
}
