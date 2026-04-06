import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import {
  getAvailableSlots,
  getAvailableDates,
  listAppointments,
  getAppointment,
  scheduleAppointment,
  updateAppointment,
  cancelAppointment,
  deleteAppointment,
  confirmAppointment,
  rescheduleAppointment,
  rescheduleToSlot,
} from './appointmentController'

const router = Router()

router.use(verifyToken)

router.get('/', listAppointments)
router.get('/available-dates', getAvailableDates)
router.get('/available-slots', getAvailableSlots)
router.post('/schedule', scheduleAppointment)
router.post('/reschedule-to-slot', rescheduleToSlot)
router.get('/:id', getAppointment)
router.put('/:id', updateAppointment)
router.delete('/:id', cancelAppointment)
router.delete('/:id/delete', deleteAppointment)
router.post('/:id/confirm', confirmAppointment)
router.post('/:id/reschedule', rescheduleAppointment)

export default router
