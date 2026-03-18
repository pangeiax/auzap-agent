import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import { generateSlotsManual } from './settingsController'

const router = Router()

router.use(verifyToken)

// POST /settings/generate-slots
router.post('/generate-slots', generateSlotsManual)

export default router
