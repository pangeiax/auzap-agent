import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import {
  listPets,
  getPet,
  createPet,
  updatePet,
  deletePet,
  getClientPets,
} from './petController'

const router = Router()

// Apply auth middleware to all routes
router.use(verifyToken)

// GET /pets - List all pets
router.get('/', listPets)

// GET /pets/client/:clientId/pets - Get pets for a client (DEVE VIR ANTES DE :petId)
router.get('/client/:clientId/pets', getClientPets)

// POST /pets - Create new pet
router.post('/', createPet)

// GET /pets/:petId - Get pet details (rotas genéricas após específicas)
router.get('/:petId', getPet)

// PUT /pets/:petId - Update pet
router.put('/:petId', updatePet)

// DELETE /pets/:petId - Delete pet
router.delete('/:petId', deletePet)

export default router

