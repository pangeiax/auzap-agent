import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymdToLocalDate(ymd: string): Date {
  const s = String(ymd);
  // Normaliza entradas do tipo "YYYY-MM-DD" ou "YYYY-MM-DDTHH:mm:ss..."
  const normalized = s.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (normalized) {
    const [y, m, d] = normalized.split("-").map(Number);
    const safeY = Number.isFinite(y) ? y : 1970;
    const safeM = Number.isFinite(m) ? m : 1;
    const safeD = Number.isFinite(d) ? d : 1;
    return new Date(safeY, safeM - 1, safeD, 12, 0, 0, 0);
  }

  const parsed = new Date(s);
  if (isNaN(parsed.getTime())) return new Date(1970, 0, 1, 12, 0, 0, 0);
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0, 0);
}

function formatYmdToBR(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return "—";
  return `${d}/${m}/${y}`;
}

export function MiniDatePicker({
  label,
  value,
  minYmd,
  onChange,
  disabled,
}: {
  label: string;
  value: string; // YYYY-MM-DD
  minYmd: string; // YYYY-MM-DD
  onChange: (ymd: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [viewMonth, setViewMonth] = useState<Date>(() =>
    ymdToLocalDate(value || minYmd),
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current) return;
      if (rootRef.current.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selectedDate = value ? ymdToLocalDate(value) : null;
  void selectedDate; // mantido para possíveis melhorias futuras

  const monthStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1, 12, 0, 0, 0);
  const startWeekDay = monthStart.getDay(); // 0..6 (Dom..Sáb)

  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0, 12, 0, 0, 0).getDate();

  const grid = Array.from({ length: 42 }, (_, idx) => {
    const dayNum = idx - startWeekDay + 1;
    const dt = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), dayNum, 12, 0, 0, 0);
    const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
    const ymd = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
    const isBeforeMin = ymd < minYmd;
    return { ymd, inMonth, isBeforeMin };
  });

  const monthLabel = viewMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="relative flex flex-col gap-3" ref={rootRef}>
      <p className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">{label}</p>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        className="flex h-[47px] w-full items-center justify-between rounded-lg border border-[#727B8E]/20 bg-white px-3 text-sm text-[#434A57] dark:bg-[#212225] dark:border-[#40485A] dark:text-[#f5f9fc] hover:border-[#1E62EC]/40 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="truncate">
          {value ? formatYmdToBR(value) : "Selecione..."}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-[#727B8E] transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full rounded-xl border border-[#727B8E]/15 bg-white p-3 shadow-lg dark:border-[#40485A] dark:bg-[#1A1B1D]">
          <div className="mb-2 flex items-center justify-between px-1">
            <button
              type="button"
              className="rounded-lg border border-[#727B8E]/20 px-2 py-1 text-xs text-[#727B8E] dark:border-[#40485A]"
              onClick={() =>
                setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1, 12, 0, 0, 0))
              }
            >
              ←
            </button>
            <span className="text-xs font-semibold text-[#434A57] dark:text-[#f5f9fc]">{monthLabel}</span>
            <button
              type="button"
              className="rounded-lg border border-[#727B8E]/20 px-2 py-1 text-xs text-[#727B8E] dark:border-[#40485A]"
              onClick={() =>
                setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1, 12, 0, 0, 0))
              }
            >
              →
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 px-1">
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
              <div key={d} className="text-center text-[10px] font-semibold text-[#727B8E]">
                {d}
              </div>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-7 gap-1 px-1">
            {grid.map((cell) => {
              const isSelected = value && cell.ymd === value;
              return (
                <button
                  key={cell.ymd}
                  type="button"
                  disabled={cell.isBeforeMin || !cell.inMonth}
                  onClick={() => {
                    if (cell.isBeforeMin) return;
                    onChange(cell.ymd);
                    setOpen(false);
                  }}
                  className={cn(
                    "h-8 rounded-lg border text-xs transition-colors",
                    cell.inMonth ? "border-[#727B8E]/10 bg-white dark:bg-[#212225]" : "border-transparent bg-transparent",
                    cell.isBeforeMin && "opacity-40 cursor-not-allowed",
                    isSelected
                      ? "border-[#1E62EC]/40 bg-[#1E62EC]/10 text-[#1E62EC]"
                      : !cell.isBeforeMin && cell.inMonth
                        ? "text-[#434A57] hover:border-[#1E62EC]/40 hover:bg-[#1E62EC]/5 dark:text-[#f5f9fc]"
                        : "text-[#727B8E]",
                  )}
                >
                  {Number(cell.ymd.split("-")[2])}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

