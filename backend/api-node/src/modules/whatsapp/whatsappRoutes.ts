import { Router } from 'express'
import {
  getStatus,
  connectWhatsApp,
  disconnectWhatsApp,
} from './whatsappController'

const router = Router()

// GET  /whatsapp/status/:companyId  → status da sessão
router.get('/status/:companyId', getStatus)

// POST /whatsapp/connect/:companyId → gera QR code
router.post('/connect/:companyId', connectWhatsApp)

// POST /whatsapp/disconnect/:companyId → desconecta
router.post('/disconnect/:companyId', disconnectWhatsApp)

export default router