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

      // MOCK DATA - Remover depois e usar dados reais da API
      const useMockData = false;

      if (useMockData) {
        // Simular delay de carregamento
        await new Promise(resolve => setTimeout(resolve, 500));

        setKpisData({
          today: {
            total: 18,
            confirmed: 12,
            pending: 6,
          },
          aiTime: {
            hours: 18.5,
            total_conversations: 45,
          },
          afterHours: {
            pct_after_hours: 35,
            pct_weekend: 20,
            total: 15,
          },
          conversion: {
            total_conversations: 120,
            total_appointments: 82,
            conversion_rate: 68,
            revenue_generated: 12300,
          },
          topService: {
            service_name: 'Banho + Tosa',
            growth_pct: 15,
          },
          revenueRealtime: {
            today: 2450.00,
            today_vs_yesterday_pct: 12,
            this_week: 15800,
            this_week_vs_last_pct: 8,
            this_month: 58400,
            this_month_vs_last_pct: 22,
          },
        });

        setWeekdayData([
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
        ]);

        setTopServicesData([
          {
            service_name: 'Banho + Tosa', revenue_pct: 38, avg_ticket: 150,
            total_appointments: 0,
            total_revenue: 0
          },
          {
            service_name: 'Banho simples', revenue_pct: 27, avg_ticket: 80,
            total_appointments: 0,
            total_revenue: 0
          },
          {
            service_name: 'Tosa', revenue_pct: 18, avg_ticket: 90,
            total_appointments: 0,
            total_revenue: 0
          },
          {
            service_name: 'Consulta Vet', revenue_pct: 11, avg_ticket: 200,
            total_appointments: 0,
            total_revenue: 0
          },
          {
            service_name: 'Outros', revenue_pct: 6, avg_ticket: 50,
            total_appointments: 0,
            total_revenue: 0
          },
        ]);

        setRecurrenceData({
          active: 120,
          at_risk: 50,
          lost: 20,
          never: 10,
          avg_return_days: 28,
        });

        setLostClientsData([
          {
            client_id: '1',
            client_name: 'Carla',
            pet_name: 'Bichon Frisé',
            last_visit: '2025-01-14',
            days_absent: 62,
            phone: '11987654321',
            pet_species: ""
          },
          {
            client_id: '2',
            client_name: 'João',
            pet_name: 'Shih-Tzu',
            last_visit: '2025-01-26',
            days_absent: 51,
            phone: '11987654322',
            pet_species: ""
          },
          {
            client_id: '3',
            client_name: 'Rita',
            pet_name: 'Poodle',
            last_visit: '2025-01-28',
            days_absent: 48,
            phone: '11987654323',
            pet_species: ""
          },
          {
            client_id: '4',
            client_name: 'Fábio',
            pet_name: 'Labrador',
            last_visit: '2025-01-31',
            days_absent: 46,
            phone: '11987654324',
            pet_species: ""
          },
          {
            client_id: '5',
            client_name: 'Ana',
            pet_name: 'Golden',
            last_visit: '2025-02-01',
            days_absent: 45,
            phone: '11987654325',
            pet_species: ""
          },
          {
            client_id: '6',
            client_name: 'Pedro',
            pet_name: 'Husky',
            last_visit: '2025-02-02',
            days_absent: 44,
            phone: '11987654326',
            pet_species: ""
          },
          {
            client_id: '7',
            client_name: 'Maria',
            pet_name: 'Pug',
            last_visit: '2025-02-03',
            days_absent: 43,
            phone: '11987654327',
            pet_species: ""
          },
          {
            client_id: '8',
            client_name: 'Carlos',
            pet_name: 'Beagle',
            last_visit: '2025-02-04',
            days_absent: 42,
            phone: '11987654328',
            pet_species: ""
          },
          {
            client_id: '9',
            client_name: 'Juliana',
            pet_name: 'Bulldog',
            last_visit: '2025-02-05',
            days_absent: 41,
            phone: '11987654329',
            pet_species: ""
          },
          {
            client_id: '10',
            client_name: 'Roberto',
            pet_name: 'Boxer',
            last_visit: '2025-02-06',
            days_absent: 40,
            phone: '11987654330',
            pet_species: ""
          },
          {
            client_id: '11',
            client_name: 'Fernanda',
            pet_name: 'Chihuahua',
            last_visit: '2025-02-07',
            days_absent: 39,
            phone: '11987654331',
            pet_species: ""
          },
          {
            client_id: '12',
            client_name: 'Lucas',
            pet_name: 'Dálmata',
            last_visit: '2025-02-08',
            days_absent: 38,
            phone: '11987654332',
            pet_species: ""
          },
          {
            client_id: '13',
            client_name: 'Patrícia',
            pet_name: 'Cocker',
            last_visit: '2025-02-09',
            days_absent: 37,
            phone: '11987654333',
            pet_species: ""
          },
          {
            client_id: '14',
            client_name: 'Marcos',
            pet_name: 'Pastor Alemão',
            last_visit: '2025-02-10',
            days_absent: 36,
            phone: '11987654334',
            pet_species: ""
          },
        ]);

        setMetricsLoading(false);
        return;
      }

      // CÓDIGO ORIGINAL - Descomentar quando voltar a usar API
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

          <DashboardKpiCards data={kpisData} loading={metricsLoading} />

          <div className="grid grid-cols-1 items-stretch gap-4 sm:gap-6 lg:grid-cols-2">
            <MetricsRevenueChart data={revenueData} useMockData={true} className="h-full" />
            <AppointmentsWeekdayChart data={weekdayData} className="h-full" />
          </div>

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
