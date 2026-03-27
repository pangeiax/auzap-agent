import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import {
  listRoomTypes,
  getRoomType,
  createRoomType,
  updateRoomType,
  deleteRoomType,
  getRoomTypeAvailability,
} from './roomTypeController'

const router = Router()

router.use(verifyToken)

router.get('/availability', getRoomTypeAvailability)
router.get('/', listRoomTypes)
router.get('/:id', getRoomType)
router.post('/', createRoomType)
router.patch('/:id', updateRoomType)
router.delete('/:id', deleteRoomType)

export { router as roomTypeRouter }
