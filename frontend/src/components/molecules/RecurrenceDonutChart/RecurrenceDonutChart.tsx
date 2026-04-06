'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/cn'
import { UsersRound } from 'lucide-react'
import type { ClientRecurrence } from '@/services/dashboardService'

const ZONES = [
  { key: 'active' as const, label: 'Até 30 dias', color: 'hsl(234, 85%, 55%)' },
  { key: 'at_risk' as const, label: '31–60 dias', color: 'hsl(234, 85%, 75%)' },
  { key: 'lost_never' as const, label: 'Não voltaram', color: 'hsl(220, 14%, 90%)' },
]

interface Props {
  data: ClientRecurrence | null
  className?: string
}

function EmptyState() {
  return (
    <div className="flex h-[140px] flex-col items-center justify-center gap-2">
      <div className="h-10 w-10 rounded-full bg-[#f3f4f6] dark:bg-[#2a2d36] flex items-center justify-center text-[#727B8E] dark:text-[#8a94a6]">
        <UsersRound className="h-5 w-5" strokeWidth={1.5} aria-hidden />
      </div>
      <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">Sem dados de clientes</p>
    </div>
  )
}

export function RecurrenceDonutChart({ data, className }: Props) {
  if (!data) return (
    <Card className={cn('p-5', className)}>
      <p className="text-xs font-semibold tracking-wider uppercase text-[#434A57] dark:text-[#f5f9fc] mb-4">
        Recorrência dos Clientes
      </p>
      <EmptyState />
    </Card>
  )

  const total = data.active + data.at_risk + data.lost + data.never
  const activePct = total ? Math.round((data.active / total) * 100) : 0

  const chartData = [
    { name: 'Até 30 dias', value: data.active, color: 'hsl(234, 85%, 55%)' },
    { name: '31–60 dias', value: data.at_risk, color: 'hsl(234, 85%, 75%)' },
    { name: 'Não voltaram', value: data.lost + data.never, color: 'hsl(220, 14%, 90%)' },
  ]

  const isEmpty = total === 0

  return (
    <Card className={cn('p-5', className)}>
      <p className="text-xs font-semibold tracking-wider uppercase text-[#434A57] dark:text-[#f5f9fc] mb-4">
        Recorrência dos Clientes
      </p>

      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          <div className="flex items-center gap-6">
            <div className="relative">
              <ResponsiveContainer width={100} height={100}>
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={30}
                    outerRadius={45}
                    strokeWidth={0}
                  >
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    offset={20}
                    position={{ x: 120, y: -10 }}
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload[0]) return null
                      const data = payload[0]
                      const value = typeof data.value === 'number' ? data.value : Number(data.value ?? 0)
                      const pct = value > 0 && total > 0 ? Math.round((value / total) * 100) : 0
                      return (
                        <div className="bg-white dark:bg-[#1A1B1D] border border-[#727B8E1A] dark:border-[#40485A] rounded-md px-4 py-2.5 shadow-sm min-w-[160px]">
                          <p className="text-xs text-[#434A57] dark:text-[#f5f9fc] mb-1">
                            {data.name}
                          </p>
                          <p className="text-sm text-primary font-medium">
                            {pct}%
                          </p>
                          <p className="text-xs text-[#737b8c] dark:text-[#8a94a6]">
                            {data.value} clientes
                          </p>
                        </div>
                      )
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-lg font-bold text-card-foreground">
                  {activePct}%
                </span>
              </div>
            </div>

            <div className="space-y-2">
              {ZONES.map(zone => {
                const value = zone.key === 'lost_never' ? data.lost + data.never : data[zone.key]
                const pct = total ? Math.round((value / total) * 100) : 0
                return (
                  <div key={zone.key} className="flex items-center gap-2 text-sm">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: zone.color }}
                    />
                    <span className="text-[#727B8E] dark:text-[#8a94a6]">
                      {zone.label} — {pct}%
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mt-4 text-center">
            {data.avg_return_days === 0 ? (
              <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">Ciclo médio sem dados</p>
            ) : (
              <>
                <p className="text-xs text-[#727B8E] dark:text-[#8a94a6] uppercase tracking-wide">Ciclo Médio</p>
                <p className="text-2xl font-bold text-card-foreground">
                  {data.avg_return_days} dias
                </p>
              </>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
