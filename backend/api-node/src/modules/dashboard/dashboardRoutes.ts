import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import { getStats, getRevenueChart, getCategoriesChart, getVisitsChart, getSalesChart } from './dashboardController'

const router = Router()
router.use(verifyToken)
router.get('/stats', getStats)
router.get('/revenue-chart', getRevenueChart)
router.get('/categories-chart', getCategoriesChart)
router.get('/visits-chart', getVisitsChart)
router.get('/sales-chart', getSalesChart)
export default router
