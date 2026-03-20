import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import {
  getStats,
  getRevenueChart,
  getCategoriesChart,
  getVisitsChart,
  getSalesChart,
  getKpis,
  getRevenue,
  getAppointmentsByWeekday,
  getTopServices,
  getRecurrence,
  getLostClients,
} from './dashboardController'

const router = Router()
router.use(verifyToken)

// Endpoints legados (Prisma direto)
router.get('/stats', getStats)
router.get('/revenue-chart', getRevenueChart)
router.get('/categories-chart', getCategoriesChart)
router.get('/visits-chart', getVisitsChart)
router.get('/sales-chart', getSalesChart)

// Novos endpoints baseados nas views do Supabase
router.get('/kpis', getKpis)
router.get('/revenue', getRevenue)
router.get('/appointments-by-weekday', getAppointmentsByWeekday)
router.get('/top-services', getTopServices)
router.get('/recurrence', getRecurrence)
router.get('/lost-clients', getLostClients)

export default router
