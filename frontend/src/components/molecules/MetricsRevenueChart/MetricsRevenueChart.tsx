'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts'
import { Card } from '@/components/ui/card'
import { LineChart } from 'lucide-react'
import type { RevenueByMonth } from '@/services/dashboardService'

const MONTH_LABELS: Record<string, string> = {
  '01': 'Jan', '02': 'Fev', '03': 'Mar', '04': 'Abr',
  '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Ago',
  '09': 'Set', '10': 'Out', '11': 'Nov', '12': 'Dez',
}

interface Props {
  data: RevenueByMonth[]
  className?: string
  /** Só para demos — prefira passar `data` da API (`GET /dashboard/revenue`). */
  useMockData?: boolean
}

const DEMO_DATA: RevenueByMonth[] = [
  { month: '2024-10', total_revenue: 3000, avg_ticket: 150 },
  { month: '2024-11', total_revenue: 3200, avg_ticket: 160 },
  { month: '2024-12', total_revenue: 5800, avg_ticket: 193 },
  { month: '2025-01', total_revenue: 5200, avg_ticket: 173 },
  { month: '2025-02', total_revenue: 4800, avg_ticket: 160 },
  { month: '2025-03', total_revenue: 5100, avg_ticket: 170 },
]

function EmptyState() {
  return (
    <div className="flex h-[200px] flex-col items-center justify-center gap-2">
      <LineChart className="h-10 w-10 text-[#727B8E] dark:text-[#8a94a6]" strokeWidth={1.25} aria-hidden />
      <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">Sem faturamento registrado</p>
      <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">Os dados aparecerão quando houver agendamentos concluídos</p>
    </div>
  )
}

export function MetricsRevenueChart({ data, className, useMockData = false }: Props) {
  const sourceData = useMockData ? DEMO_DATA : data

  const chartData = sourceData.map(d => ({
    ...d,
    label: MONTH_LABELS[d.month.slice(5, 7)] ?? d.month,
  }))

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold tracking-wider uppercase text-[#434A57] dark:text-[#f5f9fc]">
          Faturamento — Últimos 6 Meses {useMockData && '(demo)'}
        </p>
        <span className="text-xs text-[#727B8E] dark:text-[#8a94a6]">passe o mouse para ver ticket médio</span>
      </div>

      {sourceData.length === 0 ? (
        <EmptyState />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(234, 85%, 60%)" stopOpacity={0.15} />
                <stop offset="95%" stopColor="hsl(234, 85%, 60%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="hsl(220, 15%, 91%)"
            />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "hsl(220, 10%, 50%)" }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "hsl(220, 10%, 50%)" }}
              tickFormatter={(v) => `R$${(v / 1000).toFixed(1)}k`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload[0]) return null
                const p = payload[0].payload as RevenueByMonth & { label: string }
                return (
                  <div className="bg-white dark:bg-[#1A1B1D] border border-[#727B8E1A] dark:border-[#40485A] rounded-md px-3 py-2 shadow-sm">
                    <p className="text-xs text-[#434A57] dark:text-[#f5f9fc] mb-0.5">
                      {p.label}
                    </p>
                    <p className="text-sm text-primary">
                      Faturamento: R${p.total_revenue.toLocaleString("pt-BR")}
                    </p>
                    <p className="text-xs text-[#727B8E] dark:text-[#8a94a6] mt-1">
                      Ticket médio: R${Number(p.avg_ticket ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                )
              }}
            />
            <Area
              type="monotone"
              dataKey="total_revenue"
              stroke="hsl(234, 85%, 60%)"
              strokeWidth={2.5}
              fill="url(#colorValue)"
              dot={{ r: 4, fill: "hsl(234, 85%, 60%)", stroke: "white", strokeWidth: 2 }}
              activeDot={{ r: 6, fill: "hsl(234, 85%, 60%)", stroke: "white", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}
