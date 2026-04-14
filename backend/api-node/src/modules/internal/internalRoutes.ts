import { Router } from 'express'
import { internalApiKeyMiddleware } from '../../middleware/internalApiKeyMiddleware'
import { notifyEscalation } from './notifyController'

const router = Router()

router.use(internalApiKeyMiddleware)

// POST /internal/notify-escalation
router.post('/notify-escalation', notifyEscalation)

export default router
