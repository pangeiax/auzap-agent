import { useMemo } from "react";
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
  timeEnd?: string;
  status: AppointmentStatus;
}

export interface WeekDay {
  label: string;
  date: number;
  month: number;
  year: number;
  fullDate: string;
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
  concluido: "bg-emerald-400",
  confirmado: "bg-[#1E62EC]",
  pendente: "bg-amber-400",
  cancelado: "bg-red-400",
};

const STATUS_CARD: Record<AppointmentStatus, string> = {
  concluido:
    "bg-emerald-500/10 border-l-emerald-400 dark:bg-emerald-400/10 dark:border-l-emerald-400",
  confirmado:
    "bg-[#1E62EC]/8 border-l-[#1E62EC] dark:bg-[#1E62EC]/12 dark:border-l-[#5b9aff]",
  pendente:
    "bg-amber-400/10 border-l-amber-400 dark:bg-amber-400/10 dark:border-l-amber-400",
  cancelado:
    "bg-red-400/8 border-l-red-400/60 dark:bg-red-400/8 dark:border-l-red-400/50",
};

const STATUS_TEXT: Record<AppointmentStatus, string> = {
  concluido: "text-emerald-800 dark:text-emerald-300",
  confirmado: "text-[#1E62EC] dark:text-[#5b9aff]",
  pendente: "text-amber-700 dark:text-amber-300",
  cancelado: "text-red-500/60 dark:text-red-400/50 line-through",
};

/** 06:00-23:00 */
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6);

function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function getHour(time: string): number {
  return parseInt(time.split(":")[0] ?? "0", 10);
}

function headerTone(
  st: CalendarDayAvailability | undefined,
  isSelected: boolean,
) {
  if (isSelected) return "bg-[#1E62EC]/5 dark:bg-[#1E62EC]/8";
  if (st === "closed") return "bg-[#F4F6F9]/80 dark:bg-[#212225]/60";
  return "bg-white dark:bg-[#1A1B1D]";
}

function cellTone(st: CalendarDayAvailability | undefined) {
  if (st === "available") return "bg-emerald-50/30 dark:bg-emerald-950/10";
  if (st === "full") return "bg-red-50/25 dark:bg-red-950/8";
  if (st === "closed") return "bg-[#F4F6F9]/50 dark:bg-[#212225]/40";
  return "";
}

export function CalendarWeekView({
  weekDays,
  appointments,
  onDayClick,
  selectedDay,
  dayAvailability,
}: CalendarWeekViewProps) {
  const cellMap = useMemo(() => {
    const map = new Map<string, WeekAppointment[]>();
    for (const appt of appointments) {
      const hour = getHour(appt.time);
      const key = `${appt.date}|${hour}`;
      const list = map.get(key) ?? [];
      list.push(appt);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.time.localeCompare(b.time));
    }
    return map;
  }, [appointments]);

  const countByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const appt of appointments) {
      map.set(appt.date, (map.get(appt.date) ?? 0) + 1);
    }
    return map;
  }, [appointments]);

  return (
    <div className="flex w-max min-w-full flex-col rounded-xl border border-[#727B8E]/10 dark:border-[#40485A]">
      {/* ── Header ── */}
      <div className="sticky top-0 z-20 grid grid-cols-[72px_repeat(7,minmax(100px,1fr))]">
        {/* Corner */}
        <div className="rounded-tl-xl border-b border-r border-[#727B8E]/10 bg-[#F4F6F9] dark:border-[#40485A] dark:bg-[#212225]" />

        {weekDays.map((day, i) => {
          const st = dayAvailability?.get(day.dateKey);
          const count = countByDay.get(day.fullDate) ?? 0;
          const selected = selectedDay === day.date;
          const isLast = i === weekDays.length - 1;

          return (
            <button
              key={day.dateKey}
              type="button"
              title={
                st === "full"
                  ? "Dia lotado"
                  : st === "closed"
                    ? "Fechado / indisponivel"
                    : st === "available"
                      ? "Com horarios disponiveis"
                      : undefined
              }
              onClick={() => onDayClick?.(day.date)}
              className={cn(
                "flex flex-col items-center gap-1 border-b border-r border-[#727B8E]/10 py-3 transition-colors dark:border-[#40485A]",
                headerTone(st, selected),
                isLast && "rounded-tr-xl border-r-0",
                "cursor-pointer hover:bg-[#F4F6F9]/60 dark:hover:bg-[#212225]/80",
                selected && "ring-2 ring-inset ring-[#1E62EC] dark:ring-[#5b9aff]",
              )}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#727B8E] dark:text-[#8a94a6]">
                {day.label}
              </span>

              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold",
                  day.isToday
                    ? "bg-[#1E62EC] text-white"
                    : selected
                      ? "text-[#1E62EC] dark:text-[#5b9aff]"
                      : st === "closed"
                        ? "text-[#727B8E]/70 dark:text-[#8a94a6]/50"
                        : "text-[#434A57] dark:text-[#f5f9fc]",
                )}
              >
                {String(day.date).padStart(2, "0")}
              </span>

              <div className="flex items-center gap-1">
                {count > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#1E62EC]/10 px-1.5 text-[9px] font-bold text-[#1E62EC] dark:bg-[#1E62EC]/20 dark:text-[#5b9aff]">
                    {count}
                  </span>
                )}
                {st === "full" && (
                  <span className="text-[9px] font-medium text-red-500/80 dark:text-red-400/70">Lotado</span>
                )}
                {st === "closed" && (
                  <span className="text-[9px] font-medium text-[#727B8E]/60 dark:text-[#8a94a6]/40">Fechado</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Time rows ── */}
      <div className="flex min-h-0 flex-col">
        {HOURS.map((hour, hourIdx) => {
          const hourStr = formatHour(hour);
          const isLast = hourIdx === HOURS.length - 1;

          return (
            <div
              key={hour}
              className="grid min-h-[60px] grid-cols-[72px_repeat(7,minmax(100px,1fr))]"
            >
              {/* Time gutter */}
              <div
                className={cn(
                  "flex items-start justify-end border-r border-[#727B8E]/10 bg-[#F4F6F9] px-3 pt-2 dark:border-[#40485A] dark:bg-[#212225]",
                  !isLast && "border-b",
                  isLast && "rounded-bl-xl",
                )}
              >
                <span className="text-[10px] font-semibold tabular-nums text-[#727B8E] dark:text-[#8a94a6]">
                  {hourStr}
                </span>
              </div>

              {/* Day cells */}
              {weekDays.map((day, dayIdx) => {
                const cellAppts =
                  cellMap.get(`${day.fullDate}|${hour}`) ?? [];
                const st = dayAvailability?.get(day.dateKey);
                const selected = selectedDay === day.date;
                const isLastCol = dayIdx === weekDays.length - 1;

                return (
                  <div
                    key={day.dateKey}
                    className={cn(
                      "flex flex-col gap-[3px] border-[#727B8E]/10 p-[3px] dark:border-[#40485A]",
                      !isLast && "border-b",
                      !isLastCol && "border-r",
                      isLast && isLastCol && "rounded-br-xl",
                      cellTone(st),
                      selected && "bg-[#1E62EC]/[0.03] dark:bg-[#1E62EC]/[0.06]",
                    )}
                  >
                    {cellAppts.map((appt) => (
                      <div
                        key={appt.id}
                        className={cn(
                          "flex items-start gap-1.5 rounded-md border-l-[3px] px-2 py-1 transition-colors",
                          STATUS_CARD[appt.status],
                        )}
                      >
                        <div
                          className={cn(
                            "mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full",
                            STATUS_DOT[appt.status],
                          )}
                        />
                        <div className="flex min-w-0 flex-col overflow-hidden">
                          <span
                            className={cn(
                              "truncate text-[11px] font-semibold leading-tight",
                              STATUS_TEXT[appt.status],
                            )}
                          >
                            {appt.name}
                          </span>
                          <span className="truncate text-[10px] leading-tight text-[#727B8E] dark:text-[#8a94a6]">
                            {appt.service}
                            {" \u00B7 "}
                            {appt.time}
                            {appt.timeEnd ? `\u2013${appt.timeEnd}` : ""}
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
