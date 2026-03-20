'use client'

import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { cn } from '@/lib/cn'
import type { ClientRecurrence } from '@/services/dashboardService'

const ZONES = [
  { key: 'active' as const, label: 'Voltam até 30d', color: '#059669' },
  { key: 'at_risk' as const, label: 'Voltam 31–60d', color: '#d97706' },
  { key: 'lost_never' as const, label: 'Não voltaram', color: '#d1d5db' },
]

interface Props {
  data: ClientRecurrence | null
  className?: string
}

function EmptyState() {
  return (
    <div className="flex h-[140px] flex-col items-center justify-center gap-2">
      <div className="h-10 w-10 rounded-full bg-[#f3f4f6] dark:bg-[#2a2d36] flex items-center justify-center">
        <span className="text-xl">🔄</span>
      </div>
      <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">Sem dados de clientes</p>
    </div>
  )
}

export function RecurrenceDonutChart({ data, className }: Props) {
  if (!data) return (
    <div className={cn('rounded-lg border border-[#727B8E1A] bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-4', className)}>
      <h3 className="mb-3 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">Recorrência dos clientes</h3>
      <EmptyState />
    </div>
  )

  const total = data.active + data.at_risk + data.lost + data.never
  const returnPct = total ? Math.round(((data.active + data.at_risk) / total) * 100) : 0

  const chartData = [
    { name: 'Voltam até 30d', value: data.active, color: '#059669' },
    { name: 'Voltam 31–60d', value: data.at_risk, color: '#d97706' },
    { name: 'Não voltaram', value: data.lost + data.never, color: '#d1d5db' },
  ]

  const isEmpty = total === 0

  return (
    <div
      className={cn(
        'rounded-lg border border-[#727B8E1A] bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-4',
        className,
      )}
    >
      <h3 className="mb-3 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
        Recorrência dos clientes
      </h3>

      {isEmpty ? (
        <EmptyState />
      ) : (
        <div className="flex items-center gap-4">
          {/* Rosca com % no centro */}
          <div className="relative h-[130px] w-[130px] shrink-0">
            <ResponsiveContainer width={130} height={130}>
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={62}
                  strokeWidth={0}
                >
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold text-[#434A57] dark:text-[#f5f9fc]">
                {returnPct}%
              </span>
              <span className="text-[10px] text-[#727B8E] dark:text-[#8a94a6]">voltam</span>
            </div>
          </div>

          {/* Legenda + ciclo médio */}
          <div className="flex-1">
            {ZONES.map(zone => {
              const value = zone.key === 'lost_never' ? data.lost + data.never : data[zone.key]
              const pct = total ? Math.round((value / total) * 100) : 0
              return (
                <div key={zone.key} className="mb-2 flex items-center gap-2">
                  <div
                    className="h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: zone.color }}
                  />
                  <span className="text-xs text-[#374151] dark:text-[#d1d5db]">
                    {zone.label} — {pct}%
                  </span>
                </div>
              )
            })}
            <div className="mt-3">
              {data.avg_return_days === 0 ? (
                <p className="text-xs text-[#9ca3af]">Ciclo médio sem dados</p>
              ) : (
                <>
                  <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">Ciclo médio de retorno</p>
                  <p className="text-2xl font-bold text-[#434A57] dark:text-[#f5f9fc]">
                    {data.avg_return_days}
                    <span className="ml-1 text-sm font-normal text-[#9ca3af]">dias</span>
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
