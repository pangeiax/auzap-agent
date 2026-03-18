import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import { getLodgingConfig, upsertLodgingConfig, upsertLodgingCapacity } from './lodgingConfigController'

const router = Router()
router.use(verifyToken)
router.get('/', getLodgingConfig)
router.patch('/', upsertLodgingConfig)
router.put('/capacity', upsertLodgingCapacity)
export { router as lodgingConfigRouter }
