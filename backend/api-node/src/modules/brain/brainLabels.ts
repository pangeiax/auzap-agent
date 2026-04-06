import { prisma } from '../../lib/prisma'

export type BrainCompanyContext = {
  petshopName: string
  assistantName: string
  plan: string | null
}

export async function fetchBrainCompanyContext(companyId: number): Promise<BrainCompanyContext> {
  const rows = await prisma.$queryRaw<
    Array<{ name: string; assistant_name: string | null; plan: string | null }>
  >`
    SELECT c.name, c.plan, p.assistant_name
    FROM saas_companies c
    LEFT JOIN petshop_profile p ON p.company_id = c.id
    WHERE c.id = ${companyId}
    LIMIT 1
  `
  return {
    petshopName: rows[0]?.name ?? 'Petshop',
    assistantName: rows[0]?.assistant_name ?? 'Assistente',
    plan: rows[0]?.plan ?? 'free',
  }
}
