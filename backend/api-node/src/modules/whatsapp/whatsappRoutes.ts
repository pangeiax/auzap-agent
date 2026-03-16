import { Router } from 'express'
import {
  getStatus,
  connectWhatsApp,
  disconnectWhatsApp,
  getMyStatus,
  getQRCode,
  logoutMyWhatsApp,
  reconnectMyWhatsApp,
  healthCheck,
  sendMessage,
} from './whatsappController'
import { verifyToken } from '../../middleware/authMiddleware'

const router = Router()

// ── Rotas com :companyId explícito (admin / direto) ──
router.get('/status/:companyId', getStatus)
router.post('/connect/:companyId', connectWhatsApp)
router.post('/disconnect/:companyId', disconnectWhatsApp)

// ── Rotas autenticadas (companyId via JWT) ──
router.get('/status', verifyToken, getMyStatus)
router.get('/qr', verifyToken, getQRCode)
router.post('/logout', verifyToken, logoutMyWhatsApp)
router.post('/reconnect', verifyToken, reconnectMyWhatsApp)
router.get('/health', verifyToken, healthCheck)
router.post('/send-message', verifyToken, sendMessage)

export default router
