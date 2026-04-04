"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Loader2, ChevronRight, ChevronDown, AlertTriangle } from "lucide-react";
import { Button } from "@/components/atoms/Button";
import { cn } from "@/lib/cn";
import { useToast } from "@/hooks";
import { settingsService, specialtyService } from "@/services";
import type { AgendaData, AgendaDay, SaveAgendaDay } from "@/services/settingsService";
import type { CapacityRule } from "@/types/petshop";

type LocalDayState = {
  day_of_week: number;
  is_closed: boolean;
  open_time: string;
  close_time: string;
  capacity_by_specialty: { specialty_id: string; max_capacity: number }[];
};

type SlotOverridesState = Record<string, Record<number, Record<string, number>>>;

type HydratedAgendaState = {
  localDays: LocalDayState[];
  slotOverrides: SlotOverridesState;
};

function applyHydratedDaysToAgendaData(data: AgendaData, hydratedDays: LocalDayState[]): AgendaData {
  return {
    ...data,
    days: data.days.map((day) => {
      const hydratedDay = hydratedDays.find((entry) => entry.day_of_week === day.day_of_week);
      if (!hydratedDay) return day;

      return {
        ...day,
        is_closed: hydratedDay.is_closed,
        open_time: hydratedDay.open_time,
        close_time: hydratedDay.close_time,
        capacity_by_specialty: day.capacity_by_specialty.map((cap) => {
          const hydratedCap = hydratedDay.capacity_by_specialty.find(
            (entry) => entry.specialty_id === cap.specialty_id,
          );
          return hydratedCap
            ? { ...cap, max_capacity: hydratedCap.max_capacity }
            : cap;
        }),
      };
    }),
  };
}

function clampCapacity(value: number): number {
  return Math.max(0, Math.min(50, value));
}

function computeSlotCount(open: string, close: string): number {
  const [oh = 8, om = 0] = open.split(":").map(Number);
  const [ch = 18, cm = 0] = close.split(":").map(Number);
  const openMin = oh * 60 + om;
  const closeMin = ch * 60 + cm;
  if (closeMin <= openMin) return 0;
  return Math.floor((closeMin - openMin) / 60);
}

function generateHourSlots(open: string, close: string): string[] {
  const [oh = 8, om = 0] = open.split(":").map(Number);
  const [ch = 18, cm = 0] = close.split(":").map(Number);
  const openMin = oh * 60 + om;
  const closeMin = ch * 60 + cm;
  if (closeMin <= openMin) return [];

  const slots: string[] = [];
  for (let minute = openMin; minute < closeMin; minute += 60) {
    const hh = String(Math.floor(minute / 60)).padStart(2, "0");
    const mm = String(minute % 60).padStart(2, "0");
    slots.push(`${hh}:${mm}`);
  }
  return slots;
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

function buildRulesMap(rules: CapacityRule[]): Map<string, CapacityRule[]> {
  const map = new Map<string, CapacityRule[]>();

  for (const rule of rules) {
    if (!rule.isActive) continue;
    const key = `${rule.specialtyId}:${rule.dayOfWeek}`;
    const list = map.get(key) ?? [];
    list.push(rule);
    map.set(key, list);
  }

  return map;
}

function getMostCommonCapacity(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;

  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let winner = fallback;
  let winnerCount = -1;
  for (const [value, count] of counts.entries()) {
    if (count > winnerCount || (count === winnerCount && value === fallback)) {
      winner = value;
      winnerCount = count;
    }
  }

  return winner;
}

function hydrateAgendaState(days: AgendaDay[], rulesBySpecialty: Map<string, CapacityRule[]>): HydratedAgendaState {
  const localDays = initLocalDays(days);
  const slotOverrides: SlotOverridesState = {};

  const hydratedDays = localDays.map((day) => {
    if (day.is_closed) return day;

    const slotTimes = generateHourSlots(day.open_time, day.close_time);
    if (slotTimes.length === 0) return day;

    return {
      ...day,
      capacity_by_specialty: day.capacity_by_specialty.map((cap) => {
        const dayRules = rulesBySpecialty.get(`${cap.specialty_id}:${day.day_of_week}`) ?? [];
        const rulesInRange = dayRules.filter((rule) => slotTimes.includes(rule.slot_time));

        if (rulesInRange.length === 0) {
          return cap;
        }

        const baseCapacity = getMostCommonCapacity(
          rulesInRange.map((rule) => rule.maxCapacity),
          cap.max_capacity,
        );

        for (const rule of rulesInRange) {
          if (rule.maxCapacity === baseCapacity) continue;
          slotOverrides[cap.specialty_id] ??= {};
          slotOverrides[cap.specialty_id]![day.day_of_week] ??= {};
          slotOverrides[cap.specialty_id]![day.day_of_week]![rule.slot_time] = rule.maxCapacity;
        }

        return {
          ...cap,
          max_capacity: baseCapacity,
        };
      }),
    };
  });

  return { localDays: hydratedDays, slotOverrides };
}

function getSpecialtyBaseCapacity(day: LocalDayState, specialtyId: string): number {
  return day.capacity_by_specialty.find((c) => c.specialty_id === specialtyId)?.max_capacity ?? 0;
}

function getSlotOverride(
  overrides: SlotOverridesState,
  specialtyId: string,
  dayOfWeek: number,
  slotTime: string,
): number | undefined {
  return overrides[specialtyId]?.[dayOfWeek]?.[slotTime];
}

function getEffectiveSlotCapacity(
  day: LocalDayState,
  specialtyId: string,
  slotTime: string,
  overrides: SlotOverridesState,
): number {
  return getSlotOverride(overrides, specialtyId, day.day_of_week, slotTime) ?? getSpecialtyBaseCapacity(day, specialtyId);
}

function hasBaseDayChanges(local: LocalDayState, original: AgendaDay): boolean {
  return (
    local.is_closed !== original.is_closed ||
    local.open_time !== original.open_time ||
    local.close_time !== original.close_time ||
    local.capacity_by_specialty.some((c) => {
      const orig = original.capacity_by_specialty.find((o) => o.specialty_id === c.specialty_id);
      return orig && orig.max_capacity !== c.max_capacity;
    })
  );
}

function hasEffectiveOverridesForDay(day: LocalDayState, overrides: SlotOverridesState): boolean {
  if (day.is_closed) return false;
  const slotTimes = generateHourSlots(day.open_time, day.close_time);
  if (slotTimes.length === 0) return false;

  return day.capacity_by_specialty.some((cap) =>
    slotTimes.some((slotTime) => {
      const override = getSlotOverride(overrides, cap.specialty_id, day.day_of_week, slotTime);
      return override !== undefined && override !== cap.max_capacity;
    }),
  );
}

function hasOverrideDifferences(
  day: LocalDayState,
  currentOverrides: SlotOverridesState,
  originalOverrides: SlotOverridesState,
): boolean {
  if (day.is_closed) {
    return Object.keys(originalOverrides).length > 0 || Object.keys(currentOverrides).length > 0;
  }

  const slotTimes = generateHourSlots(day.open_time, day.close_time);
  const specialtyIds = new Set<string>([
    ...day.capacity_by_specialty.map((cap) => cap.specialty_id),
    ...Object.keys(currentOverrides),
    ...Object.keys(originalOverrides),
  ]);

  for (const specialtyId of specialtyIds) {
    for (const slotTime of slotTimes) {
      const currentValue = currentOverrides[specialtyId]?.[day.day_of_week]?.[slotTime];
      const originalValue = originalOverrides[specialtyId]?.[day.day_of_week]?.[slotTime];
      if (currentValue !== originalValue) {
        return true;
      }
    }
  }

  return false;
}

function countOverrideDifferencesForSpecialty(
  day: LocalDayState,
  specialtyId: string,
  slotTimes: string[],
  currentOverrides: SlotOverridesState,
  originalOverrides: SlotOverridesState,
): number {
  let count = 0;

  for (const slotTime of slotTimes) {
    const currentValue = currentOverrides[specialtyId]?.[day.day_of_week]?.[slotTime];
    const originalValue = originalOverrides[specialtyId]?.[day.day_of_week]?.[slotTime];
    if (currentValue !== originalValue) {
      count++;
    }
  }

  return count;
}

function getSpecialtiesWithOverrides(localDays: LocalDayState[], overrides: SlotOverridesState): string[] {
  const specialtyIds = new Set<string>();

  for (const day of localDays) {
    if (day.is_closed) continue;
    const slotTimes = generateHourSlots(day.open_time, day.close_time);
    if (slotTimes.length === 0) continue;

    for (const cap of day.capacity_by_specialty) {
      const hasOverride = slotTimes.some((slotTime) => {
        const override = getSlotOverride(overrides, cap.specialty_id, day.day_of_week, slotTime);
        return override !== undefined && override !== cap.max_capacity;
      });

      if (hasOverride) {
        specialtyIds.add(cap.specialty_id);
      }
    }
  }

  return [...specialtyIds];
}

function buildBulkRulesForSpecialty(
  localDays: LocalDayState[],
  specialtyId: string,
  overrides: SlotOverridesState,
): Array<{ day_of_week: number; slot_time: string; max_capacity: number }> {
  return localDays.flatMap((day) => {
    if (day.is_closed) return [];

    const slotTimes = generateHourSlots(day.open_time, day.close_time);
    return slotTimes.map((slotTime) => ({
      day_of_week: day.day_of_week,
      slot_time: slotTime,
      max_capacity: getEffectiveSlotCapacity(day, specialtyId, slotTime, overrides),
    }));
  });
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
  expandedSpecialtyKey,
  slotOverrides,
  originalSlotOverrides,
  onToggleExpand,
  onToggleDay,
  onTimeChange,
  onCapacityAdjust,
  onToggleSpecialtySlots,
  onSlotCapacityAdjust,
  saving,
}: {
  local: LocalDayState;
  original: AgendaDay;
  specialties: AgendaData["specialties"];
  filterSpecialtyId: string | null;
  isExpanded: boolean;
  expandedSpecialtyKey: string | null;
  slotOverrides: SlotOverridesState;
  originalSlotOverrides: SlotOverridesState;
  onToggleExpand: () => void;
  onToggleDay: (isOpen: boolean) => void;
  onTimeChange: (field: "open_time" | "close_time", value: string) => void;
  onCapacityAdjust: (specialtyId: string, delta: number) => void;
  onToggleSpecialtySlots: (specialtyId: string) => void;
  onSlotCapacityAdjust: (specialtyId: string, slotTime: string, delta: number) => void;
  saving: boolean;
}) {
  const isOpen = !local.is_closed;
  const slotCount = isOpen ? computeSlotCount(local.open_time, local.close_time) : 0;
  const slotTimes = isOpen ? generateHourSlots(local.open_time, local.close_time) : [];

  const visibleSpecialties =
    filterSpecialtyId === null
      ? specialties
      : specialties.filter((s) => s.id === filterSpecialtyId);

  const headerBadges = visibleSpecialties
    .map((sp) => {
      const cap = local.capacity_by_specialty.find((c) => c.specialty_id === sp.id);
      const abbrev = sp.name.slice(0, 3);
      return cap ? `${abbrev}.${cap.max_capacity}` : null;
    })
    .filter(Boolean);

  const hasChanges =
    hasBaseDayChanges(local, original) ||
    hasOverrideDifferences(local, slotOverrides, originalSlotOverrides);

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
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>

        <span onClick={(e) => e.stopPropagation()}>
          <Toggle checked={isOpen} onChange={(v) => onToggleDay(v)} disabled={saving} />
        </span>

        <span
          className={cn(
            "w-20 shrink-0 text-sm font-semibold",
            isOpen ? "text-[#434A57] dark:text-[#f5f9fc]" : "text-[#727B8E] dark:text-[#8a94a6]",
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
                    filterSpecialtyId && visibleSpecialties[i]?.id === filterSpecialtyId
                      ? "bg-[#1E62EC]/15 text-[#1E62EC]"
                      : "bg-[#727B8E]/10 text-[#727B8E]",
                  )}
                >
                  {badge}
                </span>
              ))}
              {hasChanges && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                  ⚠ alterado
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {isExpanded && isOpen && (
        <div className="flex flex-col gap-4 rounded-b-xl bg-white px-4 pb-5 pt-3 dark:bg-[#1A1B1D]">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#727B8E]">
              Horário
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex items-center gap-3">
                <div>
                  <label className="mb-1 block text-[11px] text-[#727B8E]">Abre</label>
                  <input
                    type="time"
                    value={local.open_time}
                    disabled={saving}
                    onChange={(e) => onTimeChange("open_time", e.target.value)}
                    className="rounded-lg border border-[#727B8E]/20 bg-[#F4F6F9] px-2.5 py-1.5 text-sm text-[#434A57] focus:border-[#1E62EC] focus:outline-none disabled:opacity-40 dark:bg-[#212225] dark:text-[#f5f9fc]"
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
                    className="rounded-lg border border-[#727B8E]/20 bg-[#F4F6F9] px-2.5 py-1.5 text-sm text-[#434A57] focus:border-[#1E62EC] focus:outline-none disabled:opacity-40 dark:bg-[#212225] dark:text-[#f5f9fc]"
                  />
                </div>
              </div>
              <span className="text-xs text-[#727B8E]">
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
                  const maxCap = getSpecialtyBaseCapacity(local, sp.id);
                  const spColor = sp.color || "#1E62EC";
                  const specialtyKey = `${local.day_of_week}:${sp.id}`;
                  const isSpecialtyExpanded = expandedSpecialtyKey === specialtyKey;
                  const changedSlotsCount = countOverrideDifferencesForSpecialty(
                    local,
                    sp.id,
                    slotTimes,
                    slotOverrides,
                    originalSlotOverrides,
                  );

                  return (
                    <div
                      key={sp.id}
                      className="rounded-lg border border-[#727B8E]/10 bg-[#F4F6F9] dark:border-[#40485A] dark:bg-[#212225] p-3"
                    >
                      <button
                        type="button"
                        disabled={saving || slotTimes.length === 0}
                        onClick={() => onToggleSpecialtySlots(sp.id)}
                        className="flex w-full min-w-0 items-center gap-2 text-left disabled:opacity-50 mb-3"
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: spColor }}
                        />
                        <span className="text-[#727B8E]">
                          {isSpecialtyExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                          {sp.name}
                        </span>

                        {changedSlotsCount > 0 && (
                          <span className="rounded-full bg-[#1E62EC]/10 px-2 py-0.5 text-[10px] font-semibold text-[#1E62EC]">
                            {changedSlotsCount} ajuste{changedSlotsCount !== 1 ? "s" : ""}
                          </span>
                        )}
                      </button>

                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-xs text-[#727B8E]">
                          {horariosDisponiveisLabel(slotCount)} · {vagasPorHorarioLabel(maxCap)}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={saving || maxCap <= 0}
                            onClick={() => onCapacityAdjust(sp.id, -1)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#727B8E]/20 bg-white text-sm font-bold text-[#434A57] transition-colors hover:border-[#727B8E]/40 disabled:opacity-30 dark:bg-[#1A1B1D] dark:text-[#f5f9fc]"
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
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#727B8E]/20 bg-white text-sm font-bold text-[#434A57] transition-colors hover:border-[#727B8E]/40 disabled:opacity-30 dark:bg-[#1A1B1D] dark:text-[#f5f9fc]"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {isSpecialtyExpanded && slotTimes.length > 0 && (
                        <div className="border-t border-[#727B8E]/10 px-3 py-3 dark:border-[#40485A]">
                          <div className="flex flex-wrap gap-2">
                            {slotTimes.map((slotTime) => {
                              const effectiveCapacity = getEffectiveSlotCapacity(local, sp.id, slotTime, slotOverrides);
                              const isCustomized = effectiveCapacity !== maxCap;

                              return (
                                <div
                                  key={slotTime}
                                  className={cn(
                                    "flex items-center gap-2 rounded-lg border px-2.5 py-2",
                                    isCustomized
                                      ? "border-[#1E62EC]/30 bg-[#1E62EC]/8"
                                      : "border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D]",
                                  )}
                                >
                                  <span className="min-w-[44px] text-xs font-medium text-[#434A57] dark:text-[#f5f9fc]">
                                    {slotTime}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={saving || effectiveCapacity <= 0}
                                    onClick={() => onSlotCapacityAdjust(sp.id, slotTime, -1)}
                                    className="flex h-6 w-6 items-center justify-center rounded-md border border-[#727B8E]/20 bg-white text-xs font-bold text-[#434A57] disabled:opacity-30 dark:bg-[#1A1B1D] dark:text-[#f5f9fc]"
                                  >
                                    −
                                  </button>
                                  <span className="w-7 text-center text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                                    {effectiveCapacity}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={saving || effectiveCapacity >= 50}
                                    onClick={() => onSlotCapacityAdjust(sp.id, slotTime, 1)}
                                    className="flex h-6 w-6 items-center justify-center rounded-md border border-[#727B8E]/20 bg-white text-xs font-bold text-[#434A57] disabled:opacity-30 dark:bg-[#1A1B1D] dark:text-[#f5f9fc]"
                                  >
                                    +
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {isExpanded && !isOpen && (
        <div className="rounded-b-xl bg-white px-4 pb-4 pt-2 dark:bg-[#1A1B1D]">
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
  const [slotOverrides, setSlotOverrides] = useState<SlotOverridesState>({});
  const [originalSlotOverrides, setOriginalSlotOverrides] = useState<SlotOverridesState>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedDow, setExpandedDow] = useState<number | null>(null);
  const [expandedSpecialtyKey, setExpandedSpecialtyKey] = useState<string | null>(null);
  const [filterSpecialtyId, setFilterSpecialtyId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const d = await settingsService.getAgenda();
      const displaySpecialties = d.specialties.filter((specialty) => specialty.name !== "Hospedagem");
      const specialtyRules = await Promise.all(
        displaySpecialties.map(async (specialty) => ({
          specialtyId: specialty.id,
          rules: await specialtyService.listCapacityRules(specialty.id),
        })),
      );
      const rulesMap = buildRulesMap(specialtyRules.flatMap((entry) => entry.rules));
      const hydrated = hydrateAgendaState(d.days, rulesMap);
      const hydratedAgenda = applyHydratedDaysToAgendaData(d, hydrated.localDays);

      setData(hydratedAgenda);
      setLocalDays(hydrated.localDays);
      setSlotOverrides(hydrated.slotOverrides);
      setOriginalSlotOverrides(hydrated.slotOverrides);
      setExpandedSpecialtyKey(null);
      setExpandedDow(new Date().getDay());
    } catch {
      toast.error("Erro", "Não foi possível carregar a agenda.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

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
        hasBaseDayChanges(local, original) ||
        hasOverrideDifferences(local, slotOverrides, originalSlotOverrides)
      ) {
        count++;
      }
    }

    return count;
  }, [localDays, data, slotOverrides, originalSlotOverrides]);

  const toggleDay = (dow: number, isOpen: boolean) => {
    setLocalDays((prev) =>
      prev.map((d) => (d.day_of_week === dow ? { ...d, is_closed: !isOpen } : d)),
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
              ? { ...c, max_capacity: clampCapacity(c.max_capacity + delta) }
              : c,
          ),
        };
      }),
    );
  };

  const adjustSlotCapacity = (
    dayOfWeek: number,
    specialtyId: string,
    slotTime: string,
    delta: number,
  ) => {
    const day = localDays.find((entry) => entry.day_of_week === dayOfWeek);
    if (!day) return;

    const baseCapacity = getSpecialtyBaseCapacity(day, specialtyId);
    const currentCapacity = getEffectiveSlotCapacity(day, specialtyId, slotTime, slotOverrides);
    const nextCapacity = clampCapacity(currentCapacity + delta);

    setSlotOverrides((prev) => {
      const next = { ...prev };
      const specialtyOverrides = { ...(next[specialtyId] ?? {}) };
      const dayOverrides = { ...(specialtyOverrides[dayOfWeek] ?? {}) };

      if (nextCapacity === baseCapacity) {
        delete dayOverrides[slotTime];
      } else {
        dayOverrides[slotTime] = nextCapacity;
      }

      if (Object.keys(dayOverrides).length === 0) {
        delete specialtyOverrides[dayOfWeek];
      } else {
        specialtyOverrides[dayOfWeek] = dayOverrides;
      }

      if (Object.keys(specialtyOverrides).length === 0) {
        delete next[specialtyId];
      } else {
        next[specialtyId] = specialtyOverrides;
      }

      return next;
    });
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

      await settingsService.saveAgenda({ days: payload });

      const specialtiesWithOverrides = getSpecialtiesWithOverrides(localDays, slotOverrides);

      if (specialtiesWithOverrides.length > 0) {
        await Promise.all(
          specialtiesWithOverrides.map((specialtyId) =>
            specialtyService.bulkUpsertCapacityRules(
              specialtyId,
              buildBulkRulesForSpecialty(localDays, specialtyId, slotOverrides),
            ),
          ),
        );
      }

      const refreshedAgenda = await settingsService.getAgenda();
      const refreshedSpecialties = refreshedAgenda.specialties.filter(
        (specialty) => specialty.name !== "Hospedagem",
      );
      const refreshedRules = await Promise.all(
        refreshedSpecialties.map(async (specialty) => ({
          specialtyId: specialty.id,
          rules: await specialtyService.listCapacityRules(specialty.id),
        })),
      );
      const hydrated = hydrateAgendaState(
        refreshedAgenda.days,
        buildRulesMap(refreshedRules.flatMap((entry) => entry.rules)),
      );
      const hydratedAgenda = applyHydratedDaysToAgendaData(refreshedAgenda, hydrated.localDays);

      setData(hydratedAgenda);
      setLocalDays(hydrated.localDays);
      setSlotOverrides(hydrated.slotOverrides);
      setOriginalSlotOverrides(hydrated.slotOverrides);
      setExpandedSpecialtyKey(null);
      toast.success("Agenda salva!", "Agenda e exceções por horário atualizadas com sucesso.");
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
                : "border-[#727B8E]/20 bg-white text-[#727B8E] hover:border-[#727B8E]/40 dark:bg-[#1A1B1D]",
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
                    : "border-[#727B8E]/20 bg-white text-[#727B8E] hover:border-[#727B8E]/40 dark:bg-[#1A1B1D]",
                )}
                style={isActive ? { backgroundColor: spColor, borderColor: spColor } : {}}
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
              expandedSpecialtyKey={expandedSpecialtyKey}
              slotOverrides={slotOverrides}
              originalSlotOverrides={originalSlotOverrides}
              onToggleExpand={() =>
                setExpandedDow((prev) => (prev === local.day_of_week ? null : local.day_of_week))
              }
              onToggleDay={(isOpen) => toggleDay(local.day_of_week, isOpen)}
              onTimeChange={(field, value) => setTime(local.day_of_week, field, value)}
              onCapacityAdjust={(spId, delta) => adjustCapacity(local.day_of_week, spId, delta)}
              onToggleSpecialtySlots={(specialtyId) =>
                setExpandedSpecialtyKey((prev) =>
                  prev === `${local.day_of_week}:${specialtyId}`
                    ? null
                    : `${local.day_of_week}:${specialtyId}`,
                )
              }
              onSlotCapacityAdjust={(specialtyId, slotTime, delta) =>
                adjustSlotCapacity(local.day_of_week, specialtyId, slotTime, delta)
              }
              saving={saving}
            />
          );
        })}
      </div>

      <div className="sticky bottom-0 flex items-center gap-3 rounded-xl border border-[#727B8E]/10 bg-white px-4 py-3 shadow-sm dark:border-[#40485A] dark:bg-[#1A1B1D]">
        {pendingCount > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            {pendingCount} dia{pendingCount !== 1 ? "s" : ""} com alterações não salvas
          </span>
        )}
        <div className="hidden flex-1 lg:flex" />
        <Button
          onClick={handleSave}
          disabled={saving || pendingCount === 0}
          className="flex w-full items-center gap-2 lg:w-auto"
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
