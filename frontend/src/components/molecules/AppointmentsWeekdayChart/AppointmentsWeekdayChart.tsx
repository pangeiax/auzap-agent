'use client'

import { useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts'
import { cn } from '@/lib/cn'
import { useTheme } from '@/contexts/ThemeContext'
import type { AppointmentByWeekday } from '@/services/dashboardService'

const gridStroke = { light: '#E5E7EB', dark: '#40485A' }
const tickFill = { light: '#727B8E', dark: '#8a94a6' }

const SERVICE_COLORS = [
  '#1E62EC', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2',
]

const DAY_ORDER = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

interface Props {
  data: AppointmentByWeekday[]
  className?: string
}

function EmptyState() {
  return (
    <div className="flex h-[180px] flex-col items-center justify-center gap-2">
      <div className="h-10 w-10 rounded-full bg-[#f3f4f6] dark:bg-[#2a2d36] flex items-center justify-center">
        <span className="text-xl">📅</span>
      </div>
      <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">Sem agendamentos este mês</p>
      <p className="text-xs text-[#9ca3af]">Os dados aparecerão quando houver agendamentos registrados</p>
    </div>
  )
}

export function AppointmentsWeekdayChart({ data, className }: Props) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const [activeService, setActiveService] = useState<string | null>(null)

  const services = [...new Set(data.map(d => d.service_name))]

  const byDay: Record<string, Record<string, number>> = {}
  for (const row of data) {
    if (!byDay[row.day_name]) byDay[row.day_name] = {}
    byDay[row.day_name]![row.service_name] = row.total
  }

  const chartData = DAY_ORDER
    .filter(d => byDay[d])
    .map(day => ({ day, ...byDay[day] }))

  const filteredServices = activeService ? [activeService] : services

  const total = data
    .filter(d => !activeService || d.service_name === activeService)
    .reduce((s, r) => s + r.total, 0)

  const busiestDay = chartData.reduce<{ day: string; total: number }>(
    (best, row) => {
      const rowAny = row as unknown as Record<string, unknown>
      const rowTotal = filteredServices.reduce((s, svc) => s + Number(rowAny[svc] ?? 0), 0)
      return rowTotal > best.total ? { day: row.day, total: rowTotal } : best
    },
    { day: '', total: 0 },
  )

  return (
    <div
      className={cn(
        'rounded-lg border border-[#727B8E1A] bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-4',
        className,
      )}
    >
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
            Agendamentos por dia
          </h3>
          <p className="text-xs text-[#9ca3af]">este mês · por serviço</p>
        </div>
      </div>

      {data.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Filtros de serviço */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveService(null)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                !activeService
                  ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#0F172A]'
                  : 'bg-[#f3f4f6] text-[#374151] dark:bg-[#2a2d36] dark:text-[#d1d5db]',
              )}
            >
              Todos
            </button>
            {services.map(svc => (
              <button
                key={svc}
                onClick={() => setActiveService(svc === activeService ? null : svc)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  activeService === svc
                    ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#0F172A]'
                    : 'bg-[#f3f4f6] text-[#374151] dark:bg-[#2a2d36] dark:text-[#d1d5db]',
                )}
              >
                {svc}
              </button>
            ))}
          </div>

          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} barSize={20}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={isDark ? gridStroke.dark : gridStroke.light}
                vertical={false}
              />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: isDark ? tickFill.dark : tickFill.light }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: isDark ? tickFill.dark : tickFill.light }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: isDark ? '#1A1B1D' : '#fff',
                  border: isDark ? '1px solid #40485A' : '1px solid #E5E7EB',
                  borderRadius: '8px',
                  fontSize: 12,
                }}
                labelStyle={{ color: isDark ? '#8a94a6' : '#727B8E' }}
              />
              {filteredServices.map((svc, i) => (
                <Bar
                  key={svc}
                  dataKey={svc}
                  stackId="a"
                  fill={SERVICE_COLORS[i % SERVICE_COLORS.length]}
                  radius={i === filteredServices.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>

          <div className="mt-3 flex gap-6">
            <div>
              <span className="text-xl font-bold text-[#434A57] dark:text-[#f5f9fc]">{total}</span>
              <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">este mês</p>
            </div>
            {busiestDay.day && (
              <div>
                <span className="text-xl font-bold text-[#434A57] dark:text-[#f5f9fc]">
                  {busiestDay.day}
                </span>
                <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">dia mais cheio</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
