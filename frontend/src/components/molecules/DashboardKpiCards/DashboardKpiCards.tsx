"use client";

import { cn } from "@/lib/cn";
import { usePlan } from "@/hooks/usePlan";
import type { DashboardKpis } from "@/services/dashboardService";
import ConfirmadosHoje from "./cards/ConfirmadosHoje";
import HorasEconomizadas from "./cards/HorasEconomizadas";
import Faturamento from "./cards/Faturamento";
import ConversaoWhatsapp from "./cards/ConversaoWhatsapp";

interface Props {
  data: DashboardKpis | null;
  loading?: boolean;
}

function EmptyValue({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xl font-bold text-[#727B8E] dark:text-[#8a94a6]">
        —
      </span>
      <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">{label}</p>
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
        "rounded-lg border border-[#727B8E1A] dark:border-[#40485A] bg-white p-4 backdrop-blur-[6px]",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-[#737b8c]">
          {title}
        </p>
        <div className="flex h-7 w-7 px-2 items-center justify-center rounded-md bg-[#4254f0]/10 text-[#4254f0]">
          {icon}
        </div>
      </div>
      {children}
    </div>
  );
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
            className="h-32 animate-pulse rounded-lg border border-[#727B8E1A] dark:border-[#40485A] bg-[#eeeff2]"
          />
        ))}
      </div>
    );
  }

  const { today, aiTime, afterHours, topService, conversion, sentiment, revenueRealtime } = data;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
      <ConfirmadosHoje
        confirmed={today.confirmed}
        total={today.total}
        pending={today.pending}
      />

      <HorasEconomizadas
        hours={aiTime.hours}
        afterHoursPct={afterHours.pct_after_hours}
        weekendPct={afterHours.pct_weekend}
        totalConversations={aiTime.total_conversations}
      />

      {revenueRealtime && (
        <Faturamento
          today={revenueRealtime.today}
          todayVsYesterdayPct={revenueRealtime.today_vs_yesterday_pct}
          thisWeek={revenueRealtime.this_week}
          thisWeekVsLastPct={revenueRealtime.this_week_vs_last_pct}
        />
      )}

      <ConversaoWhatsapp
        conversionRate={conversion.conversion_rate}
        totalAppointments={conversion.total_appointments}
        revenueGenerated={conversion.revenue_generated}
        totalConversations={conversion.total_conversations}
      />

      {/* KPI 5: Serviço em alta */}
      {/* <KpiCard
        title="Serviço em alta este mês"
        icon={<Zap className="h-3.5 w-3.5" />}
      >
        {!topService ? (
          <EmptyValue label="Dados insuficientes" />
        ) : (
          <>
            <p className="text-lg font-bold text-card-foreground leading-tight">
              {topService.service_name}
            </p>
            <p className="mt-1 text-xs font-medium text-success">
              ↑ {topService.growth_pct}% vs mês anterior
            </p>
            <span className="mt-2 inline-block rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
              crescendo
            </span>
          </>
        )}
      </KpiCard> */}

      {/* KPI 6: Temperatura dos clientes (somente plano Pro) */}
      {/* {isPro && (
        <KpiCard
          title="Temperatura dos clientes"
          icon={<ThermometerSun className="h-3.5 w-3.5" />}
        >
          {!sentiment || sentiment.total_analyzed === 0 ? (
            <EmptyValue label="Nenhum cliente analisado" />
          ) : (
            <>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-success">
                  {sentiment.positive_pct}%
                </span>
                <span className="text-xs text-[#727B8E] dark:text-[#8a94a6]">positivos</span>
              </div>

              <div className="mt-2 flex overflow-hidden rounded" style={{ height: 6 }}>
                <div style={{ flex: sentiment.positive }} className="bg-success" />
                <div style={{ flex: sentiment.neutral }} className="bg-muted" />
                <div style={{ flex: sentiment.negative }} className="bg-destructive" />
              </div>

              <div className="mt-2 flex gap-3">
                <span className="text-[10px] text-success">{sentiment.positive} pos.</span>
                <span className="text-[10px] text-[#727B8E] dark:text-[#8a94a6]">{sentiment.neutral} neu.</span>
                <span className="text-[10px] text-destructive">{sentiment.negative} neg.</span>
              </div>

              {sentiment.high_churn_risk > 0 && (
                <p className="mt-1 text-[10px] font-semibold text-destructive">
                  ⚠ {sentiment.high_churn_risk} risco alto de churn
                </p>
              )}

              <p className="mt-1 text-[10px] text-[#727B8E] dark:text-[#8a94a6]">
                {sentiment.total_analyzed} clientes analisados
              </p>
            </>
          )}
        </KpiCard>
      )} */}
    </div>
  );
}
