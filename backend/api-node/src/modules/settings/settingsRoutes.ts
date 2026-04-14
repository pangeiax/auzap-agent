import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import { getAgenda, saveAgenda } from './agendaController'

const router = Router()

router.use(verifyToken)

// GET /settings/agenda
router.get('/agenda', getAgenda)

// PUT /settings/agenda
router.put('/agenda', saveAgenda)

export default router
