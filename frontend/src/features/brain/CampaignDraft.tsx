import { useState } from 'react'
import { api } from '@/lib/api'

interface Client {
  id: string
  name: string
  phone: string
}

interface CampaignDraftProps {
  clients: Client[]
  message: string
  onClose: () => void
}

export function CampaignDraft({ clients, message, onClose }: CampaignDraftProps) {
  const [draft, setDraft] = useState(message)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSend() {
    setSending(true)
    setError(null)
    try {
      await api.post('/campaigns/send', {
        clients: clients.map((c) => ({ id: c.id, phone: c.phone })),
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
        Campanha enviada para {clients.length} cliente(s).
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-[#727B8E1A] bg-gray-50 dark:border-[#40485A] dark:bg-[#141518] px-4 py-3 text-sm">
      <p className="mb-2 text-xs text-[#727B8E] dark:text-[#8a94a6]">
        Campanha para {clients.length} cliente(s)
      </p>
      <ul className="mb-3 max-h-28 space-y-0.5 overflow-y-auto text-xs text-[#727B8E] dark:text-[#8a94a6]">
        {clients.map((c) => (
          <li key={c.id}>
            • {c.name} — {c.phone}
          </li>
        ))}
      </ul>
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
          disabled={sending || !draft.trim()}
          className="rounded-lg bg-[#0F172A] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-[#f5f9fc] dark:text-[#0F172A]"
        >
          {sending ? 'Enviando...' : `Enviar para ${clients.length} cliente(s)`}
        </button>
      </div>
    </div>
  )
}
