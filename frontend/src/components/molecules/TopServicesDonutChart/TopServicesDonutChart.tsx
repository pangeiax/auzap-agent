'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/cn'
import type { TopService } from '@/services/dashboardService'

const COLORS = [
  'hsl(234, 85%, 55%)',
  'hsl(234, 85%, 70%)',
  'hsl(234, 60%, 80%)',
  'hsl(234, 40%, 88%)',
  'hsl(220, 14%, 92%)',
]

interface Props {
  data: TopService[]
  className?: string
}

function EmptyState() {
  return (
    <div className="flex h-[220px] flex-col items-center justify-center gap-2">
      <div className="h-10 w-10 rounded-full bg-[#f3f4f6] dark:bg-[#2a2d36] flex items-center justify-center">
        <span className="text-xl">🏆</span>
      </div>
      <p className="text-sm text-[#434A57] dark:text-[#f5f9fc]">Sem serviços concluídos</p>
      <p className="text-xs text-[#9ca3af]">Os dados aparecerão quando houver agendamentos concluídos</p>
    </div>
  )
}

export function TopServicesDonutChart({ data, className }: Props) {
  // Encontrar o serviço com maior crescimento (mock - em produção vir do backend)
  const topGrowthService = data.length > 0 ? data[data.length - 1] : null

  return (
    <Card className={cn('p-5', className)}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold tracking-wider uppercase text-[#434A57] dark:text-[#f5f9fc]">
          Serviços Mais Vendidos
        </p>
        <span className="text-xs text-[#727B8E] dark:text-[#8a94a6]">passe o mouse</span>
      </div>

      {data.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={100} height={100}>
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={28}
                  outerRadius={45}
                  dataKey="revenue_pct"
                  strokeWidth={0}
                  nameKey="service_name"
                >
                  {data.map((_, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  offset={20}
                  position={{ x: 120, y: -10 }}
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload[0]) return null
                    const item = payload[0].payload as TopService
                    return (
                      <div className="bg-white dark:bg-[#1A1B1D] border border-[#727B8E1A] dark:border-[#40485A] rounded-md px-4 py-2.5 shadow-sm min-w-[160px]">
                        <p className="text-xs text-[#434A57] dark:text-[#f5f9fc] mb-1">
                          {item.service_name}
                        </p>
                        <p className="text-sm text-primary font-medium">
                          {item.revenue_pct}%
                        </p>
                        <p className="text-xs text-[#737b8c] dark:text-[#8a94a6]">
                          Ticket: R$ {item.avg_ticket.toLocaleString('pt-BR')}
                        </p>
                      </div>
                    )
                  }}
                />
              </PieChart>
            </ResponsiveContainer>

            <div className="flex-1 space-y-1.5">
              {data.map((item, index) => (
                <div key={item.service_name} className="flex items-center gap-2 text-sm">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="text-[#727B8E] dark:text-[#8a94a6]">{item.service_name}</span>
                  <span className="ml-auto font-medium text-card-foreground">
                    {item.revenue_pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {topGrowthService && (
            <div className="mt-4 bg-primary/5 border border-primary/10 rounded-lg px-3 py-2">
              <p className="text-xs text-primary font-medium">
                {topGrowthService.service_name} em alta — ↑ 40% vs fevereiro
              </p>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
