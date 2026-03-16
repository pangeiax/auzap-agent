import { Router } from 'express'
import { notifyEscalation } from './notifyController'

const router = Router()

// POST /internal/notify-escalation
router.post('/notify-escalation', notifyEscalation)

export default router
