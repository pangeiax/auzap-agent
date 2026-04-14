"use client";

import { useState, useEffect, useCallback } from "react";
import { DashboardLayout } from "@/components/templates/DashboardLayout";
import { Loader2, ChevronLeft, ChevronRight, Calendar, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/hooks";
import { staffService, type Staff } from "@/services/staffService";
import { specialtyService } from "@/services";
import { appointmentService } from "@/services";
import type { Specialty } from "@/types/petshop";

// ── Utilitários ───────────────────────────────────────────────

function fmt(t?: string | null): string {
  if (!t) return "";
  const s = String(t);
  if (s.includes("T")) return s.split("T")[1]?.slice(0, 5) ?? "";
  return s.slice(0, 5);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDateBR(d: Date): string {
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(m: number): string {
  return `${Math.floor(m / 60).toString().padStart(2, "0")}:${(m % 60).toString().padStart(2, "0")}`;
}

// ── Tipos ─────────────────────────────────────────────────────

interface Appointment {
  id: string
  petName?: string
  clientName?: string
  serviceName?: string
  startTime?: string
  endTime?: string
  staffId?: string
  status?: string
  slotId?: string | null
}

// ── Coluna de um funcionário ──────────────────────────────────

interface StaffColumnProps {
  staff: Staff
  date: string
  dayOfWeek: number
  appointments: Appointment[]
}

const HOUR_HEIGHT = 48; // px por hora
const DAY_START = 7;    // 7h
const DAY_END = 21;     // 21h
const TOTAL_HOURS = DAY_END - DAY_START;

function StaffColumn({ staff, date, dayOfWeek, appointments }: StaffColumnProps) {
  // Resolve per-day hours
  const byDay = staff.workHoursByDay;
  const dayKey = String(dayOfWeek);
  const hasDayOverride = byDay && byDay[dayKey];
  const ws = hasDayOverride ? byDay[dayKey].start : (fmt(staff.workStart) || "08:00");
  const we = hasDayOverride ? byDay[dayKey].end : (fmt(staff.workEnd) || "18:00");
  const ls = hasDayOverride ? (byDay[dayKey].lunch_start ?? null) : (fmt(staff.lunchStart) || null);
  const le = hasDayOverride ? (byDay[dayKey].lunch_end ?? null) : (fmt(staff.lunchEnd) || null);

  const workStartMin = timeToMinutes(ws);
  const workEndMin   = timeToMinutes(we);
  const dayStartMin  = DAY_START * 60;

  function topPct(timeStr: string): number {
    const m = timeToMinutes(timeStr);
    return ((m - dayStartMin) / (TOTAL_HOURS * 60)) * 100;
  }

  function heightPct(startStr: string, endStr: string): number {
    const dur = timeToMinutes(endStr) - timeToMinutes(startStr);
    return (dur / (TOTAL_HOURS * 60)) * 100;
  }

  const workTopPct    = ((workStartMin - dayStartMin) / (TOTAL_HOURS * 60)) * 100;
  const workHeightPct = ((workEndMin - workStartMin)  / (TOTAL_HOURS * 60)) * 100;

  // Almoço
  const lunchTopPct    = ls ? topPct(ls) : null;
  const lunchHeightPct = ls && le ? heightPct(ls, le) : null;

  return (
    <div className="relative flex-1 min-w-[120px] border-r border-[#727B8E]/10 dark:border-[#40485A]">
      {/* Fundo fora do horário de trabalho */}
      <div className="absolute inset-0 bg-[#F8F9FB] dark:bg-[#212225]" />

      {/* Horário de trabalho */}
      <div
        className="absolute left-0 right-0 bg-white dark:bg-[#1A1B1D]"
        style={{ top: `${workTopPct}%`, height: `${workHeightPct}%` }}
      />

      {/* Almoço */}
      {lunchTopPct !== null && lunchHeightPct !== null && (
        <div
          className="absolute left-0 right-0 bg-[#FFF8E1] dark:bg-[#2d2a1e]"
          style={{ top: `${lunchTopPct}%`, height: `${lunchHeightPct}%` }}
        />
      )}

      {/* Linhas de hora */}
      {Array.from({ length: TOTAL_HOURS }, (_, i) => (
        <div
          key={i}
          className="absolute left-0 right-0 border-t border-[#727B8E]/10 dark:border-[#40485A]"
          style={{ top: `${(i / TOTAL_HOURS) * 100}%` }}
        />
      ))}

      {/* Agendamentos */}
      {appointments.map(appt => {
        if (!appt.startTime || !appt.endTime) return null;
        const tp = topPct(appt.startTime);
        const hp = heightPct(appt.startTime, appt.endTime);
        const isLegacy = !appt.staffId && !!appt.slotId;
        return (
          <div
            key={appt.id}
            className={cn(
              "absolute left-1 right-1 rounded-md px-1.5 py-1 text-[10px] overflow-hidden shadow-sm",
              appt.status === "cancelled"
                ? "bg-red-100 text-red-700 line-through dark:bg-red-900/30 dark:text-red-400"
                : isLegacy
                ? "bg-[#E8F0FE] text-[#3B63F6] dark:bg-[#1e2d5e] dark:text-[#93b4fd]"
                : "bg-[#DCFCE7] text-green-800 dark:bg-[#14532d] dark:text-green-300"
            )}
            style={{ top: `${tp}%`, height: `${Math.max(hp, 3)}%` }}
            title={`${appt.petName} · ${appt.serviceName} · ${appt.startTime}–${appt.endTime}`}
          >
            <p className="font-semibold leading-tight truncate">{appt.petName}</p>
            <p className="leading-tight truncate text-[9px] opacity-80">{appt.serviceName}</p>
            {isLegacy && <p className="text-[8px] opacity-60">legado</p>}
          </div>
        );
      })}
    </div>
  );
}

// ── Página ────────────────────────────────────────────────────

export default function AgendaPage() {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [staffList, setStaffList]     = useState<Staff[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading]         = useState(true);
  const [filterSpecialty, setFilterSpecialty] = useState<string>("all");
  const { error: toastError } = useToast();

  const dateStr = toISO(currentDate);
  const dayOfWeekDB = (currentDate.getDay()); // 0=dom

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [staff, specs] = await Promise.all([
        staffService.list(),
        specialtyService.list(),
      ]);
      setStaffList(staff);
      setSpecialties(specs);

      // Buscar agendamentos do dia
      try {
        const appts = await appointmentService.listAppointments();
        // Normalizar: preferir start_time dos campos novos; fallback para slotTime
        const normalized: Appointment[] = (appts as any[]).map((a: any) => ({
          id: a.id,
          petName: a.pet?.name ?? a.petName ?? "Pet",
          clientName: a.client?.name ?? a.clientName,
          serviceName: a.service?.name ?? a.serviceName ?? "Serviço",
          startTime: a.startTime ?? a.start_time ?? (a.slot?.slotTime ? fmt(a.slot.slotTime) : undefined),
          endTime: a.endTime ?? a.end_time,
          staffId: a.staffId ?? a.staff_id ?? null,
          status: a.status,
          slotId: a.slotId ?? a.slot_id ?? null,
        }));
        setAppointments(normalized);
      } catch {
        setAppointments([]);
      }
    } catch {
      toastError("Erro ao carregar agenda");
    } finally {
      setLoading(false);
    }
  }, [dateStr, toastError]);

  useEffect(() => { load(); }, [load]);

  // Filtrar staff pelo dia da semana e especialidade
  const visibleStaff = staffList.filter(s => {
    if (!s.daysOfWeek.includes(dayOfWeekDB)) return false;
    if (filterSpecialty !== "all" && !s.specialtyIds.includes(filterSpecialty)) return false;
    return true;
  });

  // Mapear agendamentos por staffId
  function getApptsByStaff(staffId: string): Appointment[] {
    return appointments.filter(a => a.staffId === staffId);
  }

  // Construir labels de hora para a grade
  const hours = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => minutesToTime((DAY_START + i) * 60));

  return (
    <DashboardLayout>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-8 pt-6 sm:px-6 lg:px-10">
        {/* Cabeçalho */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[#1A2233] dark:text-white">Agenda por Funcionário</h1>
            <p className="text-sm text-[#727B8E]">Vista diária — {formatDateBR(currentDate)}</p>
          </div>

          <div className="flex items-center gap-2">
            {/* Filtro por especialidade */}
            <select
              value={filterSpecialty}
              onChange={e => setFilterSpecialty(e.target.value)}
              className="rounded-lg border border-[#727B8E]/20 bg-white px-3 py-2 text-sm text-[#1A2233] dark:border-[#40485A] dark:bg-[#1A1B1D] dark:text-white"
            >
              <option value="all">Todas especialidades</option>
              {specialties.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            {/* Navegação de data */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentDate(d => addDays(d, -1))}
                className="rounded-lg border border-[#727B8E]/20 p-2 text-[#727B8E] hover:bg-[#F0F4FF] dark:border-[#40485A] dark:hover:bg-[#2a2d36]"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setCurrentDate(new Date())}
                className="rounded-lg border border-[#727B8E]/20 px-3 py-2 text-xs font-medium text-[#3B63F6] hover:bg-[#F0F4FF] dark:border-[#40485A] dark:hover:bg-[#2a2d36]"
              >
                Hoje
              </button>
              <button
                onClick={() => setCurrentDate(d => addDays(d, 1))}
                className="rounded-lg border border-[#727B8E]/20 p-2 text-[#727B8E] hover:bg-[#F0F4FF] dark:border-[#40485A] dark:hover:bg-[#2a2d36]"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#727B8E]" />
          </div>
        ) : visibleStaff.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#727B8E]/30 dark:border-[#40485A]">
            <Users className="h-10 w-10 text-[#727B8E]/40" />
            <p className="font-medium text-[#434A57] dark:text-[#f5f9fc]">
              Nenhum funcionário trabalha neste dia
            </p>
            <p className="text-sm text-[#727B8E]">
              Configure a jornada em Configurações → Funcionários.
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D]">
            {/* Grade */}
            <div className="flex flex-1 overflow-x-auto overflow-y-auto">
              {/* Coluna de horas */}
              <div className="sticky left-0 z-10 w-14 shrink-0 border-r border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D]">
                {/* Cabeçalho vazio alinhado com header de staff */}
                <div className="h-12 border-b border-[#727B8E]/10 dark:border-[#40485A]" />
                <div
                  className="relative"
                  style={{ height: `${TOTAL_HOURS * HOUR_HEIGHT}px` }}
                >
                  {hours.slice(0, -1).map((h, i) => (
                    <div
                      key={h}
                      className="absolute right-2 -translate-y-2 text-[10px] text-[#727B8E]"
                      style={{ top: `${(i / TOTAL_HOURS) * 100}%` }}
                    >
                      {h}
                    </div>
                  ))}
                </div>
              </div>

              {/* Colunas por funcionário */}
              <div className="flex flex-1">
                {visibleStaff.map(staff => (
                  <div key={staff.id} className="flex flex-1 min-w-[140px] flex-col">
                    {/* Cabeçalho do funcionário */}
                    <div className="sticky top-0 z-10 h-12 border-b border-r border-[#727B8E]/10 bg-white px-2 dark:border-[#40485A] dark:bg-[#1A1B1D]">
                      <div className="flex h-full flex-col justify-center">
                        <p className="truncate text-xs font-semibold text-[#1A2233] dark:text-white">
                          {staff.name}
                        </p>
                        {staff.role && (
                          <p className="truncate text-[10px] text-[#727B8E]">{staff.role}</p>
                        )}
                      </div>
                    </div>

                    {/* Coluna de horários */}
                    <div
                      className="relative"
                      style={{ height: `${TOTAL_HOURS * HOUR_HEIGHT}px` }}
                    >
                      <StaffColumn
                        staff={staff}
                        date={dateStr}
                        dayOfWeek={dayOfWeekDB}
                        appointments={getApptsByStaff(staff.id)}
                      />
                    </div>
                  </div>
                ))}

              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
