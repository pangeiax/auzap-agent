import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import {
  listSpecialties,
  getSpecialty,
  createSpecialty,
  updateSpecialty,
  deleteSpecialty,
} from './specialtyController'

const router = Router()

router.use(verifyToken)

router.get('/', listSpecialties)
router.post('/', createSpecialty)
router.get('/:id', getSpecialty)
router.patch('/:id', updateSpecialty)
router.delete('/:id', deleteSpecialty)

export default router
