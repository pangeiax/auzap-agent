import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import { chat, suggestions } from './brain.controller'

const router = Router()
router.use(verifyToken)
router.get('/suggestions', suggestions)
router.post('/chat', chat)

export default router
