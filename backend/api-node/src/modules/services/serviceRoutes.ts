import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
  getBookableServices,
  getServicesByProfessional,
} from './serviceController'

const router = Router()

// Apply auth middleware to all routes
router.use(verifyToken)

// GET /services - List all services
router.get('/', listServices)

// GET /services/bookable - Get bookable services
router.get('/bookable', getBookableServices)

// POST /services - Create new service
router.post('/', createService)

// GET /services/:serviceId - Get service details
router.get('/:serviceId', getService)

// PUT /services/:serviceId - Update service
router.put('/:serviceId', updateService)

// DELETE /services/:serviceId - Delete service
router.delete('/:serviceId', deleteService)

export default router
