import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import { chat, dailyUsage, suggestions } from './brain.controller'

const router = Router()
router.use(verifyToken)
router.get('/usage', dailyUsage)
router.get('/suggestions', suggestions)
router.post('/chat', chat)

export default router
