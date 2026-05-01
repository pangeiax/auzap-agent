/**
 * Resolve o telefone real (E.164 BR, somente dígitos) de uma mensagem do
 * WhatsApp a partir do JID do remetente e do `senderPn` opcional.
 *
 * Fontes, em ordem de preferência:
 *   1. JID `@s.whatsapp.net` → o identificador antes do sufixo é o próprio
 *      telefone E.164 (ex.: `554899999999@s.whatsapp.net` → `554899999999`).
 *   2. `senderPn` (entregue pelo Baileys quando o `remoteJid` é `@lid`) →
 *      extrai dígitos do JID `@s.whatsapp.net` que vem nesse campo.
 *   3. JID `@lid` sem `senderPn` → não há resolução síncrona nesta versão do
 *      Baileys (6.7.9). Retorna `null` e o listener `chats.phoneNumberShare`
 *      preenche `manual_phone` retroativamente quando o WhatsApp revelar o
 *      mapeamento.
 *
 * O resultado é validado: precisa parecer um telefone BR (10–13 dígitos,
 * opcionalmente com prefixo `55`). Qualquer coisa fora disso retorna `null`
 * para evitar gravar lixo em `manual_phone`.
 */

const KNOWN_PHONE_SUFFIXES = ['@s.whatsapp.net', '@c.us'] as const

function stripPhoneSuffix(jid: string): string {
  for (const suffix of KNOWN_PHONE_SUFFIXES) {
    if (jid.endsWith(suffix)) {
      return jid.slice(0, -suffix.length)
    }
  }
  return jid
}

function digitsOnly(input: string): string {
  return input.replace(/\D+/g, '')
}

/**
 * Aceita 10–11 dígitos (formato local) ou 12–13 dígitos com prefixo 55
 * (formato internacional brasileiro). Sempre devolve no formato com 55.
 */
function normalizeBrazilianPhone(digits: string): string | null {
  const d = digitsOnly(digits)
  if (!d) return null
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d
  if (d.length === 10 || d.length === 11) return `55${d}`
  return null
}

export function resolvePhoneFromMessage(
  jid: string,
  senderPn: string | null | undefined,
): string | null {
  // 1. JID direto `@s.whatsapp.net` → identificador é o próprio telefone.
  if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us')) {
    return normalizeBrazilianPhone(stripPhoneSuffix(jid))
  }

  // 2. JID `@lid` com senderPn → telefone vem no senderPn.
  if (jid.endsWith('@lid') && senderPn) {
    return normalizeBrazilianPhone(stripPhoneSuffix(senderPn))
  }

  // 3. Sem fonte síncrona disponível.
  return null
}
