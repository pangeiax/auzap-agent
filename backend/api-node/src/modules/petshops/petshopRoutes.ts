import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import {
  listPetshops,
  getPetshop,
  createPetshop,
  updatePetshop,
  getPetshopInfo,
} from './petshopController'

const router = Router()

// GET /petshops - List all petshops (public)
router.get('/', listPetshops)

// GET /petshops/info/company - Get authenticated company's petshop info (DEVE VIR ANTES DE :id)
router.get('/info/company', verifyToken, getPetshopInfo)

// POST /petshops - Create new petshop (requires auth)
router.post('/', verifyToken, createPetshop)

// GET /petshops/:petshopId - Get petshop details
router.get('/:petshopId', getPetshop)

// PATCH /petshops/:petshopId - Update petshop (requires auth)
router.patch('/:petshopId', verifyToken, updatePetshop)

export default router

