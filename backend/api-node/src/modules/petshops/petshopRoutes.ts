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

// GET /petshops — apenas o petshop da empresa autenticada
router.get('/', verifyToken, listPetshops)

// GET /petshops/info/company - Get authenticated company's petshop info (DEVE VIR ANTES DE :id)
router.get('/info/company', verifyToken, getPetshopInfo)

// POST /petshops - Create new petshop (requires auth)
router.post('/', verifyToken, createPetshop)

// GET /petshops/:petshopId — só se pertencer à empresa do JWT
router.get('/:petshopId', verifyToken, getPetshop)

// PATCH /petshops/:petshopId - Update petshop (requires auth)
router.patch('/:petshopId', verifyToken, updatePetshop)

export default router

