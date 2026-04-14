import 'dotenv/config'
import app from './app'
import { restoreActiveSessions } from './services/baileysService'
import { startAppointmentReminderJob } from './jobs/appointmentReminderJob'

const PORT = process.env.PORT || 3000

async function main() {
  // Tenta restaurar sessões, mas NÃO derruba o servidor se falhar
  try {
    console.log('[Server] Restaurando sessões WhatsApp ativas...')
    await restoreActiveSessions()
  } catch (err) {
    console.warn('[Server] Aviso: não foi possível restaurar sessões WhatsApp:', err)
    console.warn('[Server] O servidor continuará rodando normalmente.')
  }

<<<<<<< HEAD
  // Inicia cron job de geração de slots (segunda, 06h BRT)

=======
>>>>>>> 65d95510d85de9aaa48e08c4f70166d9a78c13f6
  app.listen(PORT, () => {
    console.log(`[Server] Rodando em http://localhost:${PORT}`)
  })
}

main().catch((err) => {
  console.error('[Server] Erro fatal ao iniciar:', err)
  process.exit(1)
})