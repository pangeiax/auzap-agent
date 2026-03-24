import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { DashboardKpiCards } from "@/components/molecules/DashboardKpiCards";
import { MetricsRevenueChart } from "@/components/molecules/MetricsRevenueChart";
import { AppointmentsWeekdayChart } from "@/components/molecules/AppointmentsWeekdayChart";
import { TopServicesDonutChart } from "@/components/molecules/TopServicesDonutChart";
import { RecurrenceDonutChart } from "@/components/molecules/RecurrenceDonutChart";
import { LostClientsList } from "@/components/molecules/LostClientsList";
import { DashboardLayout } from "@/components/templates/DashboardLayout";
import { dashboardService } from "@/services";
import { useAuthContext } from "@/contexts/AuthContext";
import { BrainChat } from "@/features/brain/BrainChat";
import type {
  DashboardKpis,
  RevenueByMonth,
  AppointmentByWeekday,
  TopService,
  ClientRecurrence,
  LostClient,
} from "@/services/dashboardService";

export default function DashboardPage() {
  const { user } = useAuthContext();

  const [kpisData, setKpisData] = useState<DashboardKpis | null>(null);
  const [revenueData, setRevenueData] = useState<RevenueByMonth[]>([]);
  const [weekdayData, setWeekdayData] = useState<AppointmentByWeekday[]>([]);
  const [topServicesData, setTopServicesData] = useState<TopService[]>([]);
  const [recurrenceData, setRecurrenceData] = useState<ClientRecurrence | null>(null);
  const [lostClientsData, setLostClientsData] = useState<LostClient[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(true);

  useEffect(() => {
    const fetchDashboard = async () => {
      setMetricsLoading(true);
      try {
        const [kpis, revenue, weekday, topServices, recurrence, lostClients] =
          await Promise.allSettled([
            dashboardService.getKpis(),
            dashboardService.getRevenueByMonth(),
            dashboardService.getAppointmentsByWeekday(),
            dashboardService.getTopServices(),
            dashboardService.getClientRecurrence(),
            dashboardService.getLostClients(),
          ]);
        if (kpis.status === "fulfilled") setKpisData(kpis.value);
        if (revenue.status === "fulfilled") setRevenueData(revenue.value);
        if (weekday.status === "fulfilled") setWeekdayData(weekday.value);
        if (topServices.status === "fulfilled") setTopServicesData(topServices.value);
        if (recurrence.status === "fulfilled") setRecurrenceData(recurrence.value);
        if (lostClients.status === "fulfilled") setLostClientsData(lostClients.value);
      } catch (error) {
        console.error("Erro ao buscar dados do dashboard:", error);
      } finally {
        setMetricsLoading(false);
      }
    };
    fetchDashboard();
  }, []);

  return (
    <DashboardLayout contentClassName="mx-0!">
      <BrainChat userName={user?.name ?? "usuário"} />

      <div className="w-full rounded-[24px_24px_0_0] bg-white dark:bg-[#272A34] sm:rounded-[40px_40px_0_0] pt-8 sm:pt-12">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
          className="w-full space-y-4 px-4 py-6 sm:space-y-6 sm:px-6 sm:py-8 xl:px-10"
        >
          <div className="mb-6 sm:mb-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-semibold text-[#0F172A] dark:text-white mb-2">
              Métricas e Dashboards
            </h2>
            <p className="text-sm sm:text-base text-[#727B8E] dark:text-[#8a94a6]">
              Acompanhe as principais métricas do seu negócio em tempo real e
              tome decisões informadas para impulsionar seu crescimento.
            </p>
          </div>

          {/* Linha 1: KPI cards */}
          <DashboardKpiCards data={kpisData} loading={metricsLoading} />

          {/* Linha 2: Receita + Agendamentos por dia */}
          <div className="grid grid-cols-1 items-stretch gap-4 sm:gap-6 lg:grid-cols-2">
            <MetricsRevenueChart data={revenueData} className="h-full" />
            <AppointmentsWeekdayChart data={weekdayData} className="h-full" />
          </div>

          {/* Linha 3: Serviços (rosca) + Recorrência + Clientes sumidos */}
          <div className="grid grid-cols-1 items-stretch gap-4 sm:gap-6 lg:grid-cols-3">
            <TopServicesDonutChart data={topServicesData} className="h-full" />
            <RecurrenceDonutChart data={recurrenceData} className="h-full" />
            <LostClientsList clients={lostClientsData} className="h-full" />
          </div>
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
