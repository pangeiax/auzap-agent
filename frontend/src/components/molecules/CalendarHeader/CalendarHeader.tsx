import { Bed, ChevronLeft, ChevronRight, Crown } from "lucide-react";
import { cn } from "@/lib/cn";

export type AgendaMode = "agenda" | "hotel";

interface CalendarHeaderProps {
  currentDate: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  activeView: "month" | "week";
  onViewChange: (view: "month" | "week") => void;
  stats: { concluidos: number; confirmados: number; pendentes: number };
  agendaMode: AgendaMode;
  onAgendaModeChange: (mode: AgendaMode) => void;
  /** Estatísticas específicas do modo Hotel/Creche. Necessário quando agendaMode === "hotel". */
  lodgingStats?: { reservados: number; hospedados: number; concluidos: number };
}

export function CalendarHeader({
  currentDate,
  onPrevMonth,
  onNextMonth,
  onToday,
  activeView,
  onViewChange,
  stats,
  agendaMode,
  onAgendaModeChange,
  lodgingStats,
}: CalendarHeaderProps) {

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

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="inline-flex items-center gap-1 self-start rounded-xl border border-[#727B8E]/15 bg-[#F4F6F9] p-1 shadow-sm dark:border-[#40485A] dark:bg-[#212225]">
          <button
            type="button"
            onClick={() => onAgendaModeChange("agenda")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
              agendaMode === "agenda"
                ? "bg-[#0e1629] text-white shadow-md dark:bg-[#2172e5]"
                : "text-[#727B8E] hover:bg-white/60 hover:text-[#434A57] dark:text-[#8a94a6] dark:hover:bg-[#2a2d36] dark:hover:text-[#f5f9fc]",
            )}
          >
            <Crown className="h-4 w-4 shrink-0" />
            <span>Serviços</span>
          </button>
          <button
            type="button"
            onClick={() => onAgendaModeChange("hotel")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
              agendaMode === "hotel"
                ? "bg-[#0e1629] text-white shadow-md dark:bg-[#2172e5]"
                : "text-[#727B8E] hover:bg-white/60 hover:text-[#434A57] dark:text-[#8a94a6] dark:hover:bg-[#2a2d36] dark:hover:text-[#f5f9fc]",
            )}
          >
            <Bed className="h-4 w-4 shrink-0" />
            <span>Hotel/Creche</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <h2 className="text-base font-semibold text-[#434A57] dark:text-[#f5f9fc] sm:text-lg">
            {monthNames[currentDate.getMonth()]}, {currentDate.getFullYear()}
          </h2>
          <button
            onClick={onPrevMonth}
            className="rounded-md p-1 text-[#727B8E] hover:bg-[#F4F6F9] dark:text-[#8a94a6] dark:hover:bg-[#212225]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={onToday}
            className="rounded-md border border-[#727B8E]/10 px-3 py-1 text-sm text-[#434A57] hover:bg-[#F4F6F9] dark:border-[#40485A] dark:text-[#f5f9fc] dark:hover:bg-[#212225]"
          >
            Hoje
          </button>
          <button
            onClick={onNextMonth}
            className="rounded-md p-1 text-[#727B8E] hover:bg-[#F4F6F9] dark:text-[#8a94a6] dark:hover:bg-[#212225]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/*
          Em modo Hotel/Creche:
            - Mobile: toggle some completamente (sem ocupar linha).
            - Desktop (sm+): vira placeholder invisível pra manter o "Mês, AAAA" centralizado.
        */}
        <div
          aria-hidden={agendaMode !== "agenda"}
          className={cn(
            "items-center gap-1 rounded-xl p-1 shrink-0",
            agendaMode === "agenda"
              ? "flex"
              : "hidden sm:flex sm:invisible sm:pointer-events-none",
          )}
        >
          {(["month", "week"] as const).map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => onViewChange(view)}
              tabIndex={agendaMode === "agenda" ? 0 : -1}
              className={`flex h-9 items-center justify-center rounded-lg px-4 text-sm transition-all ${
                activeView === view
                  ? "bg-[#FFFFFF] dark:bg-[#1A1B1D] font-semibold text-[#1C1D21] dark:text-[#f5f9fc] shadow-sm dark:border dark:border-[#40485A]"
                  : "font-medium text-[#727B8E] dark:text-[#8a94a6] hover:text-[#434A57] dark:hover:text-[#f5f9fc]"
              }`}
            >
              {view === "month" ? "Mês" : "Semana"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {agendaMode === "hotel" ? (
          <>
            <span className="inline-flex items-center justify-center rounded-full border border-[rgba(60,107,208,0.36)] bg-[#D4E2F3] px-3 py-1 text-[10px] font-bold uppercase leading-4 tracking-[0.09em] text-[#3C6BD0]">
              {lodgingStats?.reservados ?? 0} reservados
            </span>
            <span className="inline-flex items-center justify-center rounded-full border border-[rgba(60,208,87,0.36)] bg-[#D4F3D6] px-3 py-1 text-[10px] font-bold uppercase leading-4 tracking-[0.09em] text-[#3CD057]">
              {lodgingStats?.hospedados ?? 0} hospedados
            </span>
            <span className="inline-flex items-center justify-center rounded-full border border-[#727B8E]/30 bg-[#F4F6F9] px-3 py-1 text-[10px] font-bold uppercase leading-4 tracking-[0.09em] text-[#727B8E] dark:border-[#40485A] dark:bg-[#212225] dark:text-[#8a94a6]">
              {lodgingStats?.concluidos ?? 0} concluídos
            </span>
          </>
        ) : (
          <>
            <span className="inline-flex items-center justify-center rounded-full border border-[rgba(60,208,87,0.36)] bg-[#D4F3D6] px-3 py-1 text-[10px] font-bold uppercase leading-4 tracking-[0.09em] text-[#3CD057]">
              {stats.concluidos} concluídos
            </span>
            <span className="inline-flex items-center justify-center rounded-full border border-[rgba(60,107,208,0.36)] bg-[#D4E2F3] px-3 py-1 text-[10px] font-bold uppercase leading-4 tracking-[0.09em] text-[#3C6BD0]">
              {stats.confirmados} confirmados
            </span>
            <span className="inline-flex items-center justify-center rounded-full border border-[rgba(208,179,60,0.36)] bg-[#F3F2D4] px-3 py-1 text-[10px] font-bold uppercase leading-4 tracking-[0.09em] text-[#D0B33C]">
              {stats.pendentes} pendentes
            </span>
          </>
        )}
        <Crown className="h-4 w-4 text-[#727B8E] dark:text-[#8a94a6]" />
      </div>
    </div>
  );
}
