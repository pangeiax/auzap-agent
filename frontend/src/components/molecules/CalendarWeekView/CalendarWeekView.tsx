import { cn } from "@/lib/cn";
import type { CalendarDayAvailability } from "@/components/molecules/CalendarGrid";

type AppointmentStatus = "concluido" | "confirmado" | "pendente" | "cancelado";

export interface WeekAppointment {
  id: string;
  initials: string;
  name: string;
  service: string;
  date: string;
  time: string;
  /** Segundo horário quando o serviço usa dois slots seguidos. */
  timeEnd?: string;
  status: AppointmentStatus;
}

export interface WeekDay {
  label: string;
  date: number;
  /** 0-11 */
  month: number;
  year: number;
  fullDate: string;
  /** YYYY-MM-DD (local), alinhado ao calendário e à API */
  dateKey: string;
  isToday?: boolean;
}

interface CalendarWeekViewProps {
  weekDays: WeekDay[];
  appointments: WeekAppointment[];
  onDayClick?: (date: number) => void;
  selectedDay?: number | null;
  dayAvailability?: Map<string, CalendarDayAvailability>;
}

const STATUS_DOT: Record<AppointmentStatus, string> = {
  concluido: "bg-[#3CD057]",
  confirmado: "bg-[#3C6BD0]",
  pendente: "bg-[#D0B33C]",
  cancelado: "bg-[#EF4444]",
};

const STATUS_BG: Record<AppointmentStatus, string> = {
  concluido:
    "bg-[#EAFBEB] border-l-[#3CD057] dark:bg-[#1e3d22] dark:border-l-[#3CD057]",
  confirmado:
    "bg-[#EBF1FB] border-l-[#3C6BD0] dark:bg-[#1e2d4a] dark:border-l-[#3C6BD0]",
  pendente:
    "bg-[#FBFBEB] border-l-[#D0B33C] dark:bg-[#3d381e] dark:border-l-[#D0B33C]",
  cancelado:
    "bg-[#FEF2F2] border-l-[#EF4444] dark:bg-[#3d1e1e] dark:border-l-[#EF4444]",
};

/** 07:00–21:00 — rolagem vertical no container pai */
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7);

function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function dayColumnTone(status: CalendarDayAvailability | undefined) {
  if (status === "available")
    return "bg-emerald-50/90 dark:bg-emerald-950/25 border-emerald-200/30 dark:border-emerald-800/20";
  if (status === "full")
    return "bg-red-50/90 dark:bg-red-950/25 border-red-200/30 dark:border-red-900/20";
  if (status === "closed")
    return "bg-[#E8EAED] dark:bg-[#2a2c30] border-[#727B8E]/15";
  return "bg-white dark:bg-[#1A1B1D] border-[rgba(114,123,142,0.1)] dark:border-[#40485A]";
}

export function CalendarWeekView({
  weekDays,
  appointments,
  onDayClick,
  selectedDay,
  dayAvailability,
}: CalendarWeekViewProps) {
  return (
    <div className="flex w-max min-w-full flex-col">
      <div className="sticky top-0 z-20 grid grid-cols-[80px_repeat(7,1fr)] border-b border-[#727B8E]/10 bg-white shadow-[0_1px_0_rgba(114,123,142,0.08)] dark:border-[#40485A] dark:bg-[#1A1B1D]">
        <div className="border-b border-r border-[rgba(114,123,142,0.1)] bg-[#FAFBFC] dark:border-[#40485A] dark:bg-[#212225]" />

        {weekDays.map((day) => {
          const st = dayAvailability?.get(day.dateKey);
          return (
          <button
            key={day.dateKey}
            type="button"
            title={
              st === "full"
                ? "Dia lotado"
                : st === "closed"
                  ? "Fechado / indisponível"
                  : st === "available"
                    ? "Com horários disponíveis"
                    : undefined
            }
            onClick={() => onDayClick?.(day.date)}
            className={cn(
              "flex flex-col items-center gap-0.5 border-b border-r py-2.5 transition-colors dark:border-[#40485A]",
              dayColumnTone(st),
              selectedDay === day.date &&
                "ring-2 ring-inset ring-[#1E62EC]/45 dark:ring-[#2172e5]/50",
              "cursor-pointer hover:brightness-[0.97]",
            )}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#727B8E] dark:text-[#8a94a6]">
              {day.label}
            </span>
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold",
                day.isToday
                  ? "bg-[#1B5FE9] text-white dark:bg-[#2172e5]"
                  : selectedDay === day.date
                    ? "text-[#1B5FE9] dark:text-[#6ba3f7]"
                    : st === "full"
                      ? "text-red-700 dark:text-red-300"
                      : st === "closed"
                        ? "text-[#727B8E] dark:text-[#8a94a6]"
                        : st === "available"
                          ? "text-emerald-800 dark:text-emerald-200"
                          : "text-[#434A57] dark:text-[#f5f9fc]",
              )}
            >
              {String(day.date).padStart(2, "0")}
            </span>
            {st === "full" && (
              <span className="text-[9px] font-medium text-red-600 dark:text-red-400">Lotado</span>
            )}
            {st === "closed" && (
              <span className="text-[9px] font-medium text-[#727B8E]">Fechado</span>
            )}
          </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-col pb-1">
        {HOURS.map((hour) => {
          const hourStr = formatHour(hour);

          return (
            <div
              key={hour}
              className="grid min-h-[64px] grid-cols-[80px_repeat(7,1fr)]"
            >
              <div className="flex items-start justify-end border-b border-r border-[rgba(114,123,142,0.1)] bg-[#FAFBFC] px-3 pt-2 dark:border-[#40485A] dark:bg-[#212225]">
                <span className="text-[11px] font-medium text-[#727B8E] dark:text-[#8a94a6]">
                  {hourStr}
                </span>
              </div>

              {weekDays.map((day) => {
                const cellAppointments = appointments.filter(
                  (a) => a.date === day.fullDate && a.time === hourStr,
                );
                const st = dayAvailability?.get(day.dateKey);

                return (
                  <div
                    key={day.dateKey}
                    className={cn(
                      "flex flex-col gap-1 border-b border-r border-[rgba(114,123,142,0.1)] p-1 dark:border-[#40485A]",
                      st === "available" &&
                        "bg-emerald-50/40 dark:bg-emerald-950/15",
                      st === "full" && "bg-red-50/35 dark:bg-red-950/12",
                      st === "closed" && "bg-[#E8EAED]/50 dark:bg-[#2a2c30]/40",
                      !st && "bg-white dark:bg-[#1A1B1D]",
                      selectedDay === day.date &&
                        "ring-1 ring-inset ring-[#1E62EC]/30 dark:ring-[#2172e5]/40",
                    )}
                  >
                    {cellAppointments.map((appt) => (
                      <div
                        key={appt.id}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg border-l-2 px-2 py-1.5",
                          STATUS_BG[appt.status],
                        )}
                      >
                        <div
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            STATUS_DOT[appt.status],
                          )}
                        />
                        <div className="flex flex-col overflow-hidden">
                          <span className="truncate text-[11px] font-medium text-[#434A57] dark:text-[#f5f9fc]">
                            {appt.name}
                          </span>
                          <span className="truncate text-[10px] text-[#727B8E] dark:text-[#8a94a6]">
                            {appt.service}
                            {appt.timeEnd
                              ? ` · ${appt.time}–${appt.timeEnd}`
                              : ""}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
