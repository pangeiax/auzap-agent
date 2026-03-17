import { Prisma, PrismaClient } from '@prisma/client'
 
// Evita múltiplas instâncias em desenvolvimento (hot reload)
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }
const prismaLogLevels: Prisma.LogLevel[] = process.env.PRISMA_LOG_QUERIES === 'true'
  ? ['query', 'error', 'warn']
  : ['error', 'warn']
 
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: prismaLogLevels,
  })
 
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
 