import { Router } from 'express'
import { verifyDevToolsKey } from './devToolsMiddleware'
import {
  listPetshops,
  createPetshop,
  updateUserPassword,
  updateUserEmail,
} from './devToolsController'

const router = Router()

// Todas as rotas exigem header x-dev-tools-key
router.use(verifyDevToolsKey)

router.get('/petshops', listPetshops)
router.post('/petshops', createPetshop)
router.patch('/users/:id/password', updateUserPassword)
router.patch('/users/:id/email', updateUserEmail)

export default router
