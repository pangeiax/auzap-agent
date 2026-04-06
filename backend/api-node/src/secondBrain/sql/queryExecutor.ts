import { prisma } from '../../lib/prisma'

export async function executeValidatedSelect(sql: string): Promise<unknown[]> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '12000ms'`)
      const rows = await tx.$queryRawUnsafe(sql)
      return rows as unknown[]
    },
    { timeout: 20000 },
  )
}
