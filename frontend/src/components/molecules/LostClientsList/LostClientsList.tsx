'use client'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/cn'
import { UserCheck } from 'lucide-react'
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
    `Olá ${clientName}! Sentimos falta do(a) ${petName} por aqui. Quando conseguimos agendar o próximo banho?`,
  )
  window.open(`https://wa.me/${number}?text=${msg}`, '_blank')
}

interface Props {
  clients: LostClient[]
  className?: string
}

export function LostClientsList({ clients, className }: Props) {
  const totalClients = clients.length
  const displayClients = clients.slice(0, 4)

  return (
    <Card className={cn('p-5', className)}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold tracking-wider uppercase text-[#434A57] dark:text-[#f5f9fc]">
          Clientes Sumidos
        </p>
        {totalClients > 4 && (
          <button className="text-xs text-primary font-medium hover:underline">
            Ver todos {totalClients} →
          </button>
        )}
      </div>

      {clients.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8">
          <UserCheck className="h-10 w-10 text-[#059669]" strokeWidth={1.5} aria-hidden />
          <p className="text-sm font-medium text-[#059669]">Nenhum cliente sumido!</p>
          <p className="text-xs text-[#9ca3af]">Ótimo sinal de fidelização</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayClients.map(client => (
            <div key={client.client_id} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-card-foreground">
                  {client.client_name} · {client.pet_name}
                </p>
                <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
                  Última visita: {formatDate(client.last_visit)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold bg-destructive/10 text-destructive px-2 py-0.5 rounded">
                  {client.days_absent}d
                </span>
                <button
                  onClick={() => openWhatsApp(client.phone, client.client_name, client.pet_name)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Avisar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
