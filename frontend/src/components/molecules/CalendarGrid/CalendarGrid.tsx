import { cn } from "@/lib/cn";

/** Estado do dia para cores no calendário (vem de /appointments/available-dates → by_date) */
export type CalendarDayAvailability = "closed" | "full" | "available";

export interface CalendarEvent {
  id: string;
  petName: string;
  petInitials: string;
  type: string;
  time: string;
  /** Fim do serviço quando ocupa dois slots consecutivos (par G/GG). */
  timeEnd?: string;
  date: string;
  status: "concluido" | "confirmado" | "pendente" | "cancelado";
  /** Tutor / dono */
  clientName?: string;
  clientPhone?: string;
  /** ID do outro agendamento do par (bruto da API ou segundo slot após merge). */
  pairedAppointmentId?: string;
  /** Observações / descrição (sem marcadores internos de par). */
  notes?: string;
}

interface CalendarGridProps {
  currentDate: Date;
  events: CalendarEvent[];
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  /** @deprecated use dayAvailability */
  availableDates?: Set<string>;
  /** YYYY-MM-DD → closed (cinza), full (vermelho), available (verde) */
  dayAvailability?: Map<string, CalendarDayAvailability>;
}

export function CalendarGrid({
  currentDate,
  events,
  selectedDate,
  onSelectDate,
  availableDates,
  dayAvailability,
}: CalendarGridProps) {
  const weekDays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"];

  const getMonthDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    let startDay = firstDay.getDay() - 1;
    if (startDay < 0) startDay = 6;

    const days: { date: Date; isCurrentMonth: boolean }[] = [];

    for (let i = startDay - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      days.push({ date: d, isCurrentMonth: false });
    }

    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }

    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
      for (let i = 1; i <= remaining; i++) {
        days.push({
          date: new Date(year, month + 1, i),
          isCurrentMonth: false,
        });
      }
    }

    return days;
  };

  const days = getMonthDays();
  const weeks: { date: Date; isCurrentMonth: boolean }[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const formatDateKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const isSelected = (d: Date) =>
    selectedDate && formatDateKey(d) === formatDateKey(selectedDate);

  const isToday = (d: Date) => formatDateKey(d) === formatDateKey(new Date());

  const getEventsForDate = (d: Date) =>
    events.filter((e) => e.date === formatDateKey(d));

  const statusColor: Record<string, string> = {
    concluido: "text-[#3DCA21]",
    confirmado: "text-[#1E62EC]",
    pendente: "text-[#F59E0B]",
    cancelado: "text-[#EF4444]",
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="grid grid-cols-7 border-b border-[#727B8E]/10 dark:border-[#40485A]">
        {weekDays.map((day) => (
          <div
            key={day}
            className="py-3 text-center text-sm font-medium text-[#727B8E] dark:text-[#8a94a6]"
          >
            {day}
          </div>
        ))}
      </div>

      {weeks.map((week, wi) => (
        <div
          key={wi}
          className="grid grid-cols-7 border-b border-[#727B8E]/10 last:border-b-0"
        >
          {week.map((day, di) => {
            const dayEvents = getEventsForDate(day.date);
            const selected = isSelected(day.date);
            const dateKey = formatDateKey(day.date);
            const status: CalendarDayAvailability | undefined =
              day.isCurrentMonth && dayAvailability?.has(dateKey)
                ? dayAvailability.get(dateKey)
                : day.isCurrentMonth && availableDates != null
                  ? availableDates.has(dateKey)
                    ? "available"
                    : "closed"
                  : undefined;
            const canSelect = day.isCurrentMonth;
            const statusLabel =
              status === "full"
                ? "Dia lotado"
                : status === "closed"
                  ? "Fechado"
                  : undefined;
            const statusTitle =
              status === "full"
                ? "Dia lotado — sem vagas livres"
                : status === "closed"
                  ? "Sem expediente ou indisponível"
                  : undefined;
            return (
              <button
                key={di}
                type="button"
                onClick={() => canSelect && onSelectDate(day.date)}
                disabled={!day.isCurrentMonth}
                title={
                  status === "full"
                    ? statusTitle
                    : status === "closed"
                      ? statusTitle
                      : undefined
                }
                className={cn(
                  "min-h-[100px] p-2 text-left border-r border-[#727B8E]/10 dark:border-[#40485A] last:border-r-0 transition-colors duration-200",
                  !day.isCurrentMonth && "bg-[#F4F6F9]/50 dark:bg-[#212225]/50",
                  day.isCurrentMonth &&
                    status === "available" &&
                    "bg-emerald-50/90 hover:bg-emerald-100/90 dark:bg-emerald-950/25 dark:hover:bg-emerald-900/30 border-emerald-200/40 dark:border-emerald-800/30",
                  day.isCurrentMonth &&
                    status === "full" &&
                    "bg-red-50/90 hover:bg-red-100/80 dark:bg-red-950/25 dark:hover:bg-red-900/30 border-red-200/40 dark:border-red-900/30",
                  day.isCurrentMonth &&
                    status === "closed" &&
                    "bg-[#E8EAED] hover:bg-[#dfe2e6] dark:bg-[#2a2c30] dark:hover:bg-[#32353a] border-[#727B8E]/15",
                  day.isCurrentMonth &&
                    selected &&
                    "ring-2 ring-inset ring-[#1E62EC]/50 dark:ring-[#2172e5]/60",
                  day.isCurrentMonth && !selected && "hover:brightness-[0.98]",
                )}
              >
                <span
                  key={selected ? dateKey : undefined}
                  className={cn(
                    "inline-block text-sm font-medium",
                    selected && "animate-calendar-day-select",
                    !day.isCurrentMonth
                      ? "text-[#727B8E]/50 dark:text-[#8a94a6]/50"
                      : status === "closed"
                        ? "text-[#727B8E] dark:text-[#8a94a6]"
                        : status === "full"
                          ? "text-red-700 dark:text-red-300"
                          : isToday(day.date)
                            ? "text-emerald-800 dark:text-emerald-300 font-bold"
                            : "text-[#166534] dark:text-emerald-200",
                  )}
                >
                  {day.date.getDate() < 10
                    ? `0${day.date.getDate()}`
                    : day.date.getDate()}
                </span>
                {day.isCurrentMonth && statusLabel && (
                  <div className="mt-1">
                    <span
                      className={cn(
                        "text-[10px] font-medium",
                        status === "full"
                          ? "text-red-600/90 dark:text-red-400"
                          : "text-[#727B8E] dark:text-[#8a94a6]",
                      )}
                    >
                      {statusLabel}
                    </span>
                  </div>
                )}
                {day.isCurrentMonth && (
                  <div className="mt-1 space-y-0.5">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <div
                        key={ev.id}
                        className={`text-xs font-medium truncate ${statusColor[ev.status]}`}
                      >
                        {ev.timeEnd
                          ? `${ev.time}–${ev.timeEnd}`
                          : ev.time}{" "}
                        - {ev.petName}
                      </div>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
