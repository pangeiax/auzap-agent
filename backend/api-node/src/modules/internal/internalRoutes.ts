import { Router } from 'express'
import { internalApiKeyMiddleware } from '../../middleware/internalApiKeyMiddleware'
import { notifyEscalation } from './notifyController'
import { triggerDailyReminder } from './triggerReminderController'

const router = Router()

router.use(internalApiKeyMiddleware)

// POST /internal/notify-escalation
router.post('/notify-escalation', notifyEscalation)

// POST /internal/trigger-daily-reminder (TEMPORÁRIO — para testes)
router.post('/trigger-daily-reminder', triggerDailyReminder)

export default router
