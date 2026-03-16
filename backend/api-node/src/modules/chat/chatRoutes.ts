import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import { chatBusiness } from './chatController'

const router = Router()

router.use(verifyToken)

// POST /chat/business - Business AI assistant
router.post('/business', chatBusiness)

export default router
