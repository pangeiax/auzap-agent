import { Router } from 'express'
import { internalApiKeyMiddleware } from '../../middleware/internalApiKeyMiddleware'
import { notifyEscalation } from './notifyController'
import { generateSlotsInternal } from './generateSlotsController'

const router = Router()

router.use(internalApiKeyMiddleware)

// POST /internal/notify-escalation
router.post('/notify-escalation', notifyEscalation)

// POST /internal/generate-slots — rota interna Docker (sem auth)
router.post('/generate-slots', generateSlotsInternal)

export default router
