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
import { cn } from '@/lib/cn'
import { useTheme } from '@/contexts/ThemeContext'
import type { RevenueByMonth } from '@/services/dashboardService'

const MONTH_LABELS: Record<string, string> = {
  '01': 'Jan', '02': 'Fev', '03': 'Mar', '04': 'Abr',
  '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Ago',
  '09': 'Set', '10': 'Out', '11': 'Nov', '12': 'Dez',
}

const gridStroke = { light: '#E5E7EB', dark: '#40485A' }
const tickFill = { light: '#727B8E', dark: '#8a94a6' }

interface Props {
  data: RevenueByMonth[]
  className?: string
}

function EmptyState() {
  return (
    <div className="flex h-[200px] flex-col items-center justify-center gap-2">
      <div className="h-10 w-10 rounded-full bg-[#f3f4f6] dark:bg-[#2a2d36] flex items-center justify-center">
        <span className="text-xl">📊</span>
      </div>
      <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">Sem faturamento registrado</p>
      <p className="text-xs text-[#9ca3af]">Os dados aparecerão quando houver agendamentos concluídos</p>
    </div>
  )
}

export function MetricsRevenueChart({ data, className }: Props) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const chartData = data.map(d => ({
    ...d,
    label: MONTH_LABELS[d.month.slice(5, 7)] ?? d.month,
  }))

  return (
    <div
      className={cn(
        'rounded-lg border border-[#727B8E1A] bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-4',
        className,
      )}
    >
      <div className="mb-1">
        <h3 className="text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
          Faturamento — últimos 6 meses
        </h3>
        <p className="text-xs text-[#9ca3af]">passe o mouse para ver ticket médio</p>
      </div>

      {data.length === 0 ? (
        <EmptyState />
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="metricsRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#1E62EC" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#1E62EC" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={isDark ? gridStroke.dark : gridStroke.light}
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: isDark ? tickFill.dark : tickFill.light }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: isDark ? tickFill.dark : tickFill.light }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v =>
                v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : `R$${v}`
              }
            />
            <Tooltip
              contentStyle={{
                backgroundColor: isDark ? '#1A1B1D' : '#fff',
                border: isDark ? '1px solid #40485A' : '1px solid #E5E7EB',
                borderRadius: '8px',
                fontSize: 12,
              }}
              formatter={(value, name) => [
                `R$ ${Number(value ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                name === 'total_revenue' ? 'Receita' : 'Ticket médio',
              ]}
              labelStyle={{ color: isDark ? '#8a94a6' : '#727B8E' }}
            />
            <Area
              type="monotone"
              dataKey="total_revenue"
              stroke="#1E62EC"
              strokeWidth={2}
              fill="url(#metricsRevenueGrad)"
              dot={{ r: 3, fill: '#1E62EC', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
