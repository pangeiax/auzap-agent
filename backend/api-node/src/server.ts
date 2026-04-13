import 'dotenv/config'
import app from './app'
import { restoreActiveSessions } from './services/baileysService'

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

  app.listen(PORT, () => {
    console.log(`[Server] Rodando em http://localhost:${PORT}`)
  })
}

main().catch((err) => {
  console.error('[Server] Erro fatal ao iniciar:', err)
  process.exit(1)
})