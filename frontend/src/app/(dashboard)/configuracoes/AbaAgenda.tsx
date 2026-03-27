"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Loader2, ChevronRight, ChevronDown, AlertTriangle } from "lucide-react";
import { Button } from "@/components/atoms/Button";
import { cn } from "@/lib/cn";
import { useToast } from "@/hooks";
import { settingsService } from "@/services";
import type {
  AgendaData,
  AgendaDay,
  SaveAgendaDay,
} from "@/services/settingsService";


type LocalDayState = {
  day_of_week: number;
  is_closed: boolean;
  open_time: string;
  close_time: string;
  capacity_by_specialty: { specialty_id: string; max_capacity: number }[];
};


function computeSlotCount(open: string, close: string): number {
  const [oh = 8, om = 0] = open.split(":").map(Number);
  const [ch = 18, cm = 0] = close.split(":").map(Number);
  const openMin = oh * 60 + om;
  const closeMin = ch * 60 + cm;
  if (closeMin <= openMin) return 0;
  return Math.floor((closeMin - openMin) / 60);
}

function horariosDisponiveisLabel(count: number): string {
  if (count <= 0) return "Nenhum horário disponível";
  if (count === 1) return "1 Horário disponível";
  return `${count} Horários disponíveis`;
}

function vagasPorHorarioLabel(maxCap: number): string {
  if (maxCap <= 0) return "Nenhuma vaga por horário";
  if (maxCap === 1) return "1 vaga disponível por horário";
  return `${maxCap} vagas disponíveis por horário`;
}

function initLocalDays(days: AgendaDay[]): LocalDayState[] {
  return days.map((d) => ({
    day_of_week: d.day_of_week,
    is_closed: d.is_closed,
    open_time: d.open_time,
    close_time: d.close_time,
    capacity_by_specialty: d.capacity_by_specialty.map((c) => ({
      specialty_id: c.specialty_id,
      max_capacity: c.max_capacity,
    })),
  }));
}


function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center">
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="w-10 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-5 peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-[#1E62EC] disabled:opacity-40" />
    </label>
  );
}

function DayRow({
  local,
  original,
  specialties,
  filterSpecialtyId,
  isExpanded,
  onToggleExpand,
  onToggleDay,
  onTimeChange,
  onCapacityAdjust,
  saving,
}: {
  local: LocalDayState;
  original: AgendaDay;
  specialties: AgendaData["specialties"];
  filterSpecialtyId: string | null;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggleDay: (isOpen: boolean) => void;
  onTimeChange: (field: "open_time" | "close_time", value: string) => void;
  onCapacityAdjust: (specialtyId: string, delta: number) => void;
  saving: boolean;
}) {
  const isOpen = !local.is_closed;
  const slotCount = isOpen ? computeSlotCount(local.open_time, local.close_time) : 0;

  const visibleSpecialties =
    filterSpecialtyId === null
      ? specialties
      : specialties.filter((s) => s.id === filterSpecialtyId);

  const headerBadges = visibleSpecialties.map((sp) => {
    const cap = local.capacity_by_specialty.find((c) => c.specialty_id === sp.id);
    const abbrev = sp.name.slice(0, 3);
    return cap ? `${abbrev}.${cap.max_capacity}` : null;
  }).filter(Boolean);

  const hasChanges =
    local.is_closed !== original.is_closed ||
    local.open_time !== original.open_time ||
    local.close_time !== original.close_time ||
    local.capacity_by_specialty.some((c) => {
      const orig = original.capacity_by_specialty.find((o) => o.specialty_id === c.specialty_id);
      return orig && orig.max_capacity !== c.max_capacity;
    });

  return (
    <div
      className={cn(
        "rounded-xl border transition-all",
        isExpanded
          ? "border-[#1E62EC]/25 dark:border-[#1E62EC]/30 shadow-sm"
          : "border-[#727B8E]/10 dark:border-[#40485A]",
        !isOpen && "opacity-60",
      )}
    >
      <div
        className={cn(
          "flex cursor-pointer items-center gap-3 px-4 py-3 select-none",
          isExpanded
            ? "bg-[#1E62EC]/5 dark:bg-[#1E62EC]/8 rounded-t-xl"
            : "bg-white dark:bg-[#1A1B1D] rounded-xl",
        )}
        onClick={onToggleExpand}
      >
        <span className="shrink-0 text-[#727B8E]">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>

        <span onClick={(e) => e.stopPropagation()}>
          <Toggle
            checked={isOpen}
            onChange={(v) => onToggleDay(v)}
            disabled={saving}
          />
        </span>

        <span
          className={cn(
            "w-20 shrink-0 text-sm font-semibold",
            isOpen
              ? "text-[#434A57] dark:text-[#f5f9fc]"
              : "text-[#727B8E] dark:text-[#8a94a6]",
          )}
        >
          {original.day_name}
        </span>

        {!isOpen ? (
          <span className="rounded-full bg-[#727B8E]/10 px-2.5 py-0.5 text-[10px] font-medium text-[#727B8E]">
            Fechado
          </span>
        ) : (
          <>
            <span className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
              {local.open_time} → {local.close_time}
            </span>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {headerBadges.map((badge, i) => (
                <span
                  key={i}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    filterSpecialtyId &&
                      visibleSpecialties[i]?.id === filterSpecialtyId
                      ? "bg-[#1E62EC]/15 text-[#1E62EC]"
                      : "bg-[#727B8E]/10 text-[#727B8E]",
                  )}
                >
                  {badge}
                </span>
              ))}
              {hasChanges && (
                <span className="rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                  ⚠ alterado
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {isExpanded && isOpen && (
        <div className="flex flex-col gap-4 px-4 pb-5 pt-3 bg-white dark:bg-[#1A1B1D] rounded-b-xl">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#727B8E]">
              Horário
            </p>
            <div className="flex items-center gap-3">
              <div>
                <label className="mb-1 block text-[11px] text-[#727B8E]">Abre</label>
                <input
                  type="time"
                  value={local.open_time}
                  disabled={saving}
                  onChange={(e) => onTimeChange("open_time", e.target.value)}
                  className="rounded-lg border border-[#727B8E]/20 bg-[#F4F6F9] dark:bg-[#212225] px-2.5 py-1.5 text-sm text-[#434A57] dark:text-[#f5f9fc] focus:border-[#1E62EC] focus:outline-none disabled:opacity-40"
                />
              </div>
              <span className="mt-5 text-sm text-[#727B8E]">→</span>
              <div>
                <label className="mb-1 block text-[11px] text-[#727B8E]">Fecha</label>
                <input
                  type="time"
                  value={local.close_time}
                  disabled={saving}
                  onChange={(e) => onTimeChange("close_time", e.target.value)}
                  className="rounded-lg border border-[#727B8E]/20 bg-[#F4F6F9] dark:bg-[#212225] px-2.5 py-1.5 text-sm text-[#434A57] dark:text-[#f5f9fc] focus:border-[#1E62EC] focus:outline-none disabled:opacity-40"
                />
              </div>
              <span className="mt-5 text-xs text-[#727B8E]">
                {horariosDisponiveisLabel(slotCount)}
              </span>
            </div>
          </div>

          {visibleSpecialties.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#727B8E]">
                Capacidade por especialidade
              </p>
              <div className="space-y-2">
                {visibleSpecialties.map((sp) => {
                  const cap = local.capacity_by_specialty.find(
                    (c) => c.specialty_id === sp.id,
                  );
                  const maxCap = cap?.max_capacity ?? 0;
                  const spColor = sp.color || "#1E62EC";

                  return (
                    <div
                      key={sp.id}
                      className="flex items-center gap-3 rounded-lg border border-[#727B8E]/10 dark:border-[#40485A] bg-[#F4F6F9] dark:bg-[#212225] px-3 py-2.5"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: spColor }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                        {sp.name}
                      </span>
                      <span className="shrink-0 text-xs text-[#727B8E]">
                        {horariosDisponiveisLabel(slotCount)} · {vagasPorHorarioLabel(maxCap)}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          disabled={saving || maxCap <= 0}
                          onClick={() => onCapacityAdjust(sp.id, -1)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#727B8E]/20 bg-white dark:bg-[#1A1B1D] text-sm font-bold text-[#434A57] dark:text-[#f5f9fc] hover:border-[#727B8E]/40 transition-colors disabled:opacity-30"
                        >
                          −
                        </button>
                        <span className="w-8 text-center text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                          {maxCap}
                        </span>
                        <button
                          type="button"
                          disabled={saving || maxCap >= 50}
                          onClick={() => onCapacityAdjust(sp.id, 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#727B8E]/20 bg-white dark:bg-[#1A1B1D] text-sm font-bold text-[#434A57] dark:text-[#f5f9fc] hover:border-[#727B8E]/40 transition-colors disabled:opacity-30"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}

      {isExpanded && !isOpen && (
        <div className="px-4 pb-4 pt-2 bg-white dark:bg-[#1A1B1D] rounded-b-xl">
          <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
            Este dia está fechado. Ative o toggle para configurar o horário.
          </p>
        </div>
      )}
    </div>
  );
}

export function AbaAgenda() {
  const toast = useToast();

  const [data, setData] = useState<AgendaData | null>(null);
  const [localDays, setLocalDays] = useState<LocalDayState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedDow, setExpandedDow] = useState<number | null>(null);
  const [filterSpecialtyId, setFilterSpecialtyId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const d = await settingsService.getAgenda();
      setData(d);
      setLocalDays(initLocalDays(d.days));
      const todayDow = new Date().getDay();
      setExpandedDow(todayDow);
    } catch {
      toast.error("Erro", "Não foi possível carregar a agenda.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const pendingCount = useMemo(() => {
    if (!data) return 0;
    let count = 0;
    for (const local of localDays) {
      const original = data.days.find((d) => d.day_of_week === local.day_of_week);
      if (!original) continue;
      if (
        local.is_closed !== original.is_closed ||
        local.open_time !== original.open_time ||
        local.close_time !== original.close_time ||
        local.capacity_by_specialty.some((c) => {
          const orig = original.capacity_by_specialty.find(
            (o) => o.specialty_id === c.specialty_id,
          );
          return orig && orig.max_capacity !== c.max_capacity;
        })
      ) {
        count++;
      }
    }
    return count;
  }, [localDays, data]);

  const toggleDay = (dow: number, isOpen: boolean) => {
    setLocalDays((prev) =>
      prev.map((d) =>
        d.day_of_week === dow ? { ...d, is_closed: !isOpen } : d,
      ),
    );
  };

  const setTime = (dow: number, field: "open_time" | "close_time", value: string) => {
    setLocalDays((prev) =>
      prev.map((d) => (d.day_of_week === dow ? { ...d, [field]: value } : d)),
    );
  };

  const adjustCapacity = (dow: number, specialtyId: string, delta: number) => {
    setLocalDays((prev) =>
      prev.map((d) => {
        if (d.day_of_week !== dow) return d;
        return {
          ...d,
          capacity_by_specialty: d.capacity_by_specialty.map((c) =>
            c.specialty_id === specialtyId
              ? { ...c, max_capacity: Math.max(0, Math.min(50, c.max_capacity + delta)) }
              : c,
          ),
        };
      }),
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: SaveAgendaDay[] = localDays.map((d) => ({
        day_of_week: d.day_of_week,
        is_closed: d.is_closed,
        open_time: d.open_time,
        close_time: d.close_time,
        capacity_by_specialty: d.capacity_by_specialty,
      }));
      const agenda = await settingsService.saveAgenda({ days: payload });
      setData(agenda);
      setLocalDays(initLocalDays(agenda.days));
      toast.success("Agenda salva!", "Configurações atualizadas com sucesso.");
    } catch {
      toast.error("Erro", "Não foi possível salvar a agenda.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#727B8E] dark:text-[#8a94a6]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando agenda...
      </div>
    );
  }

  if (!data) return null;

  const displaySpecialties = data.specialties.filter((s) => s.name !== "Hospedagem");

  return (
    <div className="flex flex-col gap-5 pb-8">
      {displaySpecialties.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setFilterSpecialtyId(null)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filterSpecialtyId === null
                ? "border-[#1E62EC] bg-[#1E62EC] text-white"
                : "border-[#727B8E]/20 bg-white dark:bg-[#1A1B1D] text-[#727B8E] hover:border-[#727B8E]/40",
            )}
          >
            Todas
          </button>
          {displaySpecialties.map((sp) => {
            const isActive = filterSpecialtyId === sp.id;
            const spColor = sp.color || "#1E62EC";
            return (
              <button
                key={sp.id}
                type="button"
                onClick={() => setFilterSpecialtyId(isActive ? null : sp.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  isActive
                    ? "text-white"
                    : "border-[#727B8E]/20 bg-white dark:bg-[#1A1B1D] text-[#727B8E] hover:border-[#727B8E]/40",
                )}
                style={
                  isActive
                    ? { backgroundColor: spColor, borderColor: spColor }
                    : {}
                }
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: isActive ? "rgba(255,255,255,0.8)" : spColor }}
                />
                {sp.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        {localDays.map((local) => {
          const original = data.days.find((d) => d.day_of_week === local.day_of_week);
          if (!original) return null;

          return (
            <DayRow
              key={local.day_of_week}
              local={local}
              original={original}
              specialties={displaySpecialties}
              filterSpecialtyId={filterSpecialtyId}
              isExpanded={expandedDow === local.day_of_week}
              onToggleExpand={() =>
                setExpandedDow((prev) =>
                  prev === local.day_of_week ? null : local.day_of_week,
                )
              }
              onToggleDay={(isOpen) => toggleDay(local.day_of_week, isOpen)}
              onTimeChange={(field, value) => setTime(local.day_of_week, field, value)}
              onCapacityAdjust={(spId, delta) => adjustCapacity(local.day_of_week, spId, delta)}
              saving={saving}
            />
          );
        })}
      </div>

      <div className="sticky bottom-0 flex items-center gap-3 rounded-xl border border-[#727B8E]/10 dark:border-[#40485A] bg-white dark:bg-[#1A1B1D] px-4 py-3 shadow-sm">
        {pendingCount > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            {pendingCount} dia{pendingCount !== 1 ? "s" : ""} com alterações não salvas
          </span>
        )}
        <div className="hidden lg:flex flex-1" />
        <Button
          onClick={handleSave}
          disabled={saving || pendingCount === 0}
          className="flex items-center gap-2 w-full lg:w-auto"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : (
            "Salvar agenda"
          )}
        </Button>
      </div>

    </div>
  );
}
