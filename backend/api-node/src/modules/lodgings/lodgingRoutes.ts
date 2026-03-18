import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import { listLodgings, getLodging, createLodging, updateLodging, cancelLodging, getKennelAvailability } from './lodgingController'

const router = Router()

router.use(verifyToken)

router.get('/', listLodgings)
router.get('/kennel-availability', getKennelAvailability)
router.get('/:id', getLodging)
router.post('/', createLodging)
router.patch('/:id', updateLodging)
router.delete('/:id', cancelLodging)

export default router
