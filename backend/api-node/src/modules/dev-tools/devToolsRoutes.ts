import { Router } from 'express'
import { verifyDevToolsKey } from './devToolsMiddleware'
import {
  listPetshops,
  createPetshop,
  updateUserPassword,
  updateUserEmail,
  sendMessageFromCompany,
} from './devToolsController'

const router = Router()

// Todas as rotas exigem header x-dev-tools-key
router.use(verifyDevToolsKey)

router.get('/petshops', listPetshops)
router.post('/petshops', createPetshop)
router.patch('/users/:id/password', updateUserPassword)
router.patch('/users/:id/email', updateUserEmail)
router.post('/send-message', sendMessageFromCompany)

export default router
