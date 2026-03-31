import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import { sendCampaign } from './campaigns.controller'

const router = Router()
router.use(verifyToken)
router.post('/send', sendCampaign)

export default router
