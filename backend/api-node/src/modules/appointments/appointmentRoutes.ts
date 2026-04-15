import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import {
  listAppointments,
  getAppointment,
  scheduleAppointment,
  updateAppointment,
  cancelAppointment,
  deleteAppointment,
  confirmAppointment,
  rescheduleAppointment,
  getAvailableDates,
  sendReminders,
} from './appointmentController'

const router = Router()

router.use(verifyToken)

router.get('/available-dates', getAvailableDates)
router.get('/', listAppointments)
router.post('/schedule', scheduleAppointment)
router.post('/send-reminders', sendReminders)
router.get('/:id', getAppointment)
router.put('/:id', updateAppointment)
router.delete('/:id', cancelAppointment)
router.delete('/:id/delete', deleteAppointment)
router.post('/:id/confirm', confirmAppointment)
router.post('/:id/reschedule', rescheduleAppointment)

export default router
