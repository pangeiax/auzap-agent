'use client'

import { useState, useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts'
import { Card } from '@/components/ui/card'
import { CalendarClock, CalendarRange } from 'lucide-react'
import type { AppointmentByWeekday } from '@/services/dashboardService'

const DAY_ORDER = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function dayLabelFromWeekday(dow: number): string {
  const d = Number(dow)
  if (d === 0 || d === 7) return DAY_ORDER[0]!
  if (d >= 1 && d <= 6) return DAY_ORDER[d]!
  return DAY_ORDER[0]!
}

const CATEGORY_COLORS: Record<string, string> = {
  'Banho simples': 'hsl(234, 85%, 60%)',
  'Banho completo': 'hsl(234, 70%, 75%)',
  Consulta: 'hsl(152, 60%, 45%)',
  Tosa: 'hsl(38, 92%, 50%)',
  'Banho + Tosa': 'hsl(271, 76%, 53%)',
}

const PALETTE_FALLBACK = [
  'hsl(234, 85%, 60%)',
  'hsl(200, 70%, 50%)',
  'hsl(152, 60%, 45%)',
  'hsl(38, 92%, 50%)',
  'hsl(271, 76%, 53%)',
  'hsl(340, 65%, 55%)',
  'hsl(28, 85%, 52%)',
]

function colorForService(name: string, index: number): string {
  return CATEGORY_COLORS[name] ?? PALETTE_FALLBACK[index % PALETTE_FALLBACK.length]
}

interface Props {
  data: AppointmentByWeekday[]
  className?: string
  useMockData?: boolean
}

const MOCK_DATA: AppointmentByWeekday[] = [
  { day_of_week: 1, day_name: 'Seg', service_name: 'Banho simples', total: 2 },
  { day_of_week: 1, day_name: 'Seg', service_name: 'Banho completo', total: 1 },
  { day_of_week: 1, day_name: 'Seg', service_name: 'Consulta', total: 1 },
  { day_of_week: 1, day_name: 'Seg', service_name: 'Tosa', total: 1 },
  { day_of_week: 1, day_name: 'Seg', service_name: 'Banho + Tosa', total: 2 },
  { day_of_week: 2, day_name: 'Ter', service_name: 'Banho simples', total: 1 },
  { day_of_week: 2, day_name: 'Ter', service_name: 'Banho completo', total: 2 },
  { day_of_week: 2, day_name: 'Ter', service_name: 'Consulta', total: 1 },
  { day_of_week: 2, day_name: 'Ter', service_name: 'Tosa', total: 2 },
  { day_of_week: 2, day_name: 'Ter', service_name: 'Banho + Tosa', total: 1 },
  { day_of_week: 3, day_name: 'Qua', service_name: 'Banho simples', total: 2 },
  { day_of_week: 3, day_name: 'Qua', service_name: 'Banho completo', total: 1 },
  { day_of_week: 3, day_name: 'Qua', service_name: 'Consulta', total: 2 },
  { day_of_week: 3, day_name: 'Qua', service_name: 'Tosa', total: 1 },
  { day_of_week: 3, day_name: 'Qua', service_name: 'Banho + Tosa', total: 3 },
  { day_of_week: 4, day_name: 'Qui', service_name: 'Banho simples', total: 3 },
  { day_of_week: 4, day_name: 'Qui', service_name: 'Banho completo', total: 1 },
  { day_of_week: 4, day_name: 'Qui', service_name: 'Consulta', total: 2 },
  { day_of_week: 4, day_name: 'Qui', service_name: 'Tosa', total: 2 },
  { day_of_week: 4, day_name: 'Qui', service_name: 'Banho + Tosa', total: 2 },
  { day_of_week: 5, day_name: 'Sex', service_name: 'Banho simples', total: 4 },
  { day_of_week: 5, day_name: 'Sex', service_name: 'Banho completo', total: 2 },
  { day_of_week: 5, day_name: 'Sex', service_name: 'Consulta', total: 2 },
  { day_of_week: 5, day_name: 'Sex', service_name: 'Tosa', total: 3 },
  { day_of_week: 5, day_name: 'Sex', service_name: 'Banho + Tosa', total: 4 },
  { day_of_week: 6, day_name: 'Sáb', service_name: 'Banho simples', total: 5 },
  { day_of_week: 6, day_name: 'Sáb', service_name: 'Banho completo', total: 3 },
  { day_of_week: 6, day_name: 'Sáb', service_name: 'Consulta', total: 1 },
  { day_of_week: 6, day_name: 'Sáb', service_name: 'Tosa', total: 4 },
  { day_of_week: 6, day_name: 'Sáb', service_name: 'Banho + Tosa', total: 5 },
]

function EmptyState() {
  return (
    <div className="flex h-[180px] flex-col items-center justify-center gap-2">
      <CalendarRange className="h-9 w-9 text-[#727B8E] dark:text-[#8a94a6]" strokeWidth={1.25} aria-hidden />
      <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">Sem agendamentos este mês</p>
      <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">Os dados aparecerão quando houver agendamentos registrados</p>
    </div>
  )
}

export function AppointmentsWeekdayChart({ data, className, useMockData = false }: Props) {
  const sourceData = useMockData ? MOCK_DATA : data
  const [activeFilter, setActiveFilter] = useState<string>('Todos')

  const serviceNames = useMemo(() => {
    const totals = new Map<string, number>()
    for (const r of sourceData) {
      totals.set(r.service_name, (totals.get(r.service_name) ?? 0) + r.total)
    }
    return [...new Set(sourceData.map((d) => d.service_name))].sort(
      (a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0),
    )
  }, [sourceData])

  const byDay = useMemo(() => {
    const acc: Record<string, Record<string, number>> = {}
    for (const row of sourceData) {
      const label = dayLabelFromWeekday(row.day_of_week)
      if (!acc[label]) acc[label] = {}
      acc[label]![row.service_name] = (acc[label]![row.service_name] ?? 0) + row.total
    }
    return acc
  }, [sourceData])

  const chartData = useMemo(() => {
    return DAY_ORDER.map((day) => {
      const row: Record<string, string | number> = { day }
      for (const svc of serviceNames) {
        row[svc] = byDay[day]?.[svc] ?? 0
      }
      return row
    })
  }, [byDay, serviceNames])

  const services = useMemo(() => ['Todos', ...serviceNames], [serviceNames])

  const filteredData =
    activeFilter === 'Todos' ? sourceData : sourceData.filter((d) => d.service_name === activeFilter)

  const totalSemana = filteredData.reduce((s, r) => s + r.total, 0)

  const busiestDay = chartData.reduce<{ day: string; total: number }>(
    (best, row) => {
      const rec = row as Record<string, unknown>
      const rowTotal =
        activeFilter === 'Todos'
          ? serviceNames.reduce((s, svc) => s + Number(rec[svc] ?? 0), 0)
          : Number(rec[activeFilter] ?? 0)
      return rowTotal > best.total ? { day: String(rec.day), total: rowTotal } : best
    },
    { day: '', total: 0 },
  )

  const capacidadeTotal = totalSemana > 0 ? Math.ceil(totalSemana / 0.72) : 0
  const ocupacao = capacidadeTotal > 0 ? Math.round((totalSemana / capacidadeTotal) * 100) : 0
  const ociosos = capacidadeTotal - totalSemana

  const gridStroke = 'hsl(220, 15%, 91%)'
  const tickFill = 'hsl(220, 10%, 50%)'

  return (
    <Card className={`p-5 ${className ?? ''}`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold tracking-wider uppercase text-[#434A57] dark:text-[#f5f9fc]">
          Agendamentos por Dia — Por Serviço {useMockData && '(Mock)'}
        </p>
        <span className="text-xs text-[#727B8E] dark:text-[#8a94a6]">realizado vs capacidade</span>
      </div>

      {sourceData.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="flex gap-2 mb-4 flex-wrap">
            {services.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setActiveFilter(f)}
                className={`text-xs px-4 py-1.5 rounded-full font-medium transition-all ${
                  activeFilter === f
                    ? 'text-white bg-[#4254f0]'
                    : 'text-[#737b8c] bg-[#f3f4f7] dark:bg-[#323640] dark:text-[#b4bcc8] hover:bg-[#e8e9ed] dark:hover:bg-[#3d424e]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
              <XAxis
                dataKey="day"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: tickFill }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: tickFill }}
                allowDecimals={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null
                  const row = payload[0].payload as Record<string, unknown>
                  const day = String(row.day ?? '')
                  const keys =
                    activeFilter === 'Todos' ? serviceNames : [activeFilter]
                  return (
                    <div className="bg-white dark:bg-[#1A1B1D] border border-[#727B8E1A] dark:border-[#40485A] rounded-md px-3 py-2 shadow-sm">
                      <p className="text-xs text-[#434A57] dark:text-[#f5f9fc] mb-1">{day}</p>
                      {keys.map((svc) => {
                        const value = Number(row[svc] ?? 0)
                        if (!value) return null
                        const idx = serviceNames.indexOf(svc)
                        const color = colorForService(svc, idx >= 0 ? idx : 0)
                        return (
                          <div key={svc} className="flex items-center gap-2 text-xs">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                            <span className="text-[#434A57] dark:text-[#f5f9fc]">
                              {svc}: {value}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )
                }}
              />
              {activeFilter === 'Todos' ? (
                serviceNames.map((svc, i) => (
                  <Bar
                    key={svc}
                    dataKey={svc}
                    stackId="weekday"
                    fill={colorForService(svc, i)}
                    radius={[2, 2, 0, 0]}
                    maxBarSize={28}
                  />
                ))
              ) : (
                <Bar
                  dataKey={activeFilter}
                  fill={colorForService(activeFilter, Math.max(0, serviceNames.indexOf(activeFilter)))}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={22}
                />
              )}
            </BarChart>
          </ResponsiveContainer>

          <div className="grid grid-cols-4 gap-2 mt-4 text-center">
            <div>
              <p className="text-xl font-bold text-card-foreground">{totalSemana}</p>
              <p className="text-[10px] uppercase text-[#727B8E] dark:text-[#8a94a6] tracking-wide">Semana</p>
            </div>
            <div>
              <p className="text-xl font-bold text-card-foreground">{ocupacao}%</p>
              <p className="text-[10px] uppercase text-[#727B8E] dark:text-[#8a94a6] tracking-wide">Ocupação</p>
            </div>
            <div className="flex flex-col items-center justify-start min-h-[3.25rem]">
              {busiestDay.total > 0 ? (
                <p className="text-xl font-bold text-card-foreground leading-tight">{busiestDay.day}</p>
              ) : (
                <span className="flex h-8 items-center text-[#727B8E] dark:text-[#8a94a6]" aria-label="Sem dia com pico">
                  <CalendarClock className="h-7 w-7" strokeWidth={1.25} />
                </span>
              )}
              <p className="text-[10px] uppercase text-[#727B8E] dark:text-[#8a94a6] tracking-wide mt-1">Mais Cheio</p>
            </div>
            <div>
              <p className="text-xl font-bold text-card-foreground">{ociosos}</p>
              <p className="text-[10px] uppercase text-[#727B8E] dark:text-[#8a94a6] tracking-wide">Ociosos</p>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
