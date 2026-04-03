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
import type { AppointmentByWeekday } from '@/services/dashboardService'

const DAY_ORDER = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

// Cores para cada categoria
const CATEGORY_COLORS = {
  'Banho simples': 'hsl(234, 85%, 60%)',      // Azul primário
  'Banho completo': 'hsl(234, 70%, 75%)',     // Azul claro
  'Consulta': 'hsl(152, 60%, 45%)',           // Verde
  'Tosa': 'hsl(38, 92%, 50%)',                // Laranja
  'Banho + Tosa': 'hsl(271, 76%, 53%)',       // Roxo
}

interface Props {
  data: AppointmentByWeekday[]
  className?: string
  useMockData?: boolean
}

// Mock data para visualização - com todas as categorias
const MOCK_DATA: AppointmentByWeekday[] = [
  // Segunda
  { day_of_week: 1, day_name: 'Seg', service_name: 'Banho simples', total: 2 },
  { day_of_week: 1, day_name: 'Seg', service_name: 'Banho completo', total: 1 },
  { day_of_week: 1, day_name: 'Seg', service_name: 'Consulta', total: 1 },
  { day_of_week: 1, day_name: 'Seg', service_name: 'Tosa', total: 1 },
  { day_of_week: 1, day_name: 'Seg', service_name: 'Banho + Tosa', total: 2 },
  // Terça
  { day_of_week: 2, day_name: 'Ter', service_name: 'Banho simples', total: 1 },
  { day_of_week: 2, day_name: 'Ter', service_name: 'Banho completo', total: 2 },
  { day_of_week: 2, day_name: 'Ter', service_name: 'Consulta', total: 1 },
  { day_of_week: 2, day_name: 'Ter', service_name: 'Tosa', total: 2 },
  { day_of_week: 2, day_name: 'Ter', service_name: 'Banho + Tosa', total: 1 },
  // Quarta
  { day_of_week: 3, day_name: 'Qua', service_name: 'Banho simples', total: 2 },
  { day_of_week: 3, day_name: 'Qua', service_name: 'Banho completo', total: 1 },
  { day_of_week: 3, day_name: 'Qua', service_name: 'Consulta', total: 2 },
  { day_of_week: 3, day_name: 'Qua', service_name: 'Tosa', total: 1 },
  { day_of_week: 3, day_name: 'Qua', service_name: 'Banho + Tosa', total: 3 },
  // Quinta
  { day_of_week: 4, day_name: 'Qui', service_name: 'Banho simples', total: 3 },
  { day_of_week: 4, day_name: 'Qui', service_name: 'Banho completo', total: 1 },
  { day_of_week: 4, day_name: 'Qui', service_name: 'Consulta', total: 2 },
  { day_of_week: 4, day_name: 'Qui', service_name: 'Tosa', total: 2 },
  { day_of_week: 4, day_name: 'Qui', service_name: 'Banho + Tosa', total: 2 },
  // Sexta
  { day_of_week: 5, day_name: 'Sex', service_name: 'Banho simples', total: 4 },
  { day_of_week: 5, day_name: 'Sex', service_name: 'Banho completo', total: 2 },
  { day_of_week: 5, day_name: 'Sex', service_name: 'Consulta', total: 2 },
  { day_of_week: 5, day_name: 'Sex', service_name: 'Tosa', total: 3 },
  { day_of_week: 5, day_name: 'Sex', service_name: 'Banho + Tosa', total: 4 },
  // Sábado
  { day_of_week: 6, day_name: 'Sáb', service_name: 'Banho simples', total: 5 },
  { day_of_week: 6, day_name: 'Sáb', service_name: 'Banho completo', total: 3 },
  { day_of_week: 6, day_name: 'Sáb', service_name: 'Consulta', total: 1 },
  { day_of_week: 6, day_name: 'Sáb', service_name: 'Tosa', total: 4 },
  { day_of_week: 6, day_name: 'Sáb', service_name: 'Banho + Tosa', total: 5 },
]

function EmptyState() {
  return (
    <div className="flex h-[180px] flex-col items-center justify-center gap-2">
      <div className="h-10 w-10 rounded-full flex items-center justify-center">
        <span className="text-xl">📅</span>
      </div>
      <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">Sem agendamentos este mês</p>
      <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">Os dados aparecerão quando houver agendamentos registrados</p>
    </div>
  )
}

export function AppointmentsWeekdayChart({ data, className, useMockData = false }: Props) {
  const sourceData = useMockData ? MOCK_DATA : data
  const [activeFilter, setActiveFilter] = useState<string>('Todos')

  // Extrai serviços únicos e adiciona "Todos"
  const services = useMemo(() => {
    const uniqueServices = [...new Set(sourceData.map(d => d.service_name))]
    return ['Todos', ...uniqueServices]
  }, [sourceData])

  // Organiza dados por dia
  const byDay: Record<string, Record<string, number>> = {}
  for (const row of sourceData) {
    if (!byDay[row.day_name]) byDay[row.day_name] = {}
    byDay[row.day_name]![row.service_name] = row.total
  }

  const chartData = DAY_ORDER
    .filter(d => byDay[d])
    .map(day => ({ day, ...byDay[day] }))

  // Filtra dados baseado no serviço selecionado
  const filteredData = activeFilter === 'Todos'
    ? sourceData
    : sourceData.filter(d => d.service_name === activeFilter)

  // Calcula métricas
  const totalSemana = filteredData.reduce((s, r) => s + r.total, 0)

  const busiestDay = chartData.reduce<{ day: string; total: number }>(
    (best, row) => {
      const rowAny = row as unknown as Record<string, unknown>
      const servicesInFilter = activeFilter === 'Todos'
        ? Object.keys(CATEGORY_COLORS)
        : [activeFilter]
      const rowTotal = servicesInFilter.reduce((s, svc) => s + Number(rowAny[svc] ?? 0), 0)
      return rowTotal > best.total ? { day: row.day, total: rowTotal } : best
    },
    { day: '', total: 0 },
  )

  // Capacidade total (mock - ajustar com dados reais se houver)
  const capacidadeTotal = totalSemana > 0 ? Math.ceil(totalSemana / 0.72) : 0
  const ocupacao = capacidadeTotal > 0 ? Math.round((totalSemana / capacidadeTotal) * 100) : 0
  const ociosos = capacidadeTotal - totalSemana

  return (
    <Card className="p-5">
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
                onClick={() => setActiveFilter(f)}
                className={`text-xs px-4 py-1.5 rounded-full font-medium transition-all ${
                  activeFilter === f
                    ? "text-white bg-[#4254f0]"
                    : "text-[#737b8c] bg-[#f3f4f7] hover:bg-[#e8e9ed]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(220, 15%, 91%)" />
              <XAxis
                dataKey="day"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: "hsl(220, 10%, 50%)" }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: "hsl(220, 10%, 50%)" }}
                allowDecimals={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || !payload[0]) return null
                  const data = payload[0].payload
                  return (
                    <div className="bg-white dark:bg-[#1A1B1D] border border-[#727B8E1A] dark:border-[#40485A] rounded-md px-3 py-2 shadow-sm">
                      <p className="text-xs text-[#434A57] dark:text-[#f5f9fc] mb-1">{data.day}</p>
                      {Object.entries(CATEGORY_COLORS).map(([category, color]) => {
                        const value = data[category]
                        if (!value) return null
                        return (
                          <div key={category} className="flex items-center gap-2 text-xs">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                            <span className="text-[#434A57] dark:text-[#f5f9fc]">{category}: {value}</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                }}
              />
              {activeFilter === 'Todos' ? (
                <>
                  <Bar dataKey="Banho simples" fill={CATEGORY_COLORS['Banho simples']} radius={[4, 4, 0, 0]} barSize={18} />
                  <Bar dataKey="Banho completo" fill={CATEGORY_COLORS['Banho completo']} radius={[4, 4, 0, 0]} barSize={18} />
                  <Bar dataKey="Consulta" fill={CATEGORY_COLORS['Consulta']} radius={[4, 4, 0, 0]} barSize={18} />
                  <Bar dataKey="Tosa" fill={CATEGORY_COLORS['Tosa']} radius={[4, 4, 0, 0]} barSize={18} />
                  <Bar dataKey="Banho + Tosa" fill={CATEGORY_COLORS['Banho + Tosa']} radius={[4, 4, 0, 0]} barSize={18} />
                </>
              ) : (
                <Bar dataKey={activeFilter} fill={CATEGORY_COLORS[activeFilter as keyof typeof CATEGORY_COLORS] || 'hsl(234, 85%, 60%)'} radius={[4, 4, 0, 0]} barSize={22} />
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
            <div>
              <p className="text-xl font-bold text-card-foreground">{busiestDay.day || '—'}</p>
              <p className="text-[10px] uppercase text-[#727B8E] dark:text-[#8a94a6] tracking-wide">Mais Cheio</p>
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
