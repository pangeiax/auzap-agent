import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import {
  listSpecialties,
  getSpecialty,
  createSpecialty,
  updateSpecialty,
  deleteSpecialty,
  listCapacityRules,
  upsertCapacityRule,
  bulkUpsertCapacityRules,
  deleteCapacityRule,
  generateSlots,
} from './specialtyController'

const router = Router()

router.use(verifyToken)

router.get('/', listSpecialties)
router.post('/', createSpecialty)
router.get('/:id', getSpecialty)
router.patch('/:id', updateSpecialty)
router.delete('/:id', deleteSpecialty)

router.get('/:id/capacity-rules', listCapacityRules)
router.post('/:id/capacity-rules', upsertCapacityRule)
router.post('/:id/capacity-rules/bulk', bulkUpsertCapacityRules)
router.delete('/:id/capacity-rules/:ruleId', deleteCapacityRule)
router.post('/:id/generate-slots', generateSlots)

export default router
