import { Crown, Check, CheckCircle2 } from "lucide-react";
import type { CalendarEvent } from "../CalendarGrid";
import { cn } from "@/lib/cn";

const STAGGER_CLASSES = [
  "animation-delay-75",
  "animation-delay-150",
  "animation-delay-225",
  "animation-delay-300",
  "animation-delay-375",
  "animation-delay-450",
  "animation-delay-525",
  "animation-delay-600",
];

interface CalendarSidebarProps {
  selectedDate: Date | null;
  events: CalendarEvent[];
  onNewClick?: () => void;
  onEventClick?: (event: CalendarEvent) => void;
  onStatusChange?: (
    eventId: string,
    newStatus: "pendente" | "confirmado" | "concluido",
  ) => void;
}

export function CalendarSidebar({
  selectedDate,
  events,
  onNewClick,
  onEventClick,
  onStatusChange,
}: CalendarSidebarProps) {
  const monthNames = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];

  const formatDateKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const dayEvents = selectedDate
    ? events.filter((e) => e.date === formatDateKey(selectedDate))
    : [];

  const statusBadge: Record<string, { label: string; className: string }> = {
    concluido: {
      label: "Concluído",
      className: "border-[rgba(60,208,87,0.36)] bg-[#D4F3D6] text-[#3CD057]",
    },
    confirmado: {
      label: "Confirmado",
      className: "border-[rgba(60,107,208,0.36)] bg-[#D4E2F3] text-[#3C6BD0]",
    },
    pendente: {
      label: "Pendente",
      className: "border-[rgba(208,179,60,0.36)] bg-[#F3F2D4] text-[#D0B33C]",
    },
    cancelado: {
      label: "Cancelado",
      className: "border-[rgba(239,68,68,0.36)] bg-[#FEE2E2] text-[#EF4444]",
    },
  };

  return (
    <div className="flex min-h-0 w-full flex-shrink-0 flex-col border-t border-[#727B8E]/10 pt-4 dark:border-[#40485A] lg:w-64 lg:border-t-0 lg:pl-5 lg:pt-0">
      {selectedDate && (
        <div
          key={formatDateKey(selectedDate)}
          className="animate-slide-in-right flex min-h-0 flex-1 flex-col"
        >
          <div className="mb-4 flex shrink-0 items-center justify-between animate-fade-in">
            <div>
              <h3 className="text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                {selectedDate.getDate()} de{" "}
                {monthNames[selectedDate.getMonth()]}
              </h3>
              <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
                {dayEvents.length} agendamento
                {dayEvents.length !== 1 ? "s" : ""}
              </p>
            </div>
            <button
              onClick={onNewClick}
              className="flex items-center gap-1.5 rounded-lg border border-[#727B8E]/10 px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 dark:border-[#40485A] dark:bg-[#2172e5] bg-[#0e1629]"
            >
              <Crown className="h-3.5 w-3.5" />
              Novo
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            {dayEvents.map((event, index) => {
              const badge = statusBadge[event.status];
              const staggerClass =
                STAGGER_CLASSES[index % STAGGER_CLASSES.length];
              return (
                <div
                  key={event.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onEventClick?.(event)}
                  onKeyDown={(e) => e.key === "Enter" && onEventClick?.(event)}
                  className={cn(
                    "flex w-full cursor-pointer items-start gap-3 rounded-lg p-2 text-left transition-colors hover:bg-[#F4F6F9] dark:hover:bg-[#212225] animate-fade-in-up opacity-0",
                    staggerClass,
                  )}
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#F4F6F9] dark:bg-[#212225] text-xs font-bold text-[#727B8E] dark:text-[#8a94a6]">
                    {event.petInitials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                        {event.petName}
                      </span>
                      <span
                        className={cn(
                          "flex items-center justify-center whitespace-nowrap rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.09em]",
                          badge.className,
                        )}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
                      {event.type}
                    </p>
                    <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
                      {event.time}
                    </p>

                    {}
                    {onStatusChange && (
                      <div className="mt-2 flex gap-2">
                        {event.status === "pendente" && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onStatusChange(event.id, "confirmado");
                            }}
                            className="flex items-center gap-1 rounded-md bg-[#3C6BD0] px-2 py-1 text-[10px] font-medium text-white hover:bg-[#3C6BD0]/90 transition-colors"
                          >
                            <Check className="h-3 w-3" />
                            Confirmar
                          </button>
                        )}
                        {event.status === "confirmado" && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onStatusChange(event.id, "concluido");
                            }}
                            className="flex items-center gap-1 rounded-md bg-[#3CD057] px-2 py-1 text-[10px] font-medium text-white hover:bg-[#3CD057]/90 transition-colors"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            Concluir
                          </button>
                        )}
                        {event.status === "concluido" && (
                          <span className="flex items-center gap-1 text-[10px] text-[#3CD057]">
                            <CheckCircle2 className="h-3 w-3" />
                            Finalizado
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {dayEvents.length === 0 && (
              <p className="animate-fade-in py-8 text-center text-sm text-[#727B8E] dark:text-[#8a94a6]">
                Nenhum agendamento
              </p>
            )}
          </div>
        </div>
      )}

      {!selectedDate && (
        <p className="py-8 text-center text-sm text-[#727B8E] dark:text-[#8a94a6]">
          Selecione um dia
        </p>
      )}
    </div>
  );
}
