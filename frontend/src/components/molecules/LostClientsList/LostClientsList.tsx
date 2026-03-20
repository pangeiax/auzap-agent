'use client'

import { cn } from '@/lib/cn'
import type { LostClient } from '@/services/dashboardService'

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function openWhatsApp(phone: string, clientName: string, petName: string) {
  const cleaned = phone.replace(/\D/g, '')
  const number = cleaned.startsWith('55') ? cleaned : `55${cleaned}`
  const msg = encodeURIComponent(
    `Olá ${clientName}! Sentimos falta do(a) ${petName} por aqui 🐾 Quando conseguimos agendar o próximo banho?`,
  )
  window.open(`https://wa.me/${number}?text=${msg}`, '_blank')
}

interface Props {
  clients: LostClient[]
  className?: string
}

export function LostClientsList({ clients, className }: Props) {
  return (
    <div
      className={cn(
        'rounded-lg border border-[#727B8E1A] bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-4',
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
          Clientes sumidos
        </h3>
        <span className="rounded-full bg-[#f3f4f6] dark:bg-[#2a2d36] px-2 py-0.5 text-xs text-[#727B8E] dark:text-[#8a94a6]">
          +45 dias
        </span>
      </div>

      {clients.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8">
          <span className="text-2xl">🎉</span>
          <p className="text-sm font-medium text-[#059669]">Nenhum cliente sumido!</p>
          <p className="text-xs text-[#9ca3af]">Ótimo sinal de fidelização</p>
        </div>
      ) : (
        <div className="space-y-0 overflow-y-auto max-h-[300px]">
          {clients.map(client => (
            <div
              key={client.client_id}
              className="flex items-center justify-between border-b border-[#f3f4f6] dark:border-[#2a2d36] py-2.5 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#111827] dark:text-[#f5f9fc]">
                  {client.client_name} · {client.pet_name}
                </p>
                <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
                  Última visita: {formatDate(client.last_visit)}
                </p>
              </div>
              <div className="ml-3 flex items-center gap-2 shrink-0">
                <span
                  className={cn(
                    'text-sm font-semibold',
                    client.days_absent > 60 ? 'text-red-500' : 'text-amber-500',
                  )}
                >
                  {client.days_absent}d
                </span>
                <button
                  onClick={() => openWhatsApp(client.phone, client.client_name, client.pet_name)}
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/40"
                >
                  Avisar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
