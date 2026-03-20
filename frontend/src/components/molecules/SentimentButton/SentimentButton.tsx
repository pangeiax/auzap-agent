import { useState, useEffect } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { CheckCircle2, Sparkles } from 'lucide-react'
import { api } from '@/lib/api'
import { usePlan } from '@/hooks/usePlan'
import { cn } from '@/lib/cn'

interface SentimentStatus {
  has_analysis: boolean
  analyzed_this_month: boolean
  latest: {
    sentimento_geral: string
    tom_cliente: string
    risco_churn: string
    motivo_principal: string
    pontos_criticos: string[]
    qualidade_atendimento: string
    messages_analyzed: number
    analyzed_at: string
  } | null
}

interface Props {
  clientId: string
  conversationId?: string
}

const SENTIMENT_COLORS: Record<string, string> = {
  positivo: '#059669',
  neutro: '#6b7280',
  negativo: '#dc2626',
}

const CHURN_COLORS: Record<string, string> = {
  baixo: '#059669',
  medio: '#d97706',
  alto: '#dc2626',
}

export function SentimentButton({ clientId, conversationId }: Props) {
  const { isPro } = usePlan()
  const [status, setStatus] = useState<SentimentStatus | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isPro) return
    api
      .get(`/sentiment/client/${clientId}`)
      .then((r) => setStatus(r.data))
      .catch(() => {})
  }, [clientId, isPro])

  if (!isPro) return null

  async function handleAnalyze() {
    if (loading || status?.analyzed_this_month) return
    setLoading(true)
    try {
      const { data } = await api.post(`/sentiment/client/${clientId}/analyze`, {
        conversation_id: conversationId,
      })
      setStatus({ has_analysis: true, analyzed_this_month: true, latest: data })
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Erro ao analisar. Tente novamente.'
      alert(msg)
    } finally {
      setLoading(false)
    }
  }

  if (status?.analyzed_this_month && status.latest) {
    const s = status.latest
    return (
      <Tooltip.Provider delayDuration={200} skipDelayDuration={0}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors',
                'border-emerald-200/90 bg-gradient-to-b from-emerald-50 to-emerald-50/80 text-emerald-800',
                'hover:border-emerald-300 hover:from-emerald-50 hover:to-emerald-100/90',
                'dark:border-emerald-800/80 dark:from-emerald-950/80 dark:to-emerald-950/50 dark:text-emerald-300',
                'dark:hover:border-emerald-700 dark:hover:from-emerald-900/60 dark:hover:to-emerald-950/70',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#1A1B1D]'
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
              Avaliado
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="bottom"
              align="start"
              sideOffset={10}
              className={cn(
                'z-[200] max-h-[min(70vh,28rem)] w-[min(calc(100vw-2rem),20rem)] overflow-y-auto rounded-2xl border p-0 shadow-xl',
                'border-[#e5e7eb]/90 bg-white/95 backdrop-blur-sm',
                'dark:border-[#40485A] dark:bg-[#1e1f22]/98',
                'animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2'
              )}
            >
              <div className="border-b border-[#727B8E]/10 bg-gradient-to-r from-[#f0fdf4]/90 to-white px-4 py-3 dark:from-emerald-950/40 dark:to-[#1e1f22] dark:border-[#40485A]">
                <p className="text-xs font-semibold tracking-wide text-[#434A57] dark:text-[#f5f9fc]">
                  Análise de sentimento
                </p>
                <p className="mt-0.5 text-[10px] text-[#727B8E] dark:text-[#8a94a6]">
                  Resumo da última avaliação da IA
                </p>
              </div>

              <div className="space-y-3 p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-[#F4F6F9]/80 px-2.5 py-2 dark:bg-[#252628]">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-[#727B8E] dark:text-[#8a94a6]">
                      Sentimento
                    </p>
                    <p
                      className="mt-0.5 text-sm font-semibold capitalize"
                      style={{ color: SENTIMENT_COLORS[s.sentimento_geral] ?? '#111827' }}
                    >
                      {s.sentimento_geral}
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#F4F6F9]/80 px-2.5 py-2 dark:bg-[#252628]">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-[#727B8E] dark:text-[#8a94a6]">
                      Tom
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-[#374151] dark:text-[#e5e7eb]">
                      {s.tom_cliente}
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#F4F6F9]/80 px-2.5 py-2 dark:bg-[#252628]">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-[#727B8E] dark:text-[#8a94a6]">
                      Risco churn
                    </p>
                    <p
                      className="mt-0.5 text-sm font-semibold capitalize"
                      style={{ color: CHURN_COLORS[s.risco_churn] ?? '#111827' }}
                    >
                      {s.risco_churn}
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#F4F6F9]/80 px-2.5 py-2 dark:bg-[#252628]">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-[#727B8E] dark:text-[#8a94a6]">
                      Atendimento
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-[#374151] dark:text-[#e5e7eb]">
                      {s.qualidade_atendimento}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-[#727B8E] dark:text-[#8a94a6]">
                    Motivo principal
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[#434A57] dark:text-[#d1d5db]">
                    {s.motivo_principal}
                  </p>
                </div>

                {s.pontos_criticos?.length > 0 && (
                  <div className="rounded-lg border border-red-100 bg-red-50/80 p-2.5 dark:border-red-900/50 dark:bg-red-950/30">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-red-700 dark:text-red-300">
                      Pontos críticos
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {s.pontos_criticos.map((p, i) => (
                        <li key={i} className="text-xs leading-snug text-red-800 dark:text-red-200/90">
                          • {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="border-t border-[#727B8E]/10 pt-2 text-[10px] text-[#727B8E] dark:border-[#40485A] dark:text-[#8a94a6]">
                  {s.messages_analyzed} mensagens analisadas ·{' '}
                  {new Date(s.analyzed_at).toLocaleDateString('pt-BR')}
                </p>
              </div>

              <Tooltip.Arrow className="fill-white dark:fill-[#1e1f22]" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
    )
  }

  return (
    <button
      type="button"
      onClick={handleAnalyze}
      disabled={loading}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-all',
        'border-[#1E62EC]/25 bg-[#1E62EC]/[0.06] text-[#1E62EC] hover:border-[#1E62EC]/40 hover:bg-[#1E62EC]/10',
        'disabled:cursor-wait disabled:opacity-60',
        'dark:border-[#2172e5]/35 dark:bg-[#2172e5]/10 dark:text-[#7ab8ff] dark:hover:bg-[#2172e5]/18',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E62EC]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#1A1B1D]'
      )}
    >
      <Sparkles className={cn('h-3.5 w-3.5', loading && 'animate-pulse')} aria-hidden />
      {loading ? 'Analisando…' : 'Analisar cliente'}
    </button>
  )
}
