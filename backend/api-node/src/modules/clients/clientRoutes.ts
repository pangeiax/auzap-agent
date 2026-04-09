import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import {
  listClients,
  searchClients,
  getClientDetails,
  createClient,
  updateClient,
  deleteClient,
  syncUnregisteredWhatsappToClient,
  getClientConversations,
  getClientPets,
  getClientContext,
  getClientActivities,
  importClients,
} from './clientController'

const router = Router()

// Apply auth middleware to all routes
router.use(verifyToken)

// GET /clients - List all clients
router.get('/', listClients)

// GET /clients/search - Search clients (DEVE VIR ANTES DE :clientId)
router.get('/search', searchClients)

// POST /clients/import - Import clients (DEVE VIR ANTES DE :clientId)
router.post('/import', importClients)

// POST /clients - Create new client
router.post('/', createClient)

// POST /clients/:clientId/sync-whatsapp — antes de GET :clientId (rota mais específica)
router.post('/:clientId/sync-whatsapp', syncUnregisteredWhatsappToClient)

// GET /clients/:clientId - Get client details (rotas genéricas após específicas)
router.get('/:clientId', getClientDetails)

// PUT /clients/:clientId - Update client
router.put('/:clientId', updateClient)

// DELETE /clients/:clientId - Delete client
router.delete('/:clientId', deleteClient)

// GET /clients/:clientId/conversations - Get client conversations
router.get('/:clientId/conversations', getClientConversations)

// GET /clients/:clientId/pets - Get client pets
router.get('/:clientId/pets', getClientPets)

// GET /clients/:clientId/context - Get client context for AI
router.get('/:clientId/context', getClientContext)

// GET /clients/:clientId/activities - Get client activities
router.get('/:clientId/activities', getClientActivities)

export default router

