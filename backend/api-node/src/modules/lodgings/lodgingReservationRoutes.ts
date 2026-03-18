import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import {
  listLodgingReservations,
  getLodgingReservation,
  createLodgingReservation,
  updateLodgingReservation,
  cancelLodgingReservation,
  checkAvailability,
} from './lodgingReservationController'

const router = Router()

router.use(verifyToken)

router.get('/availability', checkAvailability)
router.get('/', listLodgingReservations)
router.get('/:id', getLodgingReservation)
router.post('/', createLodgingReservation)
router.patch('/:id', updateLodgingReservation)
router.delete('/:id', cancelLodgingReservation)

export { router as lodgingReservationRouter }
