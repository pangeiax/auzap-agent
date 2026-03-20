import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import { requirePlan } from '../../middleware/requirePlan'
import { getClientStatus, analyzeClient, getSentimentKpi } from './sentiment.controller'

const router = Router()

router.use(verifyToken)
router.use(requirePlan('pro'))

router.get('/client/:clientId', getClientStatus)
router.post('/client/:clientId/analyze', analyzeClient)
router.get('/kpi', getSentimentKpi)

export default router
