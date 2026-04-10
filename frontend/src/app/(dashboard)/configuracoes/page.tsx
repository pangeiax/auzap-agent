import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/cn";
import { motion } from "framer-motion";
import {
  Crown,
  Settings as SettingsIcon,
  Loader2,
  X,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Plus,
  Edit2,
  Trash2,
  Clock,
  CalendarClock,
  Mail,
  User,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { DashboardLayout } from "@/components/templates/DashboardLayout";
import {
  SettingsTabs,
  type SettingsTabId,
} from "@/components/molecules/SettingsTabs";
import { Input } from "@/components/atoms/Input";
import { TextArea } from "@/components/atoms/TextArea";
import { Button } from "@/components/atoms/Button";
import { Modal } from "@/components/molecules/Modal";
import {
  maskPhone,
  maskCardNumber,
  maskCardExpiry,
  maskCvv,
  maskCurrency,
  unmaskCurrency,
} from "@/lib/masks";
import { useAddressByCep, useToast } from "@/hooks";
import {
  petshopService,
  serviceService,
  whatsappService,
  paymentService,
  settingsService,
  specialtyService,
} from "@/services";
import {
  lodgingConfigService,
  roomTypeService,
  type LodgingConfig,
  type RoomType,
  type CreateRoomTypeData,
} from "@/services/lodgingService";
import type { AgendaDay } from "@/services/settingsService";
import { useAuthContext } from "@/contexts/AuthContext";
import { AbaAgenda } from "./AbaAgenda";
import type { Petshop } from "@/types";
import type { User as AuthUser } from "@/types/auth";
import type { Specialty } from "@/types/petshop";
import type { Service } from "@/types";
import type { CapacityRule } from "@/types/petshop";

// ─── Hourly capacity helpers ──────────────────────────────────────────────────
const DAY_CONFIGS_ORDERED = [
  { dayOfWeek: 1, label: "Seg" },
  { dayOfWeek: 2, label: "Ter" },
  { dayOfWeek: 3, label: "Qua" },
  { dayOfWeek: 4, label: "Qui" },
  { dayOfWeek: 5, label: "Sex" },
  { dayOfWeek: 6, label: "Sáb" },
  { dayOfWeek: 0, label: "Dom" },
] as const;

const BH_DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

type HourSlotConfig = { enabled: boolean; capacity: number };
type DaySlotConfig = Record<string, HourSlotConfig>;

function getDayBHInfo(
  bh: Petshop["businessHours"] | undefined,
  dayOfWeek: number,
): { isOpen: boolean; open?: string; close?: string } {
  const dayName = BH_DAY_NAMES[dayOfWeek];
  if (!bh || !dayName) return { isOpen: false };
  const entry = bh[dayName];
  if (!entry) return { isOpen: false };
  if (typeof entry === "string") {
    if (entry === "closed") return { isOpen: false };
    const [open, close] = entry.split("-");
    if (!open || !close) return { isOpen: false };
    return { isOpen: true, open, close };
  }
  if (typeof entry === "object") {
    if ((entry as any).closed) return { isOpen: false };
    const open = (entry as any).open as string | undefined;
    const close = (entry as any).close as string | undefined;
    if (open && close) return { isOpen: true, open, close };
  }
  return { isOpen: false };
}

function generateHourSlots(open: string, close: string): string[] {
  const p1 = open.split(":").map(Number);
  const p2 = close.split(":").map(Number);
  const openMin = (p1[0] ?? 8) * 60 + (p1[1] ?? 0);
  const closeMin = (p2[0] ?? 18) * 60 + (p2[1] ?? 0);
  const slots: string[] = [];
  for (let m = openMin; m < closeMin; m += 60) {
    slots.push(
      `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
    );
  }
  return slots;
}

function buildInitialSlotConfig(
  bh: Petshop["businessHours"] | undefined,
  rules: CapacityRule[],
): Record<number, DaySlotConfig> {
  const rulesMap = new Map<string, CapacityRule>();
  for (const r of rules) {
    rulesMap.set(`${r.dayOfWeek}|${r.slot_time}`, r);
  }
  const result: Record<number, DaySlotConfig> = {};
  for (const { dayOfWeek } of DAY_CONFIGS_ORDERED) {
    const bhInfo = getDayBHInfo(bh, dayOfWeek);
    if (!bhInfo.isOpen || !bhInfo.open || !bhInfo.close) {
      result[dayOfWeek] = {};
      continue;
    }
    const hours = generateHourSlots(bhInfo.open, bhInfo.close);
    const dayConfig: DaySlotConfig = {};
    for (const h of hours) {
      const rule = rulesMap.get(`${dayOfWeek}|${h}`);
      dayConfig[h] = {
        enabled: !!(rule?.isActive && (rule.maxCapacity ?? 0) > 0),
        capacity:
          rule?.maxCapacity && rule.maxCapacity > 0 ? rule.maxCapacity : 1,
      };
    }
    result[dayOfWeek] = dayConfig;
  }
  return result;
}

function slotConfigToRules(
  config: Record<number, DaySlotConfig>,
): { day_of_week: number; slot_time: string; max_capacity: number }[] {
  const rules: {
    day_of_week: number;
    slot_time: string;
    max_capacity: number;
  }[] = [];
  for (const [dow, slots] of Object.entries(config)) {
    for (const [time, slot] of Object.entries(slots)) {
      if (slot.enabled) {
        rules.push({
          day_of_week: Number(dow),
          slot_time: time,
          max_capacity: slot.capacity,
        });
      }
    }
  }
  return rules;
}

function HourlyCapacityEditor({
  businessHours,
  config,
  onChange,
  disabled,
}: {
  businessHours: Petshop["businessHours"] | undefined;
  config: Record<number, DaySlotConfig>;
  onChange: (c: Record<number, DaySlotConfig>) => void;
  disabled?: boolean;
}) {
  const [defaultCap, setDefaultCap] = useState(2);

  const updateSlot = (
    dow: number,
    time: string,
    field: keyof HourSlotConfig,
    value: boolean | number,
  ) => {
    const daySlots = config[dow] ?? {};
    onChange({
      ...config,
      [dow]: {
        ...daySlots,
        [time]: {
          ...(daySlots[time] ?? { enabled: false, capacity: 1 }),
          [field]: value,
        },
      },
    });
  };
  const toggleAllInDay = (dow: number, enabled: boolean) => {
    const daySlots = config[dow] ?? {};
    onChange({
      ...config,
      [dow]: Object.fromEntries(
        Object.entries(daySlots).map(([t, s]) => [
          t,
          { enabled, capacity: enabled ? defaultCap : s.capacity },
        ]),
      ),
    });
  };
  const applyToEnabled = () => {
    const next: Record<number, DaySlotConfig> = {};
    for (const { dayOfWeek } of DAY_CONFIGS_ORDERED) {
      const daySlots = config[dayOfWeek] ?? {};
      next[dayOfWeek] = Object.fromEntries(
        Object.entries(daySlots).map(([t, s]) => [
          t,
          { ...s, capacity: s.enabled ? defaultCap : s.capacity },
        ]),
      );
    }
    onChange(next);
  };
  const enableAllAndApply = () => {
    const next: Record<number, DaySlotConfig> = {};
    for (const { dayOfWeek } of DAY_CONFIGS_ORDERED) {
      const bhInfo = getDayBHInfo(businessHours, dayOfWeek);
      if (!bhInfo.isOpen) {
        next[dayOfWeek] = config[dayOfWeek] ?? {};
        continue;
      }
      const daySlots = config[dayOfWeek] ?? {};
      next[dayOfWeek] = Object.fromEntries(
        Object.entries(daySlots).map(([t]) => [
          t,
          { enabled: true, capacity: defaultCap },
        ]),
      );
    }
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[#727B8E]/10 dark:border-[#40485A] bg-[#F4F6F9] dark:bg-[#212225] px-4 py-3">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[#727B8E]">
            Capacidade padrão
          </p>
          <input
            type="number"
            min="1"
            max="99"
            value={defaultCap}
            disabled={disabled}
            onChange={(e) => setDefaultCap(parseInt(e.target.value) || 1)}
            className="w-16 rounded-lg border border-[#727B8E]/20 bg-white dark:bg-[#1A1B1D] px-2 py-1.5 text-sm text-center text-[#434A57] dark:text-[#f5f9fc] focus:border-[#1E62EC] focus:outline-none disabled:opacity-40"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={applyToEnabled}
            className="rounded-lg border border-[#727B8E]/20 bg-white dark:bg-[#1A1B1D] px-3 py-1.5 text-xs font-medium text-[#434A57] dark:text-[#f5f9fc] hover:border-[#727B8E]/40 transition-colors disabled:opacity-40"
          >
            Aplicar nos ativos
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={enableAllAndApply}
            className="rounded-lg border border-[#1E62EC]/25 bg-[#1E62EC]/10 px-3 py-1.5 text-xs font-medium text-[#1E62EC] hover:bg-[#1E62EC]/20 transition-colors disabled:opacity-40"
          >
            Habilitar todos
          </button>
        </div>
      </div>

      {DAY_CONFIGS_ORDERED.map(({ dayOfWeek, label }) => {
        const bhInfo = getDayBHInfo(businessHours, dayOfWeek);
        const daySlots = config[dayOfWeek] ?? {};
        const hours = Object.keys(daySlots).sort();
        const enabledCount = hours.filter((h) => daySlots[h]?.enabled).length;

        return (
          <div
            key={dayOfWeek}
            className={cn(
              "rounded-lg border border-[#727B8E]/10 dark:border-[#40485A] p-3",
              !bhInfo.isOpen && "opacity-40",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-7 shrink-0 text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                {label}
              </span>
              {!bhInfo.isOpen ? (
                <span className="text-xs text-[#727B8E]">
                  Fechado (horário comercial)
                </span>
              ) : (
                <>
                  <span className="text-xs text-[#727B8E]">
                    {bhInfo.open}–{bhInfo.close}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5">
                    {enabledCount > 0 && (
                      <span className="rounded-full bg-[#1E62EC]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#1E62EC]">
                        {enabledCount} ativo{enabledCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => toggleAllInDay(dayOfWeek, true)}
                      className="rounded px-1.5 py-0.5 text-[11px] font-medium text-[#1E62EC] hover:bg-[#1E62EC]/10 transition-colors disabled:opacity-40"
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => toggleAllInDay(dayOfWeek, false)}
                      className="rounded px-1.5 py-0.5 text-[11px] font-medium text-[#727B8E] hover:bg-[#727B8E]/10 transition-colors disabled:opacity-40"
                    >
                      Nenhum
                    </button>
                  </span>
                </>
              )}
            </div>

            {bhInfo.isOpen && hours.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {hours.map((h) => {
                  const slot = daySlots[h] ?? { enabled: false, capacity: 1 };
                  return (
                    <div
                      key={h}
                      className={cn(
                        "flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                        slot.enabled
                          ? "border-[#1E62EC]/40 bg-[#1E62EC]/10 text-[#1E62EC]"
                          : "border-[#727B8E]/15 bg-[#F4F6F9] dark:bg-[#212225] text-[#727B8E]",
                      )}
                    >
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() =>
                          updateSlot(dayOfWeek, h, "enabled", !slot.enabled)
                        }
                        className="font-medium disabled:cursor-not-allowed"
                        title={slot.enabled ? "Desativar" : "Ativar"}
                      >
                        {h}
                      </button>
                      {slot.enabled && (
                        <>
                          <span className="text-[#1E62EC]/40">|</span>
                          <input
                            type="number"
                            min="1"
                            max="99"
                            value={slot.capacity}
                            disabled={disabled}
                            onChange={(e) =>
                              updateSlot(
                                dayOfWeek,
                                h,
                                "capacity",
                                parseInt(e.target.value) || 1,
                              )
                            }
                            className="w-7 bg-transparent text-center text-xs outline-none disabled:cursor-not-allowed"
                            title="Vagas"
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function settingsEntityInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function SettingsProfileSidebar({
  petshop,
  user,
  loading,
  error,
  onNovoServico,
  showNovoServico,
  onLogout,
}: {
  petshop: Petshop | null;
  user: AuthUser | null;
  loading?: boolean;
  error?: string | null;
  onNovoServico?: () => void;
  showNovoServico: boolean;
  onLogout: () => void;
  onGenerateSlots?: () => void;
  generatingSlots?: boolean;
  generateDays?: number;
  onGenerateDaysChange?: (days: number) => void;
}) {
  const establishmentName =
    petshop?.company?.name ?? petshop?.assistantName ?? "Estabelecimento";
  const displayPhone = petshop?.phone || petshop?.ownerPhone;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-2xl border border-[#727B8E]/12 bg-gradient-to-b from-[#F4F6F9]/90 to-white p-4 shadow-sm dark:border-[#40485A] dark:from-[#25262a]/90 dark:to-[#1A1B1D]">
        {loading ? (
          <div className="flex gap-3">
            <div className="h-14 w-14 shrink-0 animate-pulse rounded-2xl bg-[#727B8E]/20" />
            <div className="flex-1 space-y-2 pt-0.5">
              <div className="h-4 w-40 animate-pulse rounded bg-[#727B8E]/20" />
              <div className="h-3 w-32 animate-pulse rounded bg-[#727B8E]/15" />
              <div className="h-3 w-48 animate-pulse rounded bg-[#727B8E]/15" />
            </div>
          </div>
        ) : error ? (
          <p className="text-sm text-amber-600 dark:text-amber-400">{error}</p>
        ) : (
          <div className="flex gap-3">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#1E62EC] to-[#1557c7] text-sm font-bold uppercase tracking-wide text-white shadow-inner shadow-black/10"
              aria-hidden
            >
              {settingsEntityInitials(establishmentName)}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#727B8E] dark:text-[#8a94a6]">
                  Estabelecimento
                </p>
                <p className="truncate text-sm font-semibold leading-snug text-[#434A57] dark:text-[#f5f9fc]">
                  {establishmentName}
                </p>
              </div>

              {displayPhone && (
                <div className="flex items-start gap-2 text-xs text-[#727B8E] dark:text-[#8a94a6]">
                  <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1E62EC]/80" />
                  <span className="min-w-0 break-all">
                    {maskPhone(displayPhone)}
                  </span>
                </div>
              )}

              {user && (
                <>
                  <div className="flex items-start gap-2 text-xs text-[#727B8E] dark:text-[#8a94a6]">
                    <User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1E62EC]/80" />
                    <span className="min-w-0">
                      <span className="font-medium text-[#434A57] dark:text-[#f5f9fc]">
                        {user.name}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-start gap-2 text-xs text-[#727B8E] dark:text-[#8a94a6]">
                    <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1E62EC]/80" />
                    <span className="min-w-0 truncate" title={user.email}>
                      {user.email}
                    </span>
                  </div>
                </>
              )}

              {petshop?.assistantName && (
                <div className="flex items-start gap-2 text-xs text-[#727B8E] dark:text-[#8a94a6]">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500/90" />
                  <span>
                    Assistente:{" "}
                    <span className="font-medium text-[#434A57] dark:text-[#f5f9fc]">
                      {petshop.assistantName}
                    </span>
                  </span>
                </div>
              )}

              {petshop?.company?.plan && (
                <span className="inline-flex rounded-full border border-[#727B8E]/15 bg-[#F4F6F9] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#727B8E] dark:border-[#40485A] dark:bg-[#212225] dark:text-[#8a94a6]">
                  Plano {petshop.company.plan}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {showNovoServico && onNovoServico && (
        <Button
          size="sm"
          className="flex w-full items-center gap-2 bg-[#0e1629] text-white hover:opacity-90"
          onClick={onNovoServico}
        >
          <Crown className="h-4 w-4" />
          Novo serviço
        </Button>
      )}

      <div className="flex-1" />

      <button
        type="button"
        onClick={onLogout}
        className="flex w-full items-center gap-2.5 rounded-lg border border-[#727B8E]/20 bg-[#F4F6F9] px-3 py-2.5 text-sm font-medium text-[#727B8E] transition-colors hover:bg-[#727B8E]/15 hover:text-[#434A57] dark:border-[#40485A] dark:bg-[#212225] dark:text-[#8a94a6] dark:hover:bg-[#40485A]"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        Sair da conta
      </button>
    </div>
  );
}

function ServicosContent({
  services,
  specialties,
  loading,
  loadingSpecialties,
  petshopId,
  petshop,
  onEditService,
  onRefresh,
  onCreateSpecialty,
  onDeleteSpecialty,
  onActivateSpecialty,
  onNewService,
  onRefreshSpecialties,
}: {
  services: Service[];
  specialties: Specialty[];
  loading?: boolean;
  loadingSpecialties?: boolean;
  petshopId: number;
  petshop: Petshop | null;
  onEditService: (service: Service) => void;
  onRefresh: () => void;
  onCreateSpecialty: (name: string, color?: string) => Promise<string>;
  onDeleteSpecialty: (id: string) => Promise<void>;
  onActivateSpecialty: (id: string) => Promise<void>;
  onNewService: (specialtyId: string) => void;
  onRefreshSpecialties: () => Promise<void>;
}) {
  const toast = useToast();
  const [selectedSpecialtyId, setSelectedSpecialtyId] = useState<string | null>(
    null,
  );
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState<Service | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deactivateSpecialtyModal, setDeactivateSpecialtyModal] =
    useState<Specialty | null>(null);
  const [deactivatingSpecialty, setDeactivatingSpecialty] = useState(false);
  const [reactivatingSpecialtyId, setReactivatingSpecialtyId] = useState<
    string | null
  >(null);

  // Specialty creation state
  const [newSpecialtyModal, setNewSpecialtyModal] = useState(false);
  const [newSpecialtyName, setNewSpecialtyName] = useState("");
  const [newSpecialtyColor, setNewSpecialtyColor] = useState("#1E62EC");
  const [creatingSpecialty, setCreatingSpecialty] = useState(false);

  // Specialty edit state
  const [editSpecialtyOpen, setEditSpecialtyOpen] = useState(false);
  const [editingSpecialtyData, setEditingSpecialtyData] =
    useState<Specialty | null>(null);
  const [spEditName, setSpEditName] = useState("");
  const [spEditColor, setSpEditColor] = useState("#1E62EC");
  const [spEditDescription, setSpEditDescription] = useState("");
  const [savingSpEdit, setSavingSpEdit] = useState(false);

  // Filter: Hospedagem is managed in its own tab
  const displaySpecialties = specialties.filter((s) => s.name !== "Hospedagem");

  // Auto-select first specialty
  const firstSpecialtyId = displaySpecialties[0]?.id ?? null;
  const effectiveSelected = selectedSpecialtyId ?? firstSpecialtyId;

  const servicesForSelected = services.filter(
    (s) => s.specialtyId === effectiveSelected,
  );

  const servicesCountBySpecialty = (spId: string) =>
    services.filter((s) => s.specialtyId === spId).length;

  const handleConfirmDelete = async () => {
    if (!serviceToDelete) return;
    setDeleting(true);
    try {
      await serviceService.deleteService(serviceToDelete.id);
      toast.success(
        "Serviço deletado!",
        `"${serviceToDelete.name}" foi removido.`,
      );
      setDeleteModalOpen(false);
      setServiceToDelete(null);
      onRefresh();
    } catch {
      toast.error("Erro", "Não foi possível deletar o serviço.");
    } finally {
      setDeleting(false);
    }
  };

  const handleToggle = async (s: Service) => {
    setTogglingId(s.id);
    try {
      await serviceService.updateService(s.id, { is_active: !s.isActive });
      toast.success(
        "Status atualizado!",
        s.isActive ? "Serviço desativado." : "Serviço ativado.",
      );
      onRefresh();
    } catch {
      toast.error("Erro", "Não foi possível alterar o status.");
    } finally {
      setTogglingId(null);
    }
  };

  const handleCreateSpecialty = async () => {
    if (!newSpecialtyName.trim()) {
      toast.warning("Campo obrigatório", "Informe o nome da especialidade.");
      return;
    }
    setCreatingSpecialty(true);
    try {
      await onCreateSpecialty(newSpecialtyName.trim(), newSpecialtyColor);
      toast.success(
        "Especialidade criada!",
        `"${newSpecialtyName}" adicionada.`,
      );
      setNewSpecialtyModal(false);
      setNewSpecialtyName("");
      setNewSpecialtyColor("#1E62EC");
    } catch (err: any) {
      toast.error(
        "Erro",
        err?.response?.data?.error || "Não foi possível criar a especialidade.",
      );
    } finally {
      setCreatingSpecialty(false);
    }
  };

  const handleConfirmDeactivateSpecialty = async () => {
    if (!deactivateSpecialtyModal) return;
    setDeactivatingSpecialty(true);
    try {
      await onDeleteSpecialty(deactivateSpecialtyModal.id);
      toast.success(
        "Especialidade desativada!",
        `"${deactivateSpecialtyModal.name}" e seus serviços foram desativados.`,
      );
      setDeactivateSpecialtyModal(null);
      if (selectedSpecialtyId === deactivateSpecialtyModal.id)
        setSelectedSpecialtyId(null);
      await onRefreshSpecialties();
    } catch {
      toast.error("Erro", "Não foi possível desativar a especialidade.");
    } finally {
      setDeactivatingSpecialty(false);
    }
  };

  const handleActivateSpecialty = async (sp: Specialty) => {
    setReactivatingSpecialtyId(sp.id);
    try {
      await onActivateSpecialty(sp.id);
      toast.success(
        "Especialidade reativada!",
        `"${sp.name}" está ativa novamente.`,
      );
    } catch {
      toast.error("Erro", "Não foi possível reativar a especialidade.");
    } finally {
      setReactivatingSpecialtyId(null);
    }
  };

  const handleOpenEditSpecialty = (sp: Specialty) => {
    setEditingSpecialtyData(sp);
    setSpEditName(sp.name);
    setSpEditColor(sp.color || "#1E62EC");
    setSpEditDescription(sp.description || "");
    setEditSpecialtyOpen(true);
  };

  const handleSaveSpecialtyEdit = async () => {
    if (!editingSpecialtyData) return;
    setSavingSpEdit(true);
    try {
      await specialtyService.update(editingSpecialtyData.id, {
        name: spEditName,
        color: spEditColor,
        description: spEditDescription || undefined,
      });
      toast.success("Especialidade salva!", "Configurações atualizadas.");
      setEditSpecialtyOpen(false);
      await onRefreshSpecialties();
    } catch (err: any) {
      toast.error(
        "Erro",
        err?.response?.data?.error || "Não foi possível salvar.",
      );
    } finally {
      setSavingSpEdit(false);
    }
  };

  return (
    <>
      <div className="lg:flex lg:flex-row min-h-0 gap-5">
        <div className="flex w-full lg:max-w-52 shrink-0 flex-col gap-1">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#727B8E] dark:text-[#8a94a6]">
              Especialidades
            </p>
          </div>

          {loadingSpecialties ? (
            <div className="flex items-center gap-2 py-4 text-sm text-[#727B8E]">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : displaySpecialties.length === 0 ? (
            <div className="flex flex-col gap-2 rounded-xl border border-dashed border-[#727B8E]/20 p-4 text-center">
              <p className="text-xs text-[#727B8E]">Nenhuma especialidade</p>
            </div>
          ) : (
            displaySpecialties.map((sp) => {
              const isSelected = sp.id === effectiveSelected;
              const spColor = sp.color || "#1E62EC";
              const count = servicesCountBySpecialty(sp.id);
              return (
                <div
                  key={sp.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-xl border px-3 py-2.5 cursor-pointer transition-all",
                    isSelected
                      ? "shadow-sm"
                      : "border-[#727B8E]/10 dark:border-[#40485A] hover:border-[#727B8E]/25 bg-white dark:bg-[#1A1B1D]",
                    !sp.isActive && "opacity-50",
                  )}
                  style={
                    isSelected
                      ? {
                          backgroundColor: `${spColor}12`,
                          borderColor: `${spColor}45`,
                        }
                      : {}
                  }
                  onClick={() => setSelectedSpecialtyId(sp.id)}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: spColor }}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm font-medium",
                    )}
                    style={{ color: isSelected ? spColor : "#434A57" }}
                  >
                    {sp.name}
                  </span>
                  {count > 0 && (
                    <span className="shrink-0 rounded-full bg-[#727B8E]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#727B8E]">
                      {count}
                    </span>
                  )}
                  <button
                    type="button"
                    title="Editar especialidade"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenEditSpecialty(sp);
                    }}
                    className="shrink-0 flex h-6 w-6 items-center justify-center rounded-lg opacity-40 hover:opacity-100 hover:bg-[#F4F6F9] dark:hover:bg-[#212225] transition-all"
                  >
                    <Edit2
                      className="h-3.5 w-3.5"
                      style={{ color: isSelected ? spColor : "#727B8E" }}
                    />
                  </button>
                  {sp.isActive ? (
                    <button
                      type="button"
                      title="Desativar especialidade"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeactivateSpecialtyModal(sp);
                      }}
                      className="shrink-0 flex h-6 w-6 items-center justify-center rounded-lg opacity-0 group-hover:opacity-40 hover:!opacity-100 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all text-red-400"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      title="Reativar especialidade"
                      disabled={reactivatingSpecialtyId === sp.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleActivateSpecialty(sp);
                      }}
                      className="shrink-0 flex h-6 w-6 items-center justify-center rounded-lg text-[#3DCA21] opacity-90 hover:opacity-100 hover:bg-[#3DCA21]/10 transition-all disabled:opacity-40"
                    >
                      {reactivatingSpecialtyId === sp.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
              );
            })
          )}

          <button
            type="button"
            onClick={() => setNewSpecialtyModal(true)}
            className="mt-1 flex items-center gap-1.5 rounded-xl border border-dashed border-[#727B8E]/20 px-3 py-2.5 text-sm text-[#727B8E] hover:border-[#1E62EC]/40 hover:text-[#1E62EC] transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Nova especialidade
          </button>
        </div>

        <div className="min-w-0 flex-1">
          {!effectiveSelected ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[#727B8E]/15 py-20 text-center">
              <CalendarClock className="h-10 w-10 text-[#727B8E]/30" />
              <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
                Selecione uma especialidade para ver seus serviços.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                {(() => {
                  const sp = displaySpecialties.find(
                    (s) => s.id === effectiveSelected,
                  );
                  const spColor = sp?.color || "#1E62EC";
                  return (
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: spColor }}
                      />
                      <p className="text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                        {sp?.name}
                      </p>
                      <span className="text-xs text-[#727B8E]">
                        {servicesForSelected.length} serviço
                        {servicesForSelected.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  );
                })()}
                <button
                  type="button"
                  onClick={() =>
                    effectiveSelected && onNewService(effectiveSelected)
                  }
                  className="flex items-center gap-1.5 rounded-lg bg-[#1E62EC] px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-[#1a55d4] transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Novo serviço
                </button>
              </div>

              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#727B8E]">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando
                  serviços...
                </div>
              ) : servicesForSelected.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[#727B8E]/15 py-16 text-center">
                  <Plus className="h-8 w-8 text-[#727B8E]/30" />
                  <p className="text-sm text-[#727B8E]">
                    Nenhum serviço nesta especialidade.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      effectiveSelected && onNewService(effectiveSelected)
                    }
                    className="flex items-center gap-1.5 rounded-lg bg-[#1E62EC] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a55d4] transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Adicionar primeiro serviço
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {servicesForSelected.map((s) => {
                    const selectedSp = displaySpecialties.find(
                      (sp) => sp.id === effectiveSelected,
                    );
                    const spColor = selectedSp?.color || "#1E62EC";
                    return (
                      <div
                        key={s.id}
                        className="group flex items-center gap-3 rounded-xl border border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] px-4 py-3 hover:border-[#727B8E]/20 transition-colors"
                      >
                        <div
                          className="h-9 w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: spColor }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                              {s.name}
                            </p>
                            <span
                              className={cn(
                                "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                                s.isActive
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                  : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
                              )}
                            >
                              {s.isActive ? "Ativo" : "Inativo"}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-[#727B8E] dark:text-[#8a94a6]">
                            {s.durationMin}min
                            {s.price
                              ? ` · R$ ${Number(s.price).toFixed(2)}`
                              : ""}
                            {s.priceBySize
                              ? ` · P:${s.priceBySize.small ?? "—"} M:${s.priceBySize.medium ?? "—"} G:${s.priceBySize.large ?? "—"} GG:${s.priceBySize.xlarge ?? "—"}`
                              : ""}
                            {s.durationMultiplierLarge === 2
                              ? " · 2× G/GG"
                              : ""}
                            {s.description ? ` · ${s.description}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => onEditService(s)}
                            title="Editar serviço"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#727B8E] hover:bg-[#F4F6F9] dark:hover:bg-[#212225] hover:text-[#1E62EC] transition-colors"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={togglingId === s.id}
                            onClick={() => handleToggle(s)}
                            title={s.isActive ? "Desativar" : "Ativar"}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#727B8E] hover:bg-[#F4F6F9] dark:hover:bg-[#212225] transition-colors disabled:opacity-40"
                          >
                            {togglingId === s.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Clock className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setServiceToDelete(s);
                              setDeleteModalOpen(true);
                            }}
                            title="Excluir serviço"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Modal
        isOpen={newSpecialtyModal}
        onClose={() => {
          setNewSpecialtyModal(false);
          setNewSpecialtyName("");
        }}
        title="Nova especialidade"
        className="max-w-[560px]"
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Nome"
              placeholder="Ex: Estética, Veterinária..."
              value={newSpecialtyName}
              onChange={(e) => setNewSpecialtyName(e.target.value)}
            />
            <div>
              <label className="mb-1 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                Cor
              </label>
              <input
                type="color"
                value={newSpecialtyColor}
                onChange={(e) => setNewSpecialtyColor(e.target.value)}
                className="h-10 w-20 cursor-pointer rounded border border-[#727B8E]/20"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setNewSpecialtyModal(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCreateSpecialty}
              disabled={creatingSpecialty}
            >
              {creatingSpecialty ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Criando...
                </>
              ) : (
                "Criar"
              )}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!deactivateSpecialtyModal}
        onClose={() => setDeactivateSpecialtyModal(null)}
        title="Desativar especialidade"
        className="max-w-[420px]"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
            Desativar a especialidade{" "}
            <span className="font-semibold text-[#434A57] dark:text-[#f5f9fc]">
              &quot;{deactivateSpecialtyModal?.name}&quot;
            </span>{" "}
            irá desativar{" "}
            <span className="font-semibold text-[#434A57] dark:text-[#f5f9fc]">
              {deactivateSpecialtyModal
                ? servicesCountBySpecialty(deactivateSpecialtyModal.id)
                : 0}{" "}
              serviço(s)
            </span>{" "}
            vinculado(s). Deseja continuar?
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setDeactivateSpecialtyModal(null)}
              disabled={deactivatingSpecialty}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmDeactivateSpecialty}
              disabled={deactivatingSpecialty}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deactivatingSpecialty ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Desativando...
                </>
              ) : (
                "Sim, desativar"
              )}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setServiceToDelete(null);
        }}
        title="Confirmar exclusão"
        className="max-w-[400px]"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
            Tem certeza que deseja deletar o serviço{" "}
            <span className="font-semibold text-[#434A57] dark:text-[#f5f9fc]">
              &quot;{serviceToDelete?.name}&quot;
            </span>
            ? Esta ação não pode ser desfeita.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDeleteModalOpen(false);
                setServiceToDelete(null);
              }}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Deletando...
                </>
              ) : (
                "Sim, deletar"
              )}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={editSpecialtyOpen}
        onClose={() => setEditSpecialtyOpen(false)}
        title={`Editar especialidade${editingSpecialtyData ? `: ${editingSpecialtyData.name}` : ""}`}
        className="max-w-[560px]"
      >
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <Input
            label="Nome"
            value={spEditName}
            onChange={(e) => setSpEditName(e.target.value)}
            placeholder="Nome da especialidade"
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
              Cor
            </label>
            <input
              type="color"
              value={spEditColor}
              onChange={(e) => setSpEditColor(e.target.value)}
              className="h-10 w-20 cursor-pointer rounded border border-[#727B8E]/20"
            />
          </div>
          <Input
            label="Descrição (opcional)"
            value={spEditDescription}
            onChange={(e) => setSpEditDescription(e.target.value)}
            placeholder="Descrição da especialidade"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setEditSpecialtyOpen(false)}
              disabled={savingSpEdit}
            >
              Cancelar
            </Button>
            <Button onClick={handleSaveSpecialtyEdit} disabled={savingSpEdit}>
              {savingSpEdit ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Salvando...
                </>
              ) : (
                "Salvar"
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function EmpresaContent({
  petshop,
  loading,
  onSave,
}: {
  petshop: Petshop | null;
  loading?: boolean;
  onSave: (data: {
    name?: string;
    phone?: string;
    address?: string;
    cep?: string;
    owner_phone?: string;
    emergency_contact?: string;
  }) => Promise<void>;
}) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [saving, setSaving] = useState(false);
  const {
    address,
    setField,
    handleCepChange,
    cepLoading,
    cepError,
    isFieldDisabled,
    setAddress,
  } = useAddressByCep();

  useEffect(() => {
    if (!petshop) return;
    setNome(petshop.company?.name || "");
    setTelefone(petshop.phone || "");
    // Unmask stored phone to local display format: "5511963482461" → "(11) 96348-2461"
    const normalizePhone = (raw: string) => {
      const digits = raw.replace(/\D/g, "");
      const local =
        digits.length === 13 && digits.startsWith("55")
          ? digits.slice(2)
          : digits;
      return maskPhone(local);
    };
    setOwnerPhone(normalizePhone(petshop.ownerPhone || ""));
    setEmergencyContact(normalizePhone(petshop.emergencyContact || ""));
    setAddress({
      cep: petshop.cep || "",
      rua: petshop.address || "",
      numero: "",
      complemento: "",
      bairro: "",
      cidade: "",
      uf: "",
    });
  }, [petshop]);

  const handleSubmit = async () => {
    setSaving(true);
    // Unmask phone to "5511963482461" format before saving
    const toE164 = (masked: string) => {
      const digits = masked.replace(/\D/g, "");
      if (!digits) return undefined;
      return digits.startsWith("55") ? digits : "55" + digits;
    };
    try {
      await onSave({
        name: nome || undefined,
        phone: telefone,
        address: address.rua || undefined,
        cep: address.cep || undefined,
        owner_phone: toE164(ownerPhone),
        emergency_contact: toE164(emergencyContact),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#727B8E] dark:text-[#8a94a6]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-8">
      <section>
        <h3 className="mb-4 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
          Informações da empresa
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Nome da empresa"
            placeholder="Nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
          <Input
            label="Telefone"
            placeholder="(11) 99999-9999"
            value={telefone}
            onChange={(e) => setTelefone(maskPhone(e.target.value))}
          />
          <Input
            label="Telefone do responsável"
            placeholder="(11) 99999-9999"
            value={ownerPhone}
            onChange={(e) => setOwnerPhone(maskPhone(e.target.value))}
          />
          <Input
            label="Contato de emergência"
            placeholder="(11) 99999-9999"
            value={emergencyContact}
            onChange={(e) => setEmergencyContact(maskPhone(e.target.value))}
          />
          <div className="sm:col-span-2">
            <Input
              label="Suporte Auzap"
              value={petshop?.company?.pangeiaSupport ?? ""}
              disabled
              className="bg-gray-100 dark:bg-[#2a2b2d]"
            />
            <p className="mt-1 text-xs text-[#727B8E] dark:text-[#8a94a6]">
              Número de suporte configurado pela Auzap. Não editável.
            </p>
          </div>
        </div>
      </section>
      <section>
        <h3 className="mb-4 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
          Endereço
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="relative sm:col-span-2">
            <Input
              label="CEP"
              placeholder="00000-000"
              value={address.cep}
              onChange={handleCepChange}
            />
            {cepLoading && (
              <div className="absolute right-3 top-9">
                <Loader2 className="h-4 w-4 animate-spin text-[#1E62EC]" />
              </div>
            )}
            {cepError && (
              <p className="mt-1 text-xs text-red-500">{cepError}</p>
            )}
          </div>
          <Input
            label="Endereço (Rua)"
            placeholder="Logradouro"
            value={address.rua}
            onChange={(e) => setField("rua", e.target.value)}
            disabled={isFieldDisabled("rua")}
          />
          <Input
            label="Cidade"
            placeholder="Cidade"
            value={address.cidade}
            onChange={(e) => setField("cidade", e.target.value)}
            disabled={isFieldDisabled("cidade")}
          />
          <Input
            label="Número"
            placeholder="Nº"
            value={address.numero}
            onChange={(e) => setField("numero", e.target.value)}
          />
          <Input
            label="Complemento"
            placeholder="Apto, sala..."
            value={address.complemento}
            onChange={(e) => setField("complemento", e.target.value)}
            disabled={isFieldDisabled("complemento")}
          />
          <Input
            label="Bairro"
            placeholder="Bairro"
            value={address.bairro}
            onChange={(e) => setField("bairro", e.target.value)}
            disabled={isFieldDisabled("bairro")}
          />
          <Input
            label="Estado (UF)"
            placeholder="UF"
            value={address.uf}
            onChange={(e) =>
              setField("uf", e.target.value.toUpperCase().slice(0, 2))
            }
            disabled={isFieldDisabled("uf")}
          />
        </div>
      </section>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" disabled={saving}>
          Cancelar
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : (
            "Salvar"
          )}
        </Button>
      </div>
    </div>
  );
}

function WhatsAppContent({
  status,
  loading,
}: {
  status: {
    status: string;
    phone?: string;
    last_connected?: string;
    error_message?: string;
  } | null;
  loading?: boolean;
}) {
  const toast = useToast();
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "qr" | "connecting" | "connected"
  >("disconnected");
  const [qrCode, setQrCode] = useState("");
  const [connectedPhone, setConnectedPhone] = useState("");
  const [lastConnected, setLastConnected] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const statusCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Verificar status inicial e polling
  useEffect(() => {
    checkConnectionStatus();

    // Poll status a cada 2 segundos quando em modo QR ou connecting
    if (connectionStatus === "qr" || connectionStatus === "connecting") {
      statusCheckIntervalRef.current = setInterval(checkConnectionStatus, 2000);
    }

    return () => {
      if (statusCheckIntervalRef.current) {
        clearInterval(statusCheckIntervalRef.current);
      }
    };
  }, [connectionStatus]);

  const checkConnectionStatus = async () => {
    try {
      const data = await whatsappService.getStatus();

      if (data.status === "connected") {
        setConnectionStatus("connected");
        setConnectedPhone(data.phone || "WhatsApp Conectado");
        setLastConnected((data as any).last_connected ?? null);
        setQrCode("");
        if (statusCheckIntervalRef.current) {
          clearInterval(statusCheckIntervalRef.current);
        }
      } else {
        setLastConnected((data as any).last_connected ?? null);
      }
    } catch (error) {
      console.error("Erro ao verificar status:", error);
    }
  };

  const handleGenerateQR = async () => {
    setIsGenerating(true);
    setConnectionStatus("connecting");

    try {
      const data = await whatsappService.getQRCode();

      if (data.qr) {
        setQrCode(data.qr);
        setConnectionStatus("qr");
        toast.success(
          "QR Code gerado!",
          "Escaneie com seu WhatsApp para conectar.",
        );
      } else {
        throw new Error("QR Code não disponível");
      }
    } catch (error) {
      toast.error("Erro ao gerar QR Code", "Tente novamente.");
      setConnectionStatus("disconnected");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await whatsappService.logout();
      setConnectionStatus("disconnected");
      setQrCode("");
      setConnectedPhone("");
      toast.info(
        "WhatsApp desconectado",
        "Você pode reconectar a qualquer momento.",
      );
    } catch (error) {
      toast.error("Erro ao desconectar", "Tente novamente.");
    }
  };

  const handleRefreshQR = () => {
    handleGenerateQR();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#727B8E] dark:text-[#8a94a6]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-8">
      <section>
        <h3 className="mb-4 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
          Conexão com WhatsApp
        </h3>
        <p className="mb-6 text-sm text-[#727B8E] dark:text-[#8a94a6]">
          Conecte seu WhatsApp para receber notificações e enviar mensagens
          automaticamente para seus clientes.
        </p>

        <div className="mb-6 rounded-lg border border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {connectionStatus === "connected" ? (
                <>
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-950/30">
                    <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                      WhatsApp Conectado
                    </p>
                    <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
                      {connectedPhone}
                    </p>
                  </div>
                </>
              ) : connectionStatus === "connecting" ? (
                <>
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950/30">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                      Conectando...
                    </p>
                    <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
                      Aguarde enquanto estabelecemos a conexão
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/30">
                    <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                      WhatsApp Desconectado
                    </p>
                    <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
                      {lastConnected
                        ? `Última conexão: ${new Date(lastConnected).toLocaleString("pt-BR")}`
                        : "Conecte seu WhatsApp para começar"}
                    </p>
                  </div>
                </>
              )}
            </div>

            {connectionStatus === "connected" && (
              <Button variant="outline" size="sm" onClick={handleDisconnect}>
                Desconectar
              </Button>
            )}
          </div>
        </div>

        {connectionStatus === "disconnected" && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-[#727B8E]/10 bg-[#F4F6F9] dark:border-[#40485A] dark:bg-[#212225] p-8">
            <Smartphone className="mb-4 h-16 w-16 text-[#727B8E] dark:text-[#8a94a6]" />
            <h4 className="mb-2 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
              Conecte seu WhatsApp
            </h4>
            <p className="mb-6 text-center text-sm text-[#727B8E] dark:text-[#8a94a6]">
              Gere um QR Code para conectar sua conta do WhatsApp Business ou
              pessoal
            </p>
            <Button onClick={handleGenerateQR} disabled={isGenerating}>
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Gerando QR Code...
                </>
              ) : (
                "Gerar QR Code"
              )}
            </Button>
          </div>
        )}

        {connectionStatus === "qr" && qrCode && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-[#1E62EC]/20 bg-white dark:border-[#1E62EC]/30 dark:bg-[#1A1B1D] p-8">
            <h4 className="mb-4 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
              Escaneie o QR Code
            </h4>

            <div className="mb-6 rounded-lg bg-white p-4 shadow-lg">
              <img src={qrCode} alt="QR Code WhatsApp" className="h-64 w-64" />
            </div>

            <div className="mb-6 max-w-md space-y-3 text-sm text-[#727B8E] dark:text-[#8a94a6]">
              <div className="flex items-start gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1E62EC]/10 text-xs font-semibold text-[#1E62EC]">
                  1
                </span>
                <p>Abra o WhatsApp no seu celular</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1E62EC]/10 text-xs font-semibold text-[#1E62EC]">
                  2
                </span>
                <p>
                  Toque em <strong>Mais opções</strong> (⋮) &gt;{" "}
                  <strong>Aparelhos conectados</strong>
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1E62EC]/10 text-xs font-semibold text-[#1E62EC]">
                  3
                </span>
                <p>
                  Toque em <strong>Conectar um aparelho</strong> e aponte seu
                  celular para esta tela para escanear o código
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setConnectionStatus("disconnected")}
              >
                Cancelar
              </Button>
              <Button variant="outline" onClick={handleRefreshQR}>
                <RefreshCw className="h-4 w-4" />
                Atualizar QR Code
              </Button>
            </div>
          </div>
        )}

        {connectionStatus === "connecting" && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-[#1E62EC]/20 bg-white dark:border-[#1E62EC]/30 dark:bg-[#1A1B1D] p-8">
            <Loader2 className="mb-4 h-16 w-16 animate-spin text-[#1E62EC]" />
            <h4 className="mb-2 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
              Conectando...
            </h4>
            <p className="text-center text-sm text-[#727B8E] dark:text-[#8a94a6]">
              Estamos estabelecendo a conexão com seu WhatsApp
            </p>
          </div>
        )}
      </section>

      {connectionStatus === "connected" && (
        <section>
          <h3 className="mb-4 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
            Configurações de Mensagens
          </h3>
          <div className="space-y-4">
            {/* <div className="rounded-lg border border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                    Notificações de Novos Agendamentos
                  </p>
                  <p className="mt-1 text-xs text-[#727B8E] dark:text-[#8a94a6]">
                    Receba uma mensagem quando um novo agendamento for feito
                  </p>
                </div>
                <input
                  type="checkbox"
                  defaultChecked
                  className="h-5 w-5 rounded border-[#727B8E]/30 text-[#1E62EC] focus:ring-2 focus:ring-[#1E62EC]/20"
                />
              </div>
            </div> */}

            {/* <div className="rounded-lg border border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                    Lembrete para Clientes
                  </p>
                  <p className="mt-1 text-xs text-[#727B8E] dark:text-[#8a94a6]">
                    Enviar lembrete automático 1 dia antes do agendamento
                  </p>
                </div>
                <input
                  type="checkbox"
                  defaultChecked
                  className="h-5 w-5 rounded border-[#727B8E]/30 text-[#1E62EC] focus:ring-2 focus:ring-[#1E62EC]/20"
                />
              </div>
            </div> */}

            {/* <div className="rounded-lg border border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                    Confirmação de Agendamento
                  </p>
                  <p className="mt-1 text-xs text-[#727B8E] dark:text-[#8a94a6]">
                    Enviar confirmação imediata após agendamento
                  </p>
                </div>
                <input
                  type="checkbox"
                  defaultChecked
                  className="h-5 w-5 rounded border-[#727B8E]/30 text-[#1E62EC] focus:ring-2 focus:ring-[#1E62EC]/20"
                />
              </div>
            </div> */}
          </div>
        </section>
      )}
    </div>
  );
}

function PagamentoContent({
  stats,
  loading,
}: {
  stats: {
    total_revenue?: number;
    total_payments?: number;
    average_ticket?: number;
  } | null;
  loading?: boolean;
}) {
  const [cardNumber, setCardNumber] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  return (
    <div className="flex flex-col gap-6">
      <h3 className="text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
        Assinatura & Pagamento
      </h3>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#727B8E] dark:text-[#8a94a6]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando...
        </div>
      ) : stats ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 justify-between rounded-lg border border-[#727b8e19] bg-[#1e62ec38] p-4 text-[#1E62EC]">
            <div>
              <p className="flex items-center gap-2 text-sm">
                <span className="font-medium">Resumo</span>
              </p>
              <p className="mt-1 text-sm">
                Receita total: R$ {Number(stats.total_revenue ?? 0).toFixed(2)}{" "}
                • {stats.total_payments ?? 0} pagamentos
              </p>
            </div>
            <p className="text-lg font-semibold">
              Ticket médio: R$ {Number(stats.average_ticket ?? 0).toFixed(2)}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 justify-between rounded-lg border border-[#727b8e19] bg-[#1e62ec38] p-4 text-[#1E62EC]">
          <div>
            <p className="font-medium text-sm">Plano Profissional: Ativo</p>
            <p className="mt-1 text-sm">
              Próxima cobrança: 15 de Fevereiro de 2026
            </p>
          </div>
          <p className="text-lg font-semibold">R$ 99</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Número do Cartão"
          placeholder="0000 0000 0000 0000"
          value={cardNumber}
          onChange={(e) => setCardNumber(maskCardNumber(e.target.value))}
          maxLength={19}
        />
        <Input
          label="Nome do Cartão"
          placeholder="Nome no cartão"
          value={cardName}
          onChange={(e) => setCardName(e.target.value)}
        />
        <Input
          label="Validade"
          placeholder="MM/AA"
          value={cardExpiry}
          onChange={(e) => setCardExpiry(maskCardExpiry(e.target.value))}
          maxLength={5}
        />
        <Input
          label="CVV"
          placeholder="***"
          type="password"
          value={cardCvv}
          onChange={(e) => setCardCvv(maskCvv(e.target.value))}
          maxLength={4}
          inputMode="numeric"
        />
      </div>
      <p className="text-xs text-[#000]/50 dark:text-[#8a94a6]/70">
        Seus dados estão protegidos com criptografia de ponta a ponta
      </p>
      <div className="flex justify-end gap-3">
        <Button variant="outline">Cancelar</Button>
        <Button>Salvar</Button>
      </div>
    </div>
  );
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

function IAPlaygroundContent() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "Olá! Sou a IA do seu petshop. Como posso ajudar você hoje? Você pode me perguntar sobre agendamentos, serviços, preços ou qualquer dúvida que seus clientes possam ter.",
      timestamp: new Date(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  const scrollToBottom = (instant?: boolean) => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: instant ? "instant" : "smooth",
      });
    }
  };

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: inputMessage.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    setIsLoading(true);

    setTimeout(
      () => {
        const responses = [
          "Entendi! Posso ajudar você com isso. Para agendar um serviço, basta informar o nome do pet, o tipo de serviço desejado e a data/horário de preferência.",
          "Nosso petshop oferece diversos serviços como banho, tosa, consultas veterinárias e hospedagem. Qual serviço você gostaria de conhecer melhor?",
          "Claro! Os preços variam de acordo com o porte do animal e o tipo de serviço. Posso te passar uma tabela detalhada se quiser.",
          "Para remarcar um agendamento, preciso do nome do pet e da data atual do agendamento. Com essas informações, consigo verificar a disponibilidade de novos horários.",
          "Temos horários disponíveis durante toda a semana, das 8h às 18h. Qual dia seria melhor para você?",
        ];

        const aiMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: responses[Math.floor(Math.random() * responses.length)],
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, aiMessage]);
        setIsLoading(false);
      },
      1000 + Math.random() * 1000,
    );
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearChat = () => {
    setMessages([
      {
        id: "1",
        role: "assistant",
        content:
          "Olá! Sou a IA do seu petshop. Como posso ajudar você hoje? Você pode me perguntar sobre agendamentos, serviços, preços ou qualquer dúvida que seus clientes possam ter.",
        timestamp: new Date(),
      },
    ]);
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-[#727B8E]/10 bg-[#F4F6F9] dark:border-[#40485A] dark:bg-[#212225]">
      {}
      <div className="flex items-center justify-between border-b border-[#727B8E]/10 px-4 py-3 dark:border-[#40485A]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1E62EC] text-white">
            <Crown className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
              IA Playground
            </h3>
            <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
              Teste as respostas da sua IA
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleClearChat}>
          Limpar chat
        </Button>
      </div>

      {}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                message.role === "user"
                  ? "bg-[#1E62EC] text-white rounded-br-md"
                  : "bg-white dark:bg-[#1A1B1D] text-[#434A57] dark:text-[#f5f9fc] rounded-bl-md shadow-sm"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              <p
                className={`mt-1 text-[10px] ${
                  message.role === "user"
                    ? "text-white/70"
                    : "text-[#727B8E] dark:text-[#8a94a6]"
                }`}
              >
                {message.timestamp.toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-white dark:bg-[#1A1B1D] px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-[#1E62EC]" />
                <span className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
                  Digitando...
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {}
      <div className="border-t border-[#727B8E]/10 p-4 dark:border-[#40485A]">
        <div className="flex gap-2">
          <Input
            placeholder="Digite sua mensagem..."
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={handleKeyPress}
            className="flex-1"
          />
          <Button
            onClick={handleSendMessage}
            disabled={!inputMessage.trim() || isLoading}
            className="shrink-0"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Enviar"
            )}
          </Button>
        </div>
        <p className="mt-2 text-xs text-[#727B8E] dark:text-[#8a94a6]">
          Este é um ambiente de teste. As respostas simulam como a IA responderá
          aos seus clientes.
        </p>
      </div>
    </div>
  );
}

// ─── Hospedagem ──────────────────────────────────────────────────────────────
const LODGING_DAY_NAMES = [
  { dayOfWeek: 1, key: "monday", label: "Segunda-feira" },
  { dayOfWeek: 2, key: "tuesday", label: "Terça-feira" },
  { dayOfWeek: 3, key: "wednesday", label: "Quarta-feira" },
  { dayOfWeek: 4, key: "thursday", label: "Quinta-feira" },
  { dayOfWeek: 5, key: "friday", label: "Sexta-feira" },
  { dayOfWeek: 6, key: "saturday", label: "Sábado" },
  { dayOfWeek: 0, key: "sunday", label: "Domingo" },
] as const;

/** Dias fechados vêm da aba Agenda (`petshop_business_hours`). */
function isLodgingDayClosedFromAgenda(
  agendaDays: AgendaDay[] | null,
  dayOfWeek: number,
): boolean {
  if (!agendaDays || agendaDays.length === 0) return true;
  const row = agendaDays.find((d) => d.day_of_week === dayOfWeek);
  if (!row) return true;
  return row.is_closed;
}

const EMPTY_ROOM_TYPE_FORM: CreateRoomTypeData & { description: string } = {
  lodging_type: "hotel",
  name: "",
  description: "",
  capacity: 1,
  daily_rate: 0,
};

// ─── Subcomponente: lista de tipos de quarto por lodging_type ────────────────
function RoomTypeSection({
  lodgingType,
  roomTypes,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
  deletingId,
}: {
  lodgingType: "hotel" | "daycare";
  roomTypes: RoomType[];
  onAdd: () => void;
  onEdit: (rt: RoomType) => void;
  onToggle: (rt: RoomType) => void;
  onDelete: (rt: RoomType) => void;
  deletingId: string | null;
}) {
  const label = lodgingType === "hotel" ? "Hotel" : "Creche";
  const totalCapacity = roomTypes
    .filter((r) => r.is_active)
    .reduce((s, r) => s + r.capacity, 0);

  return (
    <div className="rounded-lg border border-[#727B8E]/10 dark:border-[#40485A] bg-[#F4F6F9] dark:bg-[#212225] p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-[#434A57] dark:text-[#f5f9fc]">
            Tipos de Quarto — {label}
          </p>
          {roomTypes.length > 0 && (
            <p className="text-[10px] text-[#727B8E] mt-0.5">
              Capacidade total ativa: <strong>{totalCapacity}</strong> vaga
              {totalCapacity !== 1 ? "s" : ""} · substitui o campo "Vagas por
              dia" para {label}.
            </p>
          )}
          {roomTypes.length === 0 && (
            <p className="text-[10px] text-[#727B8E] mt-0.5">
              Sem tipos configurados — usa a capacidade da tabela "Vagas por
              dia".
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 rounded-lg border border-[#1E62EC]/25 bg-[#1E62EC]/10 px-3 py-1.5 text-xs font-medium text-[#1E62EC] hover:bg-[#1E62EC]/20 transition-colors"
        >
          <Plus className="h-3 w-3" />
          Adicionar
        </button>
      </div>

      {roomTypes.length > 0 && (
        <div className="flex flex-col gap-2">
          {roomTypes.map((rt) => (
            <div
              key={rt.id}
              className={cn(
                "flex items-center justify-between rounded-lg border bg-white dark:bg-[#1A1B1D] px-3 py-2.5",
                rt.is_active
                  ? "border-[#727B8E]/10 dark:border-[#40485A]"
                  : "border-[#727B8E]/10 dark:border-[#40485A] opacity-50",
              )}
            >
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc] truncate">
                    {rt.name}
                  </span>
                  {!rt.is_active && (
                    <span className="rounded-full bg-[#727B8E]/10 px-1.5 py-0.5 text-[10px] text-[#727B8E]">
                      Inativo
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-[#727B8E]">
                    {rt.capacity} vaga{rt.capacity !== 1 ? "s" : ""}
                  </span>
                  <span className="text-xs font-semibold text-[#1E62EC]">
                    R$ {rt.daily_rate.toFixed(2)}/dia
                  </span>
                  {rt.description && (
                    <span
                      className="text-xs text-[#727B8E] truncate max-w-[160px]"
                      title={rt.description}
                    >
                      {rt.description}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-2">
                <button
                  type="button"
                  onClick={() => onToggle(rt)}
                  title={rt.is_active ? "Desativar" : "Ativar"}
                  className="rounded-lg p-1.5 text-[#727B8E] hover:bg-[#727B8E]/10 transition-colors"
                >
                  {rt.is_active ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(rt)}
                  title="Editar"
                  className="rounded-lg p-1.5 text-[#727B8E] hover:bg-[#727B8E]/10 transition-colors"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(rt)}
                  disabled={deletingId === rt.id}
                  title="Excluir"
                  className="rounded-lg p-1.5 text-[#727B8E] hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 transition-colors disabled:opacity-40"
                >
                  {deletingId === rt.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HospedagemContent() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [hotelEnabled, setHotelEnabled] = useState(false);
  const [hotelCheckinTime, setHotelCheckinTime] = useState("08:00");
  const [hotelCheckoutTime, setHotelCheckoutTime] = useState("18:00");
  const [daycareEnabled, setDaycareEnabled] = useState(false);
  const [daycareCheckinTime, setDaycareCheckinTime] = useState("07:00");
  const [daycareCheckoutTime, setDaycareCheckoutTime] = useState("19:00");
  const [agendaDays, setAgendaDays] = useState<AgendaDay[] | null>(null);

  // ─── Room Types ────────────────────────────────────────────────────────────
  const [hotelRoomTypes, setHotelRoomTypes] = useState<RoomType[]>([]);
  const [daycareRoomTypes, setDaycareRoomTypes] = useState<RoomType[]>([]);
  const [roomTypeModalOpen, setRoomTypeModalOpen] = useState(false);
  const [roomTypeEditing, setRoomTypeEditing] = useState<RoomType | null>(null);
  const [roomTypeForm, setRoomTypeForm] = useState<
    CreateRoomTypeData & { description: string }
  >(EMPTY_ROOM_TYPE_FORM);
  const [savingRoomType, setSavingRoomType] = useState(false);
  const [deletingRoomTypeId, setDeletingRoomTypeId] = useState<string | null>(
    null,
  );

  const fetchRoomTypes = useCallback(async () => {
    const all = await roomTypeService.list();
    setHotelRoomTypes(all.filter((r) => r.lodging_type === "hotel"));
    setDaycareRoomTypes(all.filter((r) => r.lodging_type === "daycare"));
  }, []);

  const openNewRoomType = (lodgingType: "hotel" | "daycare") => {
    setRoomTypeEditing(null);
    setRoomTypeForm({ ...EMPTY_ROOM_TYPE_FORM, lodging_type: lodgingType });
    setRoomTypeModalOpen(true);
  };

  const openEditRoomType = (rt: RoomType) => {
    setRoomTypeEditing(rt);
    setRoomTypeForm({
      lodging_type: rt.lodging_type,
      name: rt.name,
      description: rt.description ?? "",
      capacity: rt.capacity,
      daily_rate: rt.daily_rate,
    });
    setRoomTypeModalOpen(true);
  };

  const handleSaveRoomType = async () => {
    if (!roomTypeForm.name.trim()) {
      toast.error("Validação", "O nome do tipo de quarto é obrigatório.");
      return;
    }
    if (roomTypeForm.capacity < 0) {
      toast.error("Validação", "A capacidade deve ser 0 ou mais.");
      return;
    }
    if (roomTypeForm.daily_rate < 0) {
      toast.error("Validação", "A diária deve ser 0 ou mais.");
      return;
    }
    setSavingRoomType(true);
    try {
      if (roomTypeEditing) {
        await roomTypeService.update(roomTypeEditing.id, {
          name: roomTypeForm.name.trim(),
          description: roomTypeForm.description.trim() || null,
          capacity: roomTypeForm.capacity,
          daily_rate: roomTypeForm.daily_rate,
        });
        toast.success("Salvo!", "Tipo de quarto atualizado com sucesso.");
      } else {
        await roomTypeService.create({
          ...roomTypeForm,
          name: roomTypeForm.name.trim(),
          description: roomTypeForm.description.trim() || undefined,
        });
        toast.success("Criado!", "Tipo de quarto adicionado com sucesso.");
      }
      setRoomTypeModalOpen(false);
      await fetchRoomTypes();
    } catch {
      toast.error("Erro", "Não foi possível salvar o tipo de quarto.");
    } finally {
      setSavingRoomType(false);
    }
  };

  const handleToggleRoomType = async (rt: RoomType) => {
    try {
      await roomTypeService.update(rt.id, { is_active: !rt.is_active });
      await fetchRoomTypes();
    } catch {
      toast.error("Erro", "Não foi possível alterar o status.");
    }
  };

  const handleDeleteRoomType = async (rt: RoomType) => {
    setDeletingRoomTypeId(rt.id);
    try {
      await roomTypeService.delete(rt.id);
      toast.success("Removido!", `"${rt.name}" foi excluído.`);
      await fetchRoomTypes();
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ??
        "Não foi possível excluir o tipo de quarto.";
      toast.error("Erro", msg);
    } finally {
      setDeletingRoomTypeId(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      lodgingConfigService.get(),
      settingsService.getAgenda().catch(() => null),
      roomTypeService.list().catch(() => []),
    ])
      .then(([cfg, agenda, allRoomTypes]) => {
        if (cancelled) return;
        setHotelEnabled(cfg.hotel_enabled);
        setHotelCheckinTime(cfg.hotel_checkin_time);
        setHotelCheckoutTime(cfg.hotel_checkout_time);
        setDaycareEnabled(cfg.daycare_enabled);
        setDaycareCheckinTime(cfg.daycare_checkin_time);
        setDaycareCheckoutTime(cfg.daycare_checkout_time);
        setAgendaDays(agenda?.days ?? null);
        setHotelRoomTypes(
          (allRoomTypes as RoomType[]).filter(
            (r) => r.lodging_type === "hotel",
          ),
        );
        setDaycareRoomTypes(
          (allRoomTypes as RoomType[]).filter(
            (r) => r.lodging_type === "daycare",
          ),
        );
      })
      .catch(() =>
        toast.error(
          "Erro",
          "Não foi possível carregar as configurações de hospedagem.",
        ),
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveLodging = async () => {
    setSaving(true);
    try {
      await lodgingConfigService.update({
        hotel_enabled: hotelEnabled,
        hotel_checkin_time: hotelCheckinTime,
        hotel_checkout_time: hotelCheckoutTime,
        daycare_enabled: daycareEnabled,
        daycare_checkin_time: daycareCheckinTime,
        daycare_checkout_time: daycareCheckoutTime,
      });
      toast.success(
        "Hospedagem salva!",
        "Configurações atualizadas com sucesso.",
      );
    } catch {
      toast.error("Erro", "Não foi possível salvar a hospedagem.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#727B8E] dark:text-[#8a94a6]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
        <div className="flex flex-col gap-6 pb-2">
          <div className="rounded-xl border border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                  Hotel
                </p>
                <p className="text-xs text-[#727B8E] dark:text-[#8a94a6] mt-0.5">
                  Hospedagem noturna para pets.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={hotelEnabled}
                  onChange={(e) => setHotelEnabled(e.target.checked)}
                />
                <div className="w-10 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-5 peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-[#1E62EC]"></div>
              </label>
            </div>
            {hotelEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#434A57] dark:text-[#f5f9fc] mb-1">
                    Horário de check-in
                  </label>
                  <Input
                    type="time"
                    value={hotelCheckinTime}
                    onChange={(e) => setHotelCheckinTime(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#434A57] dark:text-[#f5f9fc] mb-1">
                    Horário de check-out
                  </label>
                  <Input
                    type="time"
                    value={hotelCheckoutTime}
                    onChange={(e) => setHotelCheckoutTime(e.target.value)}
                  />
                </div>
              </div>
            )}

            {hotelEnabled && (
              <RoomTypeSection
                lodgingType="hotel"
                roomTypes={hotelRoomTypes}
                onAdd={() => openNewRoomType("hotel")}
                onEdit={openEditRoomType}
                onToggle={handleToggleRoomType}
                onDelete={handleDeleteRoomType}
                deletingId={deletingRoomTypeId}
              />
            )}
          </div>

          <div className="rounded-xl border border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                  Creche
                </p>
                <p className="text-xs text-[#727B8E] dark:text-[#8a94a6] mt-0.5">
                  Cuidados diurnos e atividades para pets.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={daycareEnabled}
                  onChange={(e) => setDaycareEnabled(e.target.checked)}
                />
                <div className="w-10 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-5 peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-[#1E62EC]"></div>
              </label>
            </div>
            {daycareEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#434A57] dark:text-[#f5f9fc] mb-1">
                    Horário de entrada
                  </label>
                  <Input
                    type="time"
                    value={daycareCheckinTime}
                    onChange={(e) => setDaycareCheckinTime(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#434A57] dark:text-[#f5f9fc] mb-1">
                    Horário de saída
                  </label>
                  <Input
                    type="time"
                    value={daycareCheckoutTime}
                    onChange={(e) => setDaycareCheckoutTime(e.target.value)}
                  />
                </div>
              </div>
            )}

            {daycareEnabled && (
              <RoomTypeSection
                lodgingType="daycare"
                roomTypes={daycareRoomTypes}
                onAdd={() => openNewRoomType("daycare")}
                onEdit={openEditRoomType}
                onToggle={handleToggleRoomType}
                onDelete={handleDeleteRoomType}
                deletingId={deletingRoomTypeId}
              />
            )}
          </div>

          <Modal
            isOpen={roomTypeModalOpen}
            onClose={() => setRoomTypeModalOpen(false)}
            title={
              roomTypeEditing ? "Editar tipo de quarto" : "Novo tipo de quarto"
            }
          >
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-[#434A57] dark:text-[#f5f9fc] mb-1">
                  Nome <span className="text-red-500">*</span>
                </label>
                <Input
                  value={roomTypeForm.name}
                  onChange={(e) =>
                    setRoomTypeForm((p) => ({ ...p, name: e.target.value }))
                  }
                  placeholder="ex: Standard, Premium, Suíte VIP"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#434A57] dark:text-[#f5f9fc] mb-1">
                  Descrição
                </label>
                <TextArea
                  value={roomTypeForm.description}
                  onChange={(e) =>
                    setRoomTypeForm((p) => ({
                      ...p,
                      description: e.target.value,
                    }))
                  }
                  placeholder="Descreva o que inclui este tipo de quarto..."
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#434A57] dark:text-[#f5f9fc] mb-1">
                    Capacidade (vagas) <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="number"
                    min="0"
                    value={roomTypeForm.capacity}
                    onChange={(e) =>
                      setRoomTypeForm((p) => ({
                        ...p,
                        capacity: Number(e.target.value),
                      }))
                    }
                    placeholder="ex: 5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#434A57] dark:text-[#f5f9fc] mb-1">
                    Diária (R$) <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={roomTypeForm.daily_rate}
                    onChange={(e) =>
                      setRoomTypeForm((p) => ({
                        ...p,
                        daily_rate: Number(e.target.value),
                      }))
                    }
                    placeholder="ex: 150,00"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRoomTypeModalOpen(false)}
                  disabled={savingRoomType}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveRoomType}
                  disabled={savingRoomType}
                >
                  {savingRoomType ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      Salvando...
                    </>
                  ) : roomTypeEditing ? (
                    "Salvar alterações"
                  ) : (
                    "Criar tipo"
                  )}
                </Button>
              </div>
            </div>
          </Modal>

          {(hotelEnabled || daycareEnabled) && (
            <div className="rounded-xl border border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-5 flex flex-col gap-4">
              <div>
                <p className="text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                  Visão geral de capacidade
                </p>
                <p className="text-xs text-[#727B8E] dark:text-[#8a94a6] mt-0.5">
                  Calculada automaticamente: soma dos tipos de quarto ativos ×
                  agenda de funcionamento. Dias fechados (aba Agenda) sempre
                  terão capacidade zero.
                </p>
              </div>

              {hotelEnabled &&
                hotelRoomTypes.filter((r) => r.is_active).length === 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/20 px-3 py-2.5">
                    <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      <strong>Hotel</strong> habilitado mas sem tipos de quarto
                      ativos. Adicione pelo menos um tipo de quarto para que
                      reservas sejam aceitas.
                    </p>
                  </div>
                )}
              {daycareEnabled &&
                daycareRoomTypes.filter((r) => r.is_active).length === 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/20 px-3 py-2.5">
                    <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      <strong>Creche</strong> habilitada mas sem tipos de quarto
                      ativos. Adicione pelo menos um tipo de quarto para que
                      reservas sejam aceitas.
                    </p>
                  </div>
                )}

              <div className="overflow-x-auto pb-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#727B8E]/10">
                      <th className="text-left text-xs font-medium text-[#727B8E] dark:text-[#8a94a6] pb-2 pr-4">
                        Dia
                      </th>
                      {hotelEnabled && (
                        <th className="text-center text-xs font-medium text-[#727B8E] dark:text-[#8a94a6] pb-2 px-4">
                          Hotel
                        </th>
                      )}
                      {daycareEnabled && (
                        <th className="text-center text-xs font-medium text-[#727B8E] dark:text-[#8a94a6] pb-2 px-4">
                          Creche
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {LODGING_DAY_NAMES.map(({ dayOfWeek, label }) => {
                      const closed = isLodgingDayClosedFromAgenda(
                        agendaDays,
                        dayOfWeek,
                      );
                      const hotelCap = closed
                        ? 0
                        : hotelRoomTypes
                            .filter((r) => r.is_active)
                            .reduce((s, r) => s + r.capacity, 0);
                      const daycareCap = closed
                        ? 0
                        : daycareRoomTypes
                            .filter((r) => r.is_active)
                            .reduce((s, r) => s + r.capacity, 0);
                      return (
                        <tr
                          key={dayOfWeek}
                          className={cn(
                            "border-b border-[#727B8E]/5 last:border-0",
                            closed && "opacity-40",
                          )}
                        >
                          <td className="py-2.5 pr-4">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "text-sm font-medium",
                                  closed
                                    ? "text-[#727B8E]"
                                    : "text-[#434A57] dark:text-[#f5f9fc]",
                                )}
                              >
                                {label}
                              </span>
                              {closed && (
                                <span className="rounded-full bg-[#727B8E]/10 px-1.5 py-0.5 text-[10px] text-[#727B8E]">
                                  Fechado
                                </span>
                              )}
                            </div>
                          </td>
                          {hotelEnabled && (
                            <td className="py-2.5 px-4 text-center">
                              {closed ? (
                                <span className="text-xs text-[#727B8E]">
                                  —
                                </span>
                              ) : hotelRoomTypes.filter((r) => r.is_active)
                                  .length === 0 ? (
                                <span className="text-xs text-amber-500">
                                  Sem tipos
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center w-10 h-8 rounded-lg bg-[#1E62EC]/8 dark:bg-[#1E62EC]/15 text-sm font-semibold text-[#1E62EC]">
                                  {hotelCap}
                                </span>
                              )}
                            </td>
                          )}
                          {daycareEnabled && (
                            <td className="py-2.5 px-4 text-center">
                              {closed ? (
                                <span className="text-xs text-[#727B8E]">
                                  —
                                </span>
                              ) : daycareRoomTypes.filter((r) => r.is_active)
                                  .length === 0 ? (
                                <span className="text-xs text-amber-500">
                                  Sem tipos
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center w-10 h-8 rounded-lg bg-[#8B5CF6]/8 dark:bg-[#8B5CF6]/15 text-sm font-semibold text-[#8B5CF6]">
                                  {daycareCap}
                                </span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 shrink-0 border-t border-[#727B8E]/10 bg-white/95 px-1 py-3 backdrop-blur-sm dark:border-[#40485A] dark:bg-[#1A1B1D]/95 sm:px-0">
        <div className="flex justify-end">
          <Button
            onClick={handleSaveLodging}
            disabled={saving}
            size="sm"
            className="flex items-center gap-2 shadow-sm"
          >
            {saving ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar hospedagem"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ConfiguracoesPage() {
  const { user, logout } = useAuthContext();
  const petshopId = user?.petshop_id ?? 0;
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<SettingsTabId>("servicos");
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const [generatingSlots, setGeneratingSlots] = useState(false);
  const [generateDays, setGenerateDays] = useState(30);

  const handleGenerateSlots = useCallback(async () => {
    setGeneratingSlots(true);
    try {
      const result = await settingsService.generateSlots(generateDays);
      const msg = result.warning
        ? `${result.slots_created} slots criados. ${result.warning}`
        : `${result.slots_created} slots criados para ${result.days_generated} dia(s).`;
      toast.success("Slots gerados", msg);
    } catch {
      toast.error("Erro", "Não foi possível gerar os slots.");
    } finally {
      setGeneratingSlots(false);
    }
  }, [generateDays, toast]);
  const [petshop, setPetshop] = useState<Petshop | null>(null);
  const [petshopError, setPetshopError] = useState<string | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [whatsappStatus, setWhatsappStatus] = useState<{
    status: string;
    phone?: string;
    last_connected?: string;
    error_message?: string;
  } | null>(null);
  const [paymentStats, setPaymentStats] = useState<{
    total_revenue?: number;
    total_payments?: number;
    average_ticket?: number;
  } | null>(null);
  const [loadingPetshop, setLoadingPetshop] = useState(true);
  const [loadingServices, setLoadingServices] = useState(true);
  const [loadingSpecialties, setLoadingSpecialties] = useState(false);
  const [loadingWhatsapp, setLoadingWhatsapp] = useState(true);
  const [loadingPayment, setLoadingPayment] = useState(true);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [editingData, setEditingData] = useState({
    name: "",
    specialty_id: "",
    duration_minutes: 30,
    price: "",
    description: "",
    price_varies_by_size: false,
    price_small: "",
    price_medium: "",
    price_large: "",
    price_xlarge: "",
    duration_multiplier_large: false,
    block_ai_schedule: false,
    dependent_service_id: "" as string | number,
  });

  const [newServiceModalOpen, setNewServiceModalOpen] = useState(false);
  const [newServiceData, setNewServiceData] = useState({
    name: "",
    specialty_id: "",
    service_type: "",
    duration_minutes: 30,
    price: 0,
    description: "",
    price_varies_by_size: false,
    price_small: 0,
    price_medium: 0,
    price_large: 0,
    price_xlarge: 0,
    duration_multiplier_large: false,
    block_ai_schedule: false,
    dependent_service_id: "" as string | number,
  });
  const [priceDisplay, setPriceDisplay] = useState({
    price: "",
    price_small: "",
    price_medium: "",
    price_large: "",
    price_xlarge: "",
  });
  const [creatingService, setCreatingService] = useState(false);
  const [updatingService, setUpdatingService] = useState(false);

  const fetchPetshop = useCallback(async () => {
    if (!petshopId) {
      setLoadingPetshop(false);
      setPetshopError(null);
      return;
    }
    setPetshopError(null);
    try {
      const data = await petshopService.getPetshop(petshopId);
      setPetshop(data);
    } catch (err: unknown) {
      console.error("Erro ao carregar estabelecimento:", err);
      const message =
        err &&
        typeof err === "object" &&
        "response" in err &&
        err.response &&
        typeof (err.response as { data?: { detail?: string } }).data?.detail ===
          "string"
          ? (err.response as { data: { detail: string } }).data.detail
          : "Não foi possível carregar os dados do estabelecimento.";
      setPetshopError(message);
    } finally {
      setLoadingPetshop(false);
    }
  }, [petshopId]);

  const fetchServices = useCallback(async () => {
    try {
      setLoadingServices(true);
      const list = await serviceService.listServices(undefined);
      setServices(list);
    } catch (error) {
      console.error("Erro ao carregar serviços:", error);
      setServices([]);
    } finally {
      setLoadingServices(false);
    }
  }, [petshopId]);

  const fetchSpecialties = useCallback(async () => {
    try {
      setLoadingSpecialties(true);
      const list = await specialtyService.list();
      setSpecialties(list);
    } catch (error) {
      console.error("Erro ao carregar especialidades:", error);
      setSpecialties([]);
    } finally {
      setLoadingSpecialties(false);
    }
  }, []);

  useEffect(() => {
    fetchPetshop();
  }, [fetchPetshop]);

  // Lazy-load: fetch data only when the relevant tab becomes active
  const servicesLoadedRef = useRef(false);
  const specialtiesLoadedRef = useRef(false);
  const whatsappLoadedRef = useRef(false);
  const paymentLoadedRef = useRef(false);

  useEffect(() => {
    if (activeTab === "servicos" && !specialtiesLoadedRef.current) {
      specialtiesLoadedRef.current = true;
      fetchSpecialties();
    }
  }, [activeTab, fetchSpecialties]);

  useEffect(() => {
    if (activeTab === "servicos" && !servicesLoadedRef.current) {
      servicesLoadedRef.current = true;
      fetchServices();
    }
  }, [activeTab, fetchServices]);

  useEffect(() => {
    if (activeTab === "whatsapp" && !whatsappLoadedRef.current) {
      whatsappLoadedRef.current = true;
      const load = async () => {
        try {
          const data = await whatsappService.getStatus();
          setWhatsappStatus({
            status: data.status,
            phone: data.phone,
            last_connected: (data as any).last_connected,
            error_message: (data as any).error_message,
          });
        } catch {
          setWhatsappStatus(null);
        } finally {
          setLoadingWhatsapp(false);
        }
      };
      load();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "pagamento" && !paymentLoadedRef.current) {
      paymentLoadedRef.current = true;
      const load = async () => {
        try {
          const data = await paymentService.getStats();
          setPaymentStats({
            total_revenue: data.total_revenue,
            total_payments: data.total_payments,
            average_ticket: data.average_ticket,
          });
        } catch {
          setPaymentStats(null);
        } finally {
          setLoadingPayment(false);
        }
      };
      load();
    }
  }, [activeTab]);

  const handleSaveEmpresa = useCallback(
    async (data: {
      name?: string;
      phone?: string;
      address?: string;
      cep?: string;
      owner_phone?: string;
      emergency_contact?: string;
    }) => {
      if (!petshopId) return;
      try {
        const { name: company_name, ...petshopData } = data;
        await petshopService.updatePetshop(petshopId, {
          ...petshopData,
          ...(company_name ? { company_name } : {}),
        } as Parameters<typeof petshopService.updatePetshop>[1]);
        await fetchPetshop();
        toast.success(
          "Configurações salvas!",
          "As informações da empresa foram atualizadas com sucesso.",
        );
      } catch (error) {
        console.error("Erro ao salvar configurações:", error);
        toast.error(
          "Erro ao salvar",
          "Não foi possível salvar as configurações. Tente novamente.",
        );
      }
    },
    [petshopId, fetchPetshop, toast],
  );

  const handleEditService = (service: Service) => {
    setSelectedService(service);
    setEditModalOpen(true);
  };

  const handleCloseEditModal = () => {
    setEditModalOpen(false);
    setSelectedService(null);
    setEditingData({
      name: "",
      specialty_id: "",
      duration_minutes: 30,
      price: "",
      description: "",
      price_varies_by_size: false,
      price_small: "",
      price_medium: "",
      price_large: "",
      price_xlarge: "",
      duration_multiplier_large: false,
      block_ai_schedule: false,
      dependent_service_id: "",
    });
  };

  useEffect(() => {
    if (selectedService) {
      const hasSize = !!(
        selectedService.priceBySize &&
        (selectedService.priceBySize.small ||
          selectedService.priceBySize.medium ||
          selectedService.priceBySize.large ||
          selectedService.priceBySize.xlarge)
      );
      setEditingData({
        name: selectedService.name,
        specialty_id: selectedService.specialtyId || "",
        duration_minutes: selectedService.durationMin || 30,
        price: selectedService.price?.toString() || "",
        description: selectedService.description || "",
        price_varies_by_size: hasSize,
        price_small: selectedService.priceBySize?.small?.toString() || "",
        price_medium: selectedService.priceBySize?.medium?.toString() || "",
        price_large: selectedService.priceBySize?.large?.toString() || "",
        price_xlarge: selectedService.priceBySize?.xlarge?.toString() || "",
        duration_multiplier_large:
          selectedService.durationMultiplierLarge === 2,
        block_ai_schedule: selectedService.blockAiSchedule ?? false,
        dependent_service_id: selectedService.dependentServiceId ?? "",
      });
    }
  }, [selectedService]);

  const handleEditingDataChange = (
    field: string,
    value: string | number | boolean,
  ) => {
    setEditingData((prev) => ({ ...prev, [field]: value }));
  };

  const handleUpdateService = async () => {
    if (updatingService) return;
    if (!selectedService || !editingData.name.trim()) {
      toast.warning("Erro", "Nome do serviço é obrigatório.");
      return;
    }

    setUpdatingService(true);
    try {
      await serviceService.updateService(selectedService.id, {
        name: editingData.name,
        specialty_id: editingData.specialty_id || null,
        duration_min: editingData.duration_minutes,
        price: editingData.price_varies_by_size
          ? null
          : editingData.price
            ? parseFloat(editingData.price)
            : undefined,
        description: editingData.description || undefined,
        price_by_size: editingData.price_varies_by_size
          ? {
              small: editingData.price_small
                ? parseFloat(editingData.price_small)
                : undefined,
              medium: editingData.price_medium
                ? parseFloat(editingData.price_medium)
                : undefined,
              large: editingData.price_large
                ? parseFloat(editingData.price_large)
                : undefined,
              xlarge: editingData.price_xlarge
                ? parseFloat(editingData.price_xlarge)
                : undefined,
            }
          : null,
        duration_multiplier_large: editingData.duration_multiplier_large
          ? 2
          : 1,
        block_ai_schedule: editingData.block_ai_schedule,
        dependent_service_id:
          editingData.block_ai_schedule && editingData.dependent_service_id
            ? Number(editingData.dependent_service_id)
            : null,
      });
      toast.success("Sucesso!", "Serviço atualizado com sucesso.");
      handleCloseEditModal();
      await fetchServices();
    } catch (error) {
      console.error("Erro ao atualizar:", error);
      toast.error("Erro", "Não foi possível atualizar o serviço.");
    } finally {
      setUpdatingService(false);
    }
  };

  const handleCreateSpecialty = async (
    name: string,
    color?: string,
  ): Promise<string> => {
    const sp = await specialtyService.create({ name, color });
    specialtiesLoadedRef.current = false;
    await fetchSpecialties();
    return sp.id;
  };

  const handleDeleteSpecialty = async (id: string) => {
    await specialtyService.delete(id);
    specialtiesLoadedRef.current = false;
    await fetchSpecialties();
  };

  const handleToggleSpecialty = async (id: string, active: boolean) => {
    await specialtyService.update(id, { is_active: active });
    specialtiesLoadedRef.current = false;
    await fetchSpecialties();
  };

  const handleOpenNewServiceModal = (preselectedSpecialtyId?: string) => {
    if (preselectedSpecialtyId) {
      setNewServiceData((prev) => ({
        ...prev,
        specialty_id: preselectedSpecialtyId,
      }));
    }
    setNewServiceModalOpen(true);
  };

  const handleCloseNewServiceModal = () => {
    setNewServiceModalOpen(false);
    setNewServiceData({
      name: "",
      specialty_id: "",
      service_type: "",
      duration_minutes: 30,
      price: 0,
      description: "",
      price_varies_by_size: false,
      price_small: 0,
      price_medium: 0,
      price_large: 0,
      price_xlarge: 0,
      duration_multiplier_large: false,
      block_ai_schedule: false,
      dependent_service_id: "",
    });
    setPriceDisplay({
      price: "",
      price_small: "",
      price_medium: "",
      price_large: "",
      price_xlarge: "",
    });
  };

  const handleNewServiceChange = (
    field: string,
    value: string | number | boolean,
  ) => {
    setNewServiceData((prev) => ({ ...prev, [field]: value }));
  };

  const handlePriceChange = (
    field:
      | "price"
      | "price_small"
      | "price_medium"
      | "price_large"
      | "price_xlarge",
    value: string,
  ) => {
    const masked = maskCurrency(value);
    setPriceDisplay((prev) => ({ ...prev, [field]: masked }));
    const numericValue = unmaskCurrency(masked);
    setNewServiceData((prev) => ({ ...prev, [field]: numericValue }));
  };

  useEffect(() => {
    if (activeTab !== "ia-playground") return;
    const run = () => {
      if (contentScrollRef.current) {
        contentScrollRef.current.scrollTop = 0;
        let el: HTMLElement | null = contentScrollRef.current.parentElement;
        while (el) {
          const { overflowY } = getComputedStyle(el);
          if (
            overflowY === "auto" ||
            overflowY === "scroll" ||
            overflowY === "overlay"
          ) {
            el.scrollTop = 0;
            break;
          }
          el = el.parentElement;
        }
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
  }, [activeTab]);

  const handleCreateService = async () => {
    if (creatingService) return;
    if (!newServiceData.name.trim()) {
      toast.warning(
        "Preencha os campos obrigatórios",
        "O nome do serviço é obrigatório.",
      );
      return;
    }
    if (!newServiceData.specialty_id) {
      toast.warning(
        "Especialidade obrigatória",
        "Vincule o serviço a uma especialidade.",
      );
      return;
    }

    setCreatingService(true);
    try {
      await serviceService.createService({
        name: newServiceData.name,
        specialty_id: newServiceData.specialty_id,
        duration_min: newServiceData.duration_minutes,
        price: newServiceData.price_varies_by_size
          ? undefined
          : newServiceData.price || undefined,
        description: newServiceData.description || undefined,
        price_by_size: newServiceData.price_varies_by_size
          ? {
              small: newServiceData.price_small || undefined,
              medium: newServiceData.price_medium || undefined,
              large: newServiceData.price_large || undefined,
              xlarge: newServiceData.price_xlarge || undefined,
            }
          : undefined,
        duration_multiplier_large: newServiceData.duration_multiplier_large
          ? 2
          : 1,
        block_ai_schedule: newServiceData.block_ai_schedule,
        dependent_service_id:
          newServiceData.block_ai_schedule &&
          newServiceData.dependent_service_id
            ? Number(newServiceData.dependent_service_id)
            : null,
      });
      handleCloseNewServiceModal();
      await fetchServices();
      toast.success(
        "Serviço criado!",
        `O serviço "${newServiceData.name}" foi adicionado com sucesso.`,
      );
    } catch (error) {
      console.error("Erro ao criar serviço:", error);
      toast.error(
        "Erro ao criar serviço",
        "Não foi possível criar o serviço. Tente novamente.",
      );
    } finally {
      setCreatingService(false);
    }
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case "servicos":
        return (
          <ServicosContent
            services={services}
            specialties={specialties}
            loading={loadingServices}
            loadingSpecialties={loadingSpecialties}
            petshopId={petshopId}
            petshop={petshop}
            onEditService={handleEditService}
            onRefresh={fetchServices}
            onCreateSpecialty={handleCreateSpecialty}
            onDeleteSpecialty={handleDeleteSpecialty}
            onActivateSpecialty={async (id) => {
              await handleToggleSpecialty(id, true);
            }}
            onNewService={handleOpenNewServiceModal}
            onRefreshSpecialties={fetchSpecialties}
          />
        );
      case "hospedagem":
        return <HospedagemContent />;
      case "empresa":
        return (
          <EmpresaContent
            petshop={petshop}
            loading={loadingPetshop}
            onSave={handleSaveEmpresa}
          />
        );
      case "horarios":
        return <AbaAgenda />;
      case "whatsapp":
        return (
          <WhatsAppContent status={whatsappStatus} loading={loadingWhatsapp} />
        );
      case "pagamento":
        return (
          <PagamentoContent stats={paymentStats} loading={loadingPayment} />
        );
      case "ia-playground":
        return <IAPlaygroundContent />;
      default:
        return null;
    }
  };

  return (
    <DashboardLayout>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-24 pt-6 sm:px-6 sm:pb-10 sm:pt-8 lg:px-10 lg:pb-10 lg:pt-6">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-visible rounded-2xl border border-[#727B8E]/10 bg-white shadow-lg dark:border-[#40485A] dark:bg-[#1A1B1D] sm:rounded-3xl">
          <div className="flex shrink-0 justify-center sm:px-0">
            <div className="absolute left-1/2 -top-7 flex w-full mx-auto shrink-0 max-w-[600px]! -translate-x-1/2 overflow-x-auto overflow-visible rounded-t-[10px] p-2 sm:relative sm:left-auto sm:-top-5 sm:max-w-none sm:translate-x-0 sm:rounded-none sm:pt-0">
              <SettingsTabs activeTab={activeTab} onTabChange={setActiveTab} />
            </div>
          </div>

          <div
            ref={contentScrollRef}
            className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-4 pt-14 pb-8 sm:gap-11 sm:px-6 sm:pt-12 sm:pb-12 lg:flex-row lg:px-10 lg:py-16"
          >
            <div className="w-full shrink-0 lg:max-w-[320px]">
              <SettingsProfileSidebar
                petshop={petshop}
                user={user}
                loading={loadingPetshop}
                error={petshopError}
                showNovoServico={false}
                onNovoServico={handleOpenNewServiceModal}
                onLogout={logout}
                onGenerateSlots={handleGenerateSlots}
                generatingSlots={generatingSlots}
                generateDays={generateDays}
                onGenerateDaysChange={setGenerateDays}
              />
            </div>

            <div className="flex-1 min-w-0" key={activeTab}>
              <motion.div
                className="h-full"
                animate={{ opacity: 1, y: 0 }}
                initial={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                {renderTabContent()}
              </motion.div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        isOpen={editModalOpen}
        onClose={handleCloseEditModal}
        title="Editar serviço"
        onSubmit={handleUpdateService}
        submitText={updatingService ? "Salvando..." : "Salvar"}
        cancelText="Cancelar"
        isLoading={updatingService}
        className="max-w-[480px]"
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Nome do serviço"
            placeholder="Ex: Banho, Tosa, etc."
            value={editingData.name}
            onChange={(e) => handleEditingDataChange("name", e.target.value)}
          />

          <div>
            <label className="mb-1 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
              Especialidade
            </label>
            <select
              value={editingData.specialty_id}
              onChange={(e) =>
                handleEditingDataChange("specialty_id", e.target.value)
              }
              className="w-full rounded-lg border border-[#727B8E]/20 bg-white dark:bg-[#1A1B1D] dark:border-[#40485A] px-3 py-2 text-sm text-[#434A57] dark:text-[#f5f9fc]"
            >
              <option value="">— Sem especialidade —</option>
              {specialties
                .filter((sp) => sp.name !== "Hospedagem")
                .map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name}
                  </option>
                ))}
            </select>
          </div>

          <Input
            label="Duração (minutos)"
            type="number"
            value={editingData.duration_minutes}
            onChange={(e) =>
              handleEditingDataChange(
                "duration_minutes",
                parseInt(e.target.value) || 0,
              )
            }
            min="15"
            step="15"
          />

          <div className="flex items-center justify-between rounded-lg border border-[#727B8E]/10 bg-[#F4F6F9] dark:border-[#40485A] dark:bg-[#212225] px-4 py-3">
            <div className="flex-1">
              <label
                htmlFor="edit_duration_multiplier"
                className="cursor-pointer text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]"
              >
                Pets de porte grande (G e GG) ocupam o dobro do tempo
              </label>
              <p className="text-xs font-normal text-[#727B8E]">
                Reserva dois slots consecutivos para porte G/GG
              </p>
            </div>
            <label
              htmlFor="edit_duration_multiplier"
              className="relative inline-flex cursor-pointer items-center"
            >
              <input
                type="checkbox"
                id="edit_duration_multiplier"
                checked={editingData.duration_multiplier_large}
                onChange={(e) =>
                  handleEditingDataChange(
                    "duration_multiplier_large",
                    e.target.checked,
                  )
                }
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-[#727B8E]/30 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#1E62EC] peer-checked:after:translate-x-full peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#1E62EC]/20"></div>
            </label>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-[#727B8E]/10 bg-[#F4F6F9] dark:border-[#40485A] dark:bg-[#212225] px-4 py-3">
            <div className="flex-1">
              <label
                htmlFor="edit_price_varies_by_size"
                className="cursor-pointer text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]"
              >
                Preço varia por porte?
              </label>
              <p className="text-xs font-normal text-[#727B8E]">
                Defina preços diferentes para P, M, G e GG
              </p>
            </div>
            <label
              htmlFor="edit_price_varies_by_size"
              className="relative inline-flex cursor-pointer items-center"
            >
              <input
                type="checkbox"
                id="edit_price_varies_by_size"
                checked={editingData.price_varies_by_size}
                onChange={(e) =>
                  handleEditingDataChange(
                    "price_varies_by_size",
                    e.target.checked,
                  )
                }
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-[#727B8E]/30 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#1E62EC] peer-checked:after:translate-x-full peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#1E62EC]/20"></div>
            </label>
          </div>

          {!editingData.price_varies_by_size && (
            <Input
              label="Preço (R$)"
              type="number"
              value={editingData.price}
              onChange={(e) => handleEditingDataChange("price", e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
            />
          )}

          {editingData.price_varies_by_size && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Input
                label="Pequeno (P)"
                type="number"
                placeholder="0.00"
                value={editingData.price_small}
                onChange={(e) =>
                  handleEditingDataChange("price_small", e.target.value)
                }
                step="0.01"
                min="0"
              />
              <Input
                label="Médio (M)"
                type="number"
                placeholder="0.00"
                value={editingData.price_medium}
                onChange={(e) =>
                  handleEditingDataChange("price_medium", e.target.value)
                }
                step="0.01"
                min="0"
              />
              <Input
                label="Grande (G)"
                type="number"
                placeholder="0.00"
                value={editingData.price_large}
                onChange={(e) =>
                  handleEditingDataChange("price_large", e.target.value)
                }
                step="0.01"
                min="0"
              />
              <Input
                label="Gigante (GG)"
                type="number"
                placeholder="0.00"
                value={editingData.price_xlarge}
                onChange={(e) =>
                  handleEditingDataChange("price_xlarge", e.target.value)
                }
                step="0.01"
                min="0"
              />
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20 px-4 py-3">
            <div className="flex-1">
              <label
                htmlFor="edit_block_ai_schedule"
                className="cursor-pointer text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]"
              >
                Bloquear agendamento pelo bot
              </label>
              <p className="text-xs font-normal text-[#727B8E]">
                O bot não agendará este serviço diretamente
              </p>
            </div>
            <label
              htmlFor="edit_block_ai_schedule"
              className="relative inline-flex cursor-pointer items-center"
            >
              <input
                type="checkbox"
                id="edit_block_ai_schedule"
                checked={editingData.block_ai_schedule}
                onChange={(e) =>
                  handleEditingDataChange("block_ai_schedule", e.target.checked)
                }
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-[#727B8E]/30 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-amber-500 peer-checked:after:translate-x-full peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-amber-400/30"></div>
            </label>
          </div>

          {editingData.block_ai_schedule && (
            <div>
              <label className="mb-1 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                Serviço dependente (pré-requisito)
              </label>
              <select
                value={String(editingData.dependent_service_id)}
                onChange={(e) =>
                  handleEditingDataChange(
                    "dependent_service_id",
                    e.target.value,
                  )
                }
                className="w-full rounded-lg border border-[#727B8E]/20 bg-white dark:bg-[#1A1B1D] dark:border-[#40485A] px-3 py-2 text-sm text-[#434A57] dark:text-[#f5f9fc]"
              >
                <option value="">— Selecione o serviço pré-requisito —</option>
                {services
                  .filter(
                    (s) =>
                      s.specialtyId === editingData.specialty_id &&
                      s.id !== selectedService?.id &&
                      !s.blockAiSchedule,
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                O bot recomendará este serviço antes de aceitar o agendamento do
                serviço bloqueado.
              </p>
            </div>
          )}

          <div>
            <label className="mb-2 block text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
              Descrição
            </label>
            <TextArea
              placeholder="Descrição do serviço..."
              value={editingData.description}
              onChange={(e) =>
                handleEditingDataChange("description", e.target.value)
              }
              rows={4}
            />
          </div>
        </div>
      </Modal>

      {}
      <Modal
        isOpen={newServiceModalOpen}
        onClose={handleCloseNewServiceModal}
        title="Novo serviço"
        onSubmit={handleCreateService}
        submitText={creatingService ? "Criando..." : "Criar serviço"}
        cancelText="Cancelar"
        isLoading={creatingService}
        className="max-w-[480px]"
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Nome do serviço *"
            placeholder="Ex: Banho e Tosa"
            value={newServiceData.name}
            onChange={(e) => handleNewServiceChange("name", e.target.value)}
          />

          <div>
            <label className="mb-1 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
              Especialidade *
            </label>
            <select
              value={newServiceData.specialty_id}
              onChange={(e) =>
                handleNewServiceChange("specialty_id", e.target.value)
              }
              className="w-full rounded-lg border border-[#727B8E]/20 bg-white dark:bg-[#1A1B1D] dark:border-[#40485A] px-3 py-2 text-sm text-[#434A57] dark:text-[#f5f9fc]"
            >
              <option value="">— Selecione uma especialidade —</option>
              {specialties
                .filter((sp) => sp.name !== "Hospedagem")
                .map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name}
                  </option>
                ))}
            </select>
            {specialties.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                Crie uma especialidade antes de adicionar serviços.
              </p>
            )}
          </div>

          <Input
            label="Duração (minutos)"
            type="number"
            placeholder="30"
            value={newServiceData.duration_minutes}
            onChange={(e) =>
              handleNewServiceChange(
                "duration_minutes",
                parseInt(e.target.value) || 0,
              )
            }
          />

          <div>
            <label className="mb-2 block text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
              Descrição
            </label>
            <TextArea
              rows={3}
              placeholder="Descreva o serviço..."
              value={newServiceData.description}
              onChange={(e) =>
                handleNewServiceChange("description", e.target.value)
              }
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-[#727B8E]/10 bg-[#F4F6F9] dark:border-[#40485A] dark:bg-[#212225] px-4 py-3">
            <div className="flex-1">
              <label
                htmlFor="new_duration_multiplier"
                className="cursor-pointer text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]"
              >
                Pets G/GG ocupam o dobro do tempo
              </label>
              <p className="text-xs font-normal text-[#727B8E]">
                Reserva dois slots consecutivos para porte G/GG
              </p>
            </div>
            <label
              htmlFor="new_duration_multiplier"
              className="relative inline-flex cursor-pointer items-center"
            >
              <input
                type="checkbox"
                id="new_duration_multiplier"
                checked={newServiceData.duration_multiplier_large}
                onChange={(e) =>
                  handleNewServiceChange(
                    "duration_multiplier_large",
                    e.target.checked,
                  )
                }
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-[#727B8E]/30 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#1E62EC] peer-checked:after:translate-x-full peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#1E62EC]/20"></div>
            </label>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-[#727B8E]/10 bg-[#F4F6F9] dark:border-[#40485A] dark:bg-[#212225] px-4 py-3">
            <div className="flex-1">
              <label
                htmlFor="price_varies_by_size"
                className="cursor-pointer text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]"
              >
                Preço varia por porte?
              </label>
              <p className="text-xs font-normal text-[#727B8E]">
                Defina preços diferentes para P, M, G e GG
              </p>
            </div>
            <label
              htmlFor="price_varies_by_size"
              className="relative inline-flex cursor-pointer items-center"
            >
              <input
                type="checkbox"
                id="price_varies_by_size"
                checked={newServiceData.price_varies_by_size}
                onChange={(e) =>
                  handleNewServiceChange(
                    "price_varies_by_size",
                    e.target.checked,
                  )
                }
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-[#727B8E]/30 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#1E62EC] peer-checked:after:translate-x-full peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#1E62EC]/20"></div>
            </label>
          </div>

          {!newServiceData.price_varies_by_size && (
            <Input
              label="Preço (R$)"
              placeholder="0,00"
              value={priceDisplay.price}
              onChange={(e) => handlePriceChange("price", e.target.value)}
            />
          )}

          {newServiceData.price_varies_by_size && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Input
                label="Pequeno (P)"
                placeholder="0,00"
                value={priceDisplay.price_small}
                onChange={(e) =>
                  handlePriceChange("price_small", e.target.value)
                }
              />
              <Input
                label="Médio (M)"
                placeholder="0,00"
                value={priceDisplay.price_medium}
                onChange={(e) =>
                  handlePriceChange("price_medium", e.target.value)
                }
              />
              <Input
                label="Grande (G)"
                placeholder="0,00"
                value={priceDisplay.price_large}
                onChange={(e) =>
                  handlePriceChange("price_large", e.target.value)
                }
              />
              <Input
                label="Gigante (GG)"
                placeholder="0,00"
                value={priceDisplay.price_xlarge}
                onChange={(e) =>
                  handlePriceChange("price_xlarge", e.target.value)
                }
              />
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20 px-4 py-3">
            <div className="flex-1">
              <label
                htmlFor="new_block_ai_schedule"
                className="cursor-pointer text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]"
              >
                Bloquear agendamento pelo bot
              </label>
              <p className="text-xs font-normal text-[#727B8E]">
                O bot não agendará este serviço diretamente
              </p>
            </div>
            <label
              htmlFor="new_block_ai_schedule"
              className="relative inline-flex cursor-pointer items-center"
            >
              <input
                type="checkbox"
                id="new_block_ai_schedule"
                checked={newServiceData.block_ai_schedule}
                onChange={(e) =>
                  handleNewServiceChange("block_ai_schedule", e.target.checked)
                }
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-[#727B8E]/30 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-amber-500 peer-checked:after:translate-x-full peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-amber-400/30"></div>
            </label>
          </div>

          {newServiceData.block_ai_schedule && (
            <div>
              <label className="mb-1 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                Serviço dependente (pré-requisito)
              </label>
              <select
                value={String(newServiceData.dependent_service_id)}
                onChange={(e) =>
                  handleNewServiceChange("dependent_service_id", e.target.value)
                }
                className="w-full rounded-lg border border-[#727B8E]/20 bg-white dark:bg-[#1A1B1D] dark:border-[#40485A] px-3 py-2 text-sm text-[#434A57] dark:text-[#f5f9fc]"
              >
                <option value="">— Selecione o serviço pré-requisito —</option>
                {services
                  .filter(
                    (s) =>
                      s.specialtyId === newServiceData.specialty_id &&
                      !s.blockAiSchedule,
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                O bot recomendará este serviço antes de aceitar o agendamento do
                serviço bloqueado.
              </p>
            </div>
          )}
        </div>
      </Modal>
    </DashboardLayout>
  );
}
