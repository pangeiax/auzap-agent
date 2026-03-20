'use client'

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { cn } from '@/lib/cn'
import { useTheme } from '@/contexts/ThemeContext'
import type { TopService } from '@/services/dashboardService'

const COLORS = ['#1E62EC', '#7c3aed', '#059669', '#d97706', '#dc2626', '#6b7280']

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
      <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">Sem serviços concluídos</p>
      <p className="text-xs text-[#9ca3af]">Os dados aparecerão quando houver agendamentos concluídos</p>
    </div>
  )
}

export function TopServicesDonutChart({ data, className }: Props) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <div
      className={cn(
        'rounded-lg border border-[#727B8E1A] bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-4',
        className,
      )}
    >
      <h3 className="mb-1 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
        Serviços mais vendidos
      </h3>
      <p className="mb-3 text-xs text-[#9ca3af]">% do faturamento · passe o mouse</p>

      {data.length === 0 ? (
        <EmptyState />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={data}
              dataKey="revenue_pct"
              nameKey="service_name"
              cx="40%"
              cy="50%"
              innerRadius={55}
              outerRadius={90}
              strokeWidth={0}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: isDark ? '#1A1B1D' : '#fff',
                border: isDark ? '1px solid #40485A' : '1px solid #E5E7EB',
                borderRadius: '8px',
                fontSize: 12,
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(value, name, props: any) => [
                `${value}% · Ticket: R$ ${Number(props?.payload?.avg_ticket ?? 0).toLocaleString('pt-BR')}`,
                name,
              ]}
            />
            <Legend
              layout="vertical"
              align="right"
              verticalAlign="middle"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: string, entry: any) =>
                `${value} — ${(entry?.payload as TopService | undefined)?.revenue_pct ?? 0}%`
              }
              iconType="circle"
              iconSize={8}
              wrapperStyle={{
                fontSize: 11,
                color: isDark ? '#8a94a6' : '#6b7280',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
