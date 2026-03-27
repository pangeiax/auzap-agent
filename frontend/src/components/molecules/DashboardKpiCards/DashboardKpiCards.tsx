"use client";

import { TrendingUp, Clock, Zap, MessageCircle, ThermometerSun, DollarSign } from "lucide-react";
import { cn } from "@/lib/cn";
import { usePlan } from "@/hooks/usePlan";
import type { DashboardKpis } from "@/services/dashboardService";

interface Props {
  data: DashboardKpis | null;
  loading?: boolean;
}

function EmptyValue({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xl font-bold text-[#727B8E] dark:text-[#4a5568]">
        —
      </span>
      <p className="text-xs text-[#9ca3af] dark:text-[#6b7280]">{label}</p>
    </div>
  );
}

function KpiCard({
  title,
  icon,
  children,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-[#727B8E1A] bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-4 backdrop-blur-[6px]",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-[#727B8E] dark:text-[#8a94a6]">
          {title}
        </p>
        <div className="flex h-7 w-7 px-2 items-center justify-center rounded-md bg-[#1E62EC]/10 text-[#1E62EC] dark:bg-[#2172e5]/20 dark:text-[#6ba3f7]">
          {icon}
        </div>
      </div>
      {children}
    </div>
  );
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function DashboardKpiCards({ data, loading }: Props) {
  const { isPro } = usePlan();
  const totalCards = isPro ? 6 : 5;

  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
        {[...Array(totalCards)].map((_, i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-lg border border-[#727B8E1A] bg-[#f3f4f6] dark:border-[#40485A] dark:bg-[#1f2129]"
          />
        ))}
      </div>
    );
  }

  const { today, aiTime, afterHours, topService, conversion, sentiment, revenueRealtime } = data;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
      {/* KPI 1: Confirmados hoje */}
      <KpiCard
        title="Confirmados hoje"
        icon={<TrendingUp className="h-3.5 w-3.5" />}
      >
        {today.total === 0 ? (
          <EmptyValue label="Sem agendamentos hoje" />
        ) : (
          <>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-[#434A57] dark:text-[#f5f9fc]">
                {today.confirmed}
              </span>
              <span className="text-lg text-[#9ca3af]">/ {today.total}</span>
            </div>
            {today.pending > 0 ? (
              <p className="mt-1 text-xs text-amber-500">
                {today.pending} aguardando confirmação
              </p>
            ) : (
              <p className="mt-1 text-xs text-emerald-500">Todos confirmados</p>
            )}
          </>
        )}
      </KpiCard>

      {/* KPI 2: Tempo trabalhado pela IA */}
      <KpiCard
        title="Horas economizadas pela AuZap neste mês"
        icon={<Clock className="h-3.5 w-3.5" />}
      >
        {aiTime.total_conversations === 0 ? (
          <EmptyValue label="Sem conversas este mês" />
        ) : (
          <>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-[#434A57] dark:text-[#f5f9fc]">
                {aiTime.hours}
              </span>
              <span className="text-sm text-[#9ca3af]">h</span>
            </div>
            <div className="mt-2 space-y-0.5">
              <div className="flex justify-between text-xs">
                <span className="text-[#727B8E] dark:text-[#8a94a6]">
                  Fora do horário
                </span>
                <span className="font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                  {afterHours.pct_after_hours}%
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#727B8E] dark:text-[#8a94a6]">
                  Fins de semana
                </span>
                <span className="font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                  {afterHours.pct_weekend}%
                </span>
              </div>
            </div>
          </>
        )}
      </KpiCard>

      {/* KPI 3: Serviço em alta */}
      <KpiCard
        title="Serviço em alta este mês"
        icon={<Zap className="h-3.5 w-3.5" />}
      >
        {!topService ? (
          <EmptyValue label="Dados insuficientes" />
        ) : (
          <>
            <p className="text-lg font-bold text-[#434A57] dark:text-[#f5f9fc] leading-tight">
              {topService.service_name}
            </p>
            <p className="mt-1 text-xs font-medium text-emerald-500">
              ↑ {topService.growth_pct}% vs mês anterior
            </p>
            <span className="mt-2 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">
              crescendo
            </span>
          </>
        )}
      </KpiCard>

      {/* KPI 4: Conversão WhatsApp */}
      <KpiCard
        title="Conversão WhatsApp"
        icon={<MessageCircle className="h-3.5 w-3.5" />}
      >
        {conversion.total_conversations === 0 ? (
          <EmptyValue label="Sem conversas registradas" />
        ) : (
          <>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-[#434A57] dark:text-[#f5f9fc]">
                {Number(conversion.conversion_rate).toFixed(0)}%
              </span>
            </div>
            <div className="mt-2 flex gap-4">
              <div>
                <p className="text-base font-bold text-[#434A57] dark:text-[#f5f9fc]">
                  {conversion.total_appointments}
                </p>
                <p className="text-[10px] text-[#727B8E] dark:text-[#8a94a6]">
                  agendamentos
                </p>
              </div>
              <div>
                <p className="text-base font-bold text-[#434A57] dark:text-[#f5f9fc]">
                  R${" "}
                  {Number(conversion.revenue_generated).toLocaleString(
                    "pt-BR",
                    {
                      minimumFractionDigits: 0,
                    },
                  )}
                </p>
                <p className="text-[10px] text-[#727B8E] dark:text-[#8a94a6]">
                  valor gerado
                </p>
              </div>
            </div>
            <p className="mt-1 text-[10px] text-[#9ca3af]">
              {conversion.total_conversations} conversas recebidas
            </p>
          </>
        )}
      </KpiCard>

      {/* KPI 5: Faturamento */}
      <KpiCard
        title="Faturamento"
        icon={<DollarSign className="h-3.5 w-3.5" />}
      >
        {!revenueRealtime ? (
          <EmptyValue label="Sem dados de faturamento" />
        ) : (
          <div className="grid grid-cols-1 divide-y xsm:divide-y-0 xsm:grid-cols-2 xsm:divide-x divide-[#727b8e7d]! dark:divide-[#40485A]!">
            <div className="pr-3 pb-1.5 xsm:pb-0">
              <p className="text-[10px] text-[#9ca3af] mb-1">hoje</p>
              <p className="text-2xl font-bold text-[#434A57] dark:text-[#f5f9fc] leading-none">
                {formatCurrency(revenueRealtime.today)}
              </p>
              {revenueRealtime.today_vs_yesterday_pct !== null ? (
                <p className={`mt-1 text-xs font-medium ${revenueRealtime.today_vs_yesterday_pct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {revenueRealtime.today_vs_yesterday_pct >= 0 ? '↑' : '↓'} {Math.abs(revenueRealtime.today_vs_yesterday_pct)}% vs ontem
                </p>
              ) : (
                <p className="mt-1 text-[10px] text-[#9ca3af]">sem dado anterior</p>
              )}
            </div>

            <div className="xsm:pl-3 pt-1.5 xsm:pt-0">
              <p className="text-[10px] text-[#9ca3af] mb-1">esta semana</p>
              <p className="text-2xl font-bold text-[#434A57] dark:text-[#f5f9fc] leading-none">
                {formatCurrency(revenueRealtime.this_week)}
              </p>
              {revenueRealtime.this_week_vs_last_pct !== null ? (
                <p className={`mt-1 text-xs font-medium ${revenueRealtime.this_week_vs_last_pct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {revenueRealtime.this_week_vs_last_pct >= 0 ? '↑' : '↓'} {Math.abs(revenueRealtime.this_week_vs_last_pct)}% vs ant.
                </p>
              ) : (
                <p className="mt-1 text-[10px] text-[#9ca3af]">sem dado anterior</p>
              )}
            </div>
          </div>
        )}
      </KpiCard>

      {/* KPI 6: Temperatura dos clientes (somente plano Pro) */}
      {isPro && (
        <KpiCard
          title="Temperatura dos clientes"
          icon={<ThermometerSun className="h-3.5 w-3.5" />}
        >
          {!sentiment || sentiment.total_analyzed === 0 ? (
            <EmptyValue label="Nenhum cliente analisado" />
          ) : (
            <>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-emerald-600">
                  {sentiment.positive_pct}%
                </span>
                <span className="text-xs text-[#9ca3af]">positivos</span>
              </div>

              <div className="mt-2 flex overflow-hidden rounded" style={{ height: 6 }}>
                <div style={{ flex: sentiment.positive, background: '#059669' }} />
                <div style={{ flex: sentiment.neutral, background: '#d1d5db' }} />
                <div style={{ flex: sentiment.negative, background: '#dc2626' }} />
              </div>

              <div className="mt-2 flex gap-3">
                <span className="text-[10px] text-emerald-600">{sentiment.positive} pos.</span>
                <span className="text-[10px] text-[#6b7280]">{sentiment.neutral} neu.</span>
                <span className="text-[10px] text-red-500">{sentiment.negative} neg.</span>
              </div>

              {sentiment.high_churn_risk > 0 && (
                <p className="mt-1 text-[10px] font-semibold text-red-500">
                  ⚠ {sentiment.high_churn_risk} risco alto de churn
                </p>
              )}

              <p className="mt-1 text-[10px] text-[#9ca3af]">
                {sentiment.total_analyzed} clientes analisados
              </p>
            </>
          )}
        </KpiCard>
      )}
    </div>
  );
}
