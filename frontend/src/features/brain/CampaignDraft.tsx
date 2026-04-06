import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { BRAIN_CAMPAIGN_SEND_FALLBACK } from './brainLimits'
import { MANUAL_PHONE_EMPTY_LABEL } from './brainManualPhoneLabel'

interface Client {
  id: string
  name: string
  /** Exibição (manual_phone do cadastro). */
  manual_phone?: string
  /** Canal WhatsApp para envio — não exibir. */
  phone?: string
}

function displayManualPhone(c: Client): string {
  const m = c.manual_phone?.trim()
  if (m) return m
  return MANUAL_PHONE_EMPTY_LABEL
}

interface CampaignDraftProps {
  clients: Client[]
  message: string
  /** Limite do plano (vem do JSON campaign_draft). */
  maxRecipientsPerSend?: number
  onClose: () => void
}

export function CampaignDraft({ clients, message, maxRecipientsPerSend, onClose }: CampaignDraftProps) {
  const sendCap =
    maxRecipientsPerSend != null && maxRecipientsPerSend > 0
      ? maxRecipientsPerSend
      : BRAIN_CAMPAIGN_SEND_FALLBACK

  const clientIdsKey = clients.map((c) => c.id).join('|')

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    const ids = new Set<string>()
    const n = Math.min(sendCap, clients.length)
    for (const c of clients.slice(0, n)) {
      ids.add(c.id)
    }
    return ids
  })
  const [draft, setDraft] = useState(message)

  useEffect(() => {
    const ids = new Set<string>()
    const n = Math.min(sendCap, clients.length)
    for (const c of clients.slice(0, n)) {
      ids.add(c.id)
    }
    setSelectedIds(ids)
    setDraft(message)
    setSent(false)
    setError(null)
  }, [clientIdsKey, message, sendCap])

  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedCount = selectedIds.size
  const selectedClients = useMemo(
    () => clients.filter((c) => selectedIds.has(c.id)),
    [clients, selectedIds],
  )

  function toggleClient(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        return next
      }
      if (next.size >= sendCap) return prev
      next.add(id)
      return next
    })
  }

  async function handleSend() {
    if (selectedCount === 0) {
      setError('Selecione pelo menos um cliente.')
      return
    }
    const payloadClients = selectedClients.map((c) => ({
      id: c.id,
      phone: (c.phone ?? '').trim(),
    }))
    if (payloadClients.some((x) => !x.phone)) {
      setError('Cliente sem canal de envio. Recrie o rascunho ou verifique o cadastro.')
      return
    }
    setSending(true)
    setError(null)
    try {
      await api.post('/campaigns/send', {
        clients: payloadClients,
        message: draft,
      })
      setSent(true)
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? String((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Erro ao enviar')
          : 'Erro ao enviar campanha'
      setError(msg)
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div className="mt-3 rounded-xl border border-[#727B8E1A] bg-emerald-500/10 dark:border-[#40485A] px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
        Campanha enviada para {selectedCount} cliente(s).
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-[#727B8E1A] bg-gray-50 dark:border-[#40485A] dark:bg-[#141518] px-4 py-3 text-sm">
      <p className="mb-1 text-xs text-[#727B8E] dark:text-[#8a94a6]">
        Campanha — até {sendCap} destinatário(s) por envio (seu plano)
      </p>
      <p className="mb-2 text-xs text-[#727B8E] dark:text-[#8a94a6]">
        {clients.length} na lista · {selectedCount} selecionado(s)
      </p>
      <ul className="mb-3 max-h-36 space-y-2 overflow-y-auto text-xs text-[#434A57] dark:text-[#f5f9fc]">
        {clients.map((c) => {
          const checked = selectedIds.has(c.id)
          const disableCheck = !checked && selectedIds.size >= sendCap
          return (
            <li key={c.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                id={`campaign-client-${c.id}`}
                checked={checked}
                disabled={disableCheck}
                onChange={() => toggleClient(c.id)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#727B8E66] text-[#0F172A] disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#40485A]"
              />
              <label htmlFor={`campaign-client-${c.id}`} className={`cursor-pointer ${disableCheck ? 'opacity-50' : ''}`}>
                <span className="font-medium">{c.name}</span>
                <span className="block text-[#727B8E] dark:text-[#8a94a6]">{displayManualPhone(c)}</span>
              </label>
            </li>
          )
        })}
      </ul>
      {selectedIds.size >= sendCap && clients.length > sendCap && (
        <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">
          Limite de {sendCap} destinatário(s) por envio atingido. Desmarque alguém para trocar a seleção.
        </p>
      )}
      {clients.length > 1 && (
        <p className="mb-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <span className="font-medium">Vários destinatários:</span> a mesma mensagem será enviada a todos. Para avisos de{' '}
          <span className="font-medium">agendamento, remarcação ou cancelamento</span>, use texto <span className="font-medium">genérico</span> — sem nome de pet, data ou hora de um cliente que não valha para os outros; saudação neutra (ex.: «Olá,» ou «Olá!»). Mensagem totalmente diferente por pessoa: envie em campanhas separadas.
        </p>
      )}
      <p className="mb-1 text-xs text-[#727B8E] dark:text-[#8a94a6]">Mensagem (editável)</p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        className="mb-3 w-full resize-y rounded-lg border border-[#727B8E33] bg-white px-3 py-2 text-[#434A57] dark:border-[#40485A] dark:bg-[#1A1B1D] dark:text-[#f5f9fc]"
      />
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[#727B8E33] px-3 py-1.5 text-xs text-[#727B8E] hover:bg-white dark:border-[#40485A] dark:text-[#8a94a6] dark:hover:bg-[#212225]"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !draft.trim() || selectedCount === 0}
          className="rounded-lg bg-[#0F172A] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-[#f5f9fc] dark:text-[#0F172A]"
        >
          {sending ? 'Enviando...' : `Enviar para ${selectedCount} cliente(s)`}
        </button>
      </div>
    </div>
  )
}
