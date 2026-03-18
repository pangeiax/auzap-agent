import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import whatsappRoutes from './modules/whatsapp/whatsappRoutes'
import authRoutes from './modules/auth/authRoutes'
import clientRoutes from './modules/clients/clientRoutes'
import conversationRoutes from './modules/conversations/conversationRoutes'
import petRoutes from './modules/pets/petRoutes'
import serviceRoutes from './modules/services/serviceRoutes'
import petshopRoutes from './modules/petshops/petshopRoutes'
import appointmentRoutes from './modules/appointments/appointmentRoutes'
import internalRoutes from './modules/internal/internalRoutes'
import chatRoutes from './modules/chat/chatRoutes'
import dashboardRoutes from './modules/dashboard/dashboardRoutes'
import specialtyRoutes from './modules/specialties/specialtyRoutes'
import lodgingRoutes from './modules/lodgings/lodgingRoutes'
import { lodgingReservationRouter } from './modules/lodgings/lodgingReservationRoutes'
import { lodgingConfigRouter } from './modules/lodgings/lodgingConfigRoutes'
import settingsRoutes from './modules/settings/settingsRoutes'

dotenv.config()

const app = express()

// ─────────────────────────────────────────
// Middlewares globais
// ─────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => callback(null, true),
  credentials: true,
}))
app.use(express.json())

// ─────────────────────────────────────────
// Rotas
// ─────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }))

app.use('/auth', authRoutes)
app.use('/whatsapp', whatsappRoutes)
app.use('/clients', clientRoutes)
app.use('/conversations', conversationRoutes)
app.use('/pets', petRoutes)
app.use('/services', serviceRoutes)
app.use('/petshops', petshopRoutes)
app.use('/appointments', appointmentRoutes)
app.use('/internal', internalRoutes)
app.use('/chat', chatRoutes)
app.use('/dashboard', dashboardRoutes)
app.use('/specialties', specialtyRoutes)
app.use('/lodgings', lodgingRoutes)
app.use('/lodging-reservations', lodgingReservationRouter)
app.use('/lodging-config', lodgingConfigRouter)
app.use('/settings', settingsRoutes)

export default app
