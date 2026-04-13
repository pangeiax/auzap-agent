import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import {
  listStaff,
  createStaff,
  updateStaff,
  deactivateStaff,
  listStaffSchedules,
  createStaffSchedule,
  deleteStaffSchedule,
  getStaffAvailability,
} from './staffController'

const router = Router()
router.use(verifyToken)

// Disponibilidade (antes de /:id para não conflitar)
router.get('/availability', getStaffAvailability)

// CRUD funcionários
router.get('/', listStaff)
router.post('/', createStaff)
router.put('/:id', updateStaff)
router.patch('/:id/deactivate', deactivateStaff)

// Bloqueios por funcionário
router.get('/:id/schedules', listStaffSchedules)
router.post('/:id/schedules', createStaffSchedule)
router.delete('/:id/schedules/:scheduleId', deleteStaffSchedule)

export default router
