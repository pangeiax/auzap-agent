import { cn } from "@/lib/cn";

/** Estado do dia para cores no calendário */
export type CalendarDayAvailability = "closed" | "full" | "available";

export interface CalendarEvent {
  id: string;
  petName: string;
  petInitials: string;
  type: string;
  time: string;
  /** Fim do serviço */
  timeEnd?: string;
  date: string;
  status: "concluido" | "confirmado" | "pendente" | "cancelado";
  /** Tutor / dono */
  clientName?: string;
  clientPhone?: string;
  /** ID do outro agendamento do par */
  pairedAppointmentId?: string;
  /** Observações */
  notes?: string;
  /** Nome do profissional responsável */
  staffName?: string;
}

interface CalendarGridProps {
  currentDate: Date;
  events: CalendarEvent[];
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  /** @deprecated use dayAvailability */
  availableDates?: Set<string>;
  /** YYYY-MM-DD → closed, full, available */
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

  const statusDot: Record<string, string> = {
    concluido: "bg-emerald-400",
    confirmado: "bg-[#1E62EC]",
    pendente: "bg-amber-400",
    cancelado: "bg-red-400",
  };

  const statusText: Record<string, string> = {
    concluido: "text-emerald-600 dark:text-emerald-400",
    confirmado: "text-[#1E62EC] dark:text-[#5b9aff]",
    pendente: "text-amber-600 dark:text-amber-400",
    cancelado: "text-red-500/60 dark:text-red-400/60 line-through",
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded-xl border border-[#727B8E]/10 dark:border-[#40485A]">
      {/* Header dos dias da semana */}
      <div className="grid grid-cols-7 bg-[#F4F6F9] dark:bg-[#212225]">
        {weekDays.map((day) => (
          <div
            key={day}
            className="py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-[#727B8E] dark:text-[#8a94a6]"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Grid do calendário */}
      <div className="flex flex-1 flex-col">
        {weeks.map((week, wi) => (
          <div
            key={wi}
            className="grid flex-1 grid-cols-7 border-t border-[#727B8E]/10 dark:border-[#40485A]"
          >
            {week.map((day, di) => {
              const dayEvents = getEventsForDate(day.date);
              const selected = isSelected(day.date);
              const today = isToday(day.date);
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
              const isClosed = status === "closed";

              return (
                <button
                  key={di}
                  type="button"
                  onClick={() => canSelect && onSelectDate(day.date)}
                  disabled={!day.isCurrentMonth}
                  className={cn(
                    "relative flex min-h-[110px] flex-col border-r border-[#727B8E]/10 p-1.5 text-left transition-colors last:border-r-0 dark:border-[#40485A]",
                    !day.isCurrentMonth && "bg-[#F4F6F9]/40 dark:bg-[#1A1B1D]/60",
                    day.isCurrentMonth && !isClosed && "bg-white dark:bg-[#1A1B1D] hover:bg-[#F4F6F9]/60 dark:hover:bg-[#212225]/80",
                    day.isCurrentMonth && isClosed && "bg-[#F4F6F9]/80 dark:bg-[#212225]/60",
                    selected && "ring-2 ring-inset ring-[#1E62EC] dark:ring-[#5b9aff]",
                  )}
                >
                  {/* Número do dia */}
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                        !day.isCurrentMonth && "text-[#727B8E]/40 dark:text-[#8a94a6]/30",
                        day.isCurrentMonth && !today && !isClosed && "text-[#434A57] dark:text-[#f5f9fc]",
                        day.isCurrentMonth && isClosed && "text-[#727B8E]/70 dark:text-[#8a94a6]/50",
                        today && "bg-[#1E62EC] text-white font-bold",
                      )}
                    >
                      {day.date.getDate()}
                    </span>
                    {day.isCurrentMonth && isClosed && (
                      <span className="text-[9px] font-medium text-[#727B8E]/60 dark:text-[#8a94a6]/40">
                        Fechado
                      </span>
                    )}
                    {day.isCurrentMonth && dayEvents.length > 0 && (
                      <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#1E62EC]/10 px-1 text-[9px] font-bold text-[#1E62EC] dark:bg-[#1E62EC]/20 dark:text-[#5b9aff]">
                        {dayEvents.length}
                      </span>
                    )}
                  </div>

                  {/* Eventos do dia */}
                  {day.isCurrentMonth && (
                    <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                      {dayEvents.slice(0, 3).map((ev) => (
                        <div
                          key={ev.id}
                          className={cn(
                            "flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium leading-tight truncate",
                            ev.status === "cancelado"
                              ? "bg-red-50/60 dark:bg-red-950/20"
                              : "bg-[#1E62EC]/5 dark:bg-[#1E62EC]/10",
                          )}
                        >
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDot[ev.status])} />
                          <span className={cn("truncate", statusText[ev.status])}>
                            {ev.time} {ev.petName}
                          </span>
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="px-1 text-[9px] font-medium text-[#727B8E] dark:text-[#8a94a6]">
                          +{dayEvents.length - 3} mais
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
