import { prisma } from '../../lib/prisma'
import type { Client } from '@prisma/client'

/**
 * Gera variações de telefone com/sem o prefixo `55` (código do Brasil) para
 * tentar match em ambas as formas que o `manual_phone` pode estar salvo.
 */
export function phoneCandidates(realPhone: string): string[] {
  const list = [realPhone]
  if (realPhone.startsWith('55') && realPhone.length > 12) {
    list.push(realPhone.slice(2))
  } else if (!realPhone.startsWith('55')) {
    list.push(`55${realPhone}`)
  }
  return list
}

/**
 * Quando o webhook traz `senderPn`, tenta vincular o `@lid` a um cliente já
 * cadastrado manualmente (match por `manual_phone`). Regras:
 *
 *  - Só roda quando `realPhone` (derivado do senderPn) está presente E ainda
 *    NÃO existe registro para esse `@lid` no banco (primeira mensagem pelo
 *    canal WhatsApp). Se já existir registro @lid, o match acontece pelo
 *    cadastro normal (`identity_migration_flow`) depois que o usuário
 *    informar os dados — não tentamos mergear aqui.
 *  - Match encontrado → `UPDATE clients SET phone=@lid WHERE id=existing.id`.
 *    O registro manual adota o `@lid` e passa a ser o cliente canônico.
 *  - Sem match ou sem senderPn → retorna o `client` como está (normalmente
 *    `null`) e o `processMessage` cria o registro @lid novo como sempre.
 *  - Falha no UPDATE → loga warning, retorna `null` e deixa o fluxo normal
 *    criar o registro @lid padrão.
 */
export async function linkLidToManualIfMatch(params: {
  companyId: number
  phone: string // identificador @lid que veio no webhook
  realPhone: string | null | undefined // senderPn normalizado (sem @s.whatsapp.net)
  client: Client | null
  pushName: string | null
}): Promise<Client | null> {
  const { companyId, phone, realPhone, pushName } = params
  const client = params.client

  // Gate 1: só roda com senderPn presente.
  if (!realPhone) return client
  // Gate 2: só roda na primeira mensagem do @lid. Se já existe registro,
  // deixamos o cadastro normal (identity_migration_flow) cuidar do merge.
  if (client) return client

  const candidates = phoneCandidates(realPhone)
  const existingByPhone = await prisma.client.findFirst({
    where: { companyId, manualPhone: { in: candidates } },
  })
  if (!existingByPhone) return client // sem match → cadastro normal segue

  try {
    const linked = await prisma.client.update({
      where: { id: existingByPhone.id },
      data: {
        phone, // registro manual adota o @lid
        lastMessageAt: new Date(),
        ...(pushName ? { name: pushName } : {}),
      },
    })
    console.log(
      `[senderPnMatch][company:${companyId}] senderPn ${realPhone} bateu com cliente ${existingByPhone.id} — phone migrado para LID ${phone}`,
    )
    return linked
  } catch (err) {
    console.warn(
      `[senderPnMatch][company:${companyId}] Falha ao migrar LID ${phone} para cliente ${existingByPhone.id}: ${err}`,
    )
    return null
  }
}
