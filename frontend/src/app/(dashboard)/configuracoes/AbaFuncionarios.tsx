"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  Plus,
  Edit2,
  Trash2,
  UserX,
  UserCheck,
  ChevronDown,
  ChevronRight,
  Calendar,
  X,
} from "lucide-react";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";
import { Modal } from "@/components/molecules/Modal";
import { cn } from "@/lib/cn";
import { useToast } from "@/hooks";
import {
  staffService,
  type Staff,
  type StaffSchedule,
  type CreateStaffData,
  type UpdateStaffData,
  type CreateScheduleData,
  type WorkHoursByDay,
} from "@/services/staffService";
import { specialtyService } from "@/services";
import type { Specialty } from "@/types/petshop";

// ── Constantes ────────────────────────────────────────────────

const DAYS_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const SCHEDULE_TYPES = [
  { value: "ferias", label: "Férias" },
  { value: "folga", label: "Folga" },
  { value: "saida_antecipada", label: "Saída antecipada" },
  { value: "reuniao", label: "Reunião" },
  { value: "externo", label: "Compromisso externo" },
];

function fmt(t?: string | null): string {
  if (!t) return "";
  const s = String(t);
  if (s.includes("T")) return s.split("T")[1]?.slice(0, 5) ?? "";
  return s.slice(0, 5);
}

// ── Formulário de funcionário ─────────────────────────────────

const EMPTY_STAFF_FORM: CreateStaffData = {
  name: "",
  role: "",
  specialty_ids: [],
  days_of_week: [1, 2, 3, 4, 5],
  work_start: "08:00",
  work_end: "18:00",
  lunch_start: "",
  lunch_end: "",
};

interface StaffFormProps {
  initial?: Partial<CreateStaffData>
  specialties: Specialty[]
  onSave: (data: CreateStaffData) => Promise<void>
  onCancel: () => void
  saving: boolean
  title: string
}

function StaffForm({ initial, specialties, onSave, onCancel, saving, title }: StaffFormProps) {
  const [form, setForm] = useState<CreateStaffData>({ ...EMPTY_STAFF_FORM, ...initial });
  const [perDayEnabled, setPerDayEnabled] = useState(() => !!initial?.work_hours_by_day && Object.keys(initial.work_hours_by_day).length > 0);

  function toggleDay(d: number) {
    setForm(f => {
      const newDays = f.days_of_week.includes(d)
        ? f.days_of_week.filter(x => x !== d)
        : [...f.days_of_week, d].sort();
      // Remove per-day hours for unchecked days
      if (f.work_hours_by_day && !newDays.includes(d)) {
        const updated = { ...f.work_hours_by_day };
        delete updated[String(d)];
        return { ...f, days_of_week: newDays, work_hours_by_day: updated };
      }
      return { ...f, days_of_week: newDays };
    });
  }

  function toggleSpecialty(id: string) {
    setForm(f => ({
      ...f,
      specialty_ids: (f.specialty_ids ?? []).includes(id)
        ? (f.specialty_ids ?? []).filter(x => x !== id)
        : [...(f.specialty_ids ?? []), id],
    }));
  }

  function setDayHour(day: number, field: "start" | "end" | "lunch_start" | "lunch_end", value: string) {
    setForm(f => {
      const byDay = { ...(f.work_hours_by_day ?? {}) };
      const existing = byDay[String(day)] ?? { start: f.work_start, end: f.work_end };
      byDay[String(day)] = { ...existing, [field]: value || null };
      return { ...f, work_hours_by_day: byDay };
    });
  }

  function getDayHours(day: number) {
    const byDay = form.work_hours_by_day;
    if (byDay && byDay[String(day)]) return byDay[String(day)];
    return { start: form.work_start, end: form.work_end, lunch_start: form.lunch_start, lunch_end: form.lunch_end };
  }

  function handleTogglePerDay() {
    if (perDayEnabled) {
      // Turning off — clear per-day overrides
      setForm(f => ({ ...f, work_hours_by_day: undefined }));
      setPerDayEnabled(false);
    } else {
      // Turning on — initialize all days with defaults
      const byDay: WorkHoursByDay = {};
      for (const d of form.days_of_week) {
        byDay[String(d)] = {
          start: form.work_start,
          end: form.work_end,
          lunch_start: form.lunch_start || null,
          lunch_end: form.lunch_end || null,
        };
      }
      setForm(f => ({ ...f, work_hours_by_day: byDay }));
      setPerDayEnabled(true);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Input
        label="Nome *"
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        placeholder="Ex: Ana Paula"
      />
      <Input
        label="Cargo"
        value={form.role ?? ""}
        onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
        placeholder="Ex: Tosadora, Banhista"
      />

      {/* Especialidades */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
          Especialidades
        </label>
        <div className="flex flex-wrap gap-2">
          {specialties.map(s => {
            const active = (form.specialty_ids ?? []).includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleSpecialty(s.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-[#3B63F6] bg-[#3B63F6] text-white"
                    : "border-[#727B8E]/30 text-[#727B8E] hover:border-[#3B63F6] dark:border-[#40485A] dark:text-[#8a94a6]"
                )}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Dias da semana */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
          Dias de trabalho *
        </label>
        <div className="flex gap-1.5">
          {DAYS_LABELS.map((label, i) => {
            const active = form.days_of_week.includes(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggleDay(i)}
                className={cn(
                  "h-9 w-9 rounded-lg border text-xs font-medium transition-colors",
                  active
                    ? "border-[#3B63F6] bg-[#3B63F6] text-white"
                    : "border-[#727B8E]/30 text-[#727B8E] hover:border-[#3B63F6] dark:border-[#40485A] dark:text-[#8a94a6]"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Horário padrão */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
            {perDayEnabled ? "Horário padrão (base)" : "Horário de trabalho *"}
          </label>
          <button
            type="button"
            onClick={handleTogglePerDay}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors",
              perDayEnabled
                ? "border-[#3B63F6] bg-[#3B63F6]/10 text-[#3B63F6]"
                : "border-[#727B8E]/30 text-[#727B8E] hover:border-[#3B63F6] dark:border-[#40485A] dark:text-[#8a94a6]"
            )}
          >
            {perDayEnabled ? "Desativar por dia" : "Configurar por dia"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Entrada"
            type="time"
            value={form.work_start}
            onChange={e => setForm(f => ({ ...f, work_start: e.target.value }))}
          />
          <Input
            label="Saída"
            type="time"
            value={form.work_end}
            onChange={e => setForm(f => ({ ...f, work_end: e.target.value }))}
          />
          <Input
            label="Almoço início"
            type="time"
            value={form.lunch_start ?? ""}
            onChange={e => setForm(f => ({ ...f, lunch_start: e.target.value || undefined }))}
          />
          <Input
            label="Almoço fim"
            type="time"
            value={form.lunch_end ?? ""}
            onChange={e => setForm(f => ({ ...f, lunch_end: e.target.value || undefined }))}
          />
        </div>
      </div>

      {/* Horários por dia */}
      {perDayEnabled && form.days_of_week.length > 0 && (
        <div>
          <label className="mb-2 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
            Horários por dia
          </label>
          <div className="flex flex-col gap-2 rounded-lg border border-[#727B8E]/10 bg-[#F8F9FB] p-3 dark:border-[#40485A] dark:bg-[#212225]">
            {form.days_of_week.map(d => {
              const h = getDayHours(d);
              return (
                <div key={d} className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-xs font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                    {DAYS_LABELS[d]}
                  </span>
                  <input
                    type="time"
                    value={h.start}
                    onChange={e => setDayHour(d, "start", e.target.value)}
                    className="w-24 rounded border border-[#727B8E]/20 bg-white px-2 py-1 text-xs dark:border-[#40485A] dark:bg-[#1A1B1D] dark:text-white"
                  />
                  <span className="text-xs text-[#727B8E]">–</span>
                  <input
                    type="time"
                    value={h.end}
                    onChange={e => setDayHour(d, "end", e.target.value)}
                    className="w-24 rounded border border-[#727B8E]/20 bg-white px-2 py-1 text-xs dark:border-[#40485A] dark:bg-[#1A1B1D] dark:text-white"
                  />
                  <span className="text-[10px] text-[#727B8E] ml-1">almoço</span>
                  <input
                    type="time"
                    value={h.lunch_start ?? ""}
                    onChange={e => setDayHour(d, "lunch_start", e.target.value)}
                    className="w-24 rounded border border-[#727B8E]/20 bg-white px-2 py-1 text-xs dark:border-[#40485A] dark:bg-[#1A1B1D] dark:text-white"
                  />
                  <span className="text-xs text-[#727B8E]">–</span>
                  <input
                    type="time"
                    value={h.lunch_end ?? ""}
                    onChange={e => setDayHour(d, "lunch_end", e.target.value)}
                    className="w-24 rounded border border-[#727B8E]/20 bg-white px-2 py-1 text-xs dark:border-[#40485A] dark:bg-[#1A1B1D] dark:text-white"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button onClick={() => onSave(form)} disabled={saving || !form.name}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
        </Button>
      </div>
    </div>
  );
}

// ── Linha de bloqueio ─────────────────────────────────────────

function fmtDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = new Date(raw);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

function ScheduleRow({
  schedule,
  onDelete,
}: {
  schedule: StaffSchedule;
  onDelete: () => void;
}) {
  const typeLabel = SCHEDULE_TYPES.find(t => t.value === schedule.type)?.label ?? schedule.type ?? "Bloqueio";
  const start = fmtDate(schedule.startDate);
  const end = fmtDate(schedule.endDate);
  const period = end && end !== start ? `${start} → ${end}` : start;
  const times =
    schedule.startTime && schedule.endTime
      ? `${fmt(schedule.startTime)} – ${fmt(schedule.endTime)}`
      : "Dia inteiro";

  return (
    <div className="flex items-center justify-between rounded-lg border border-[#727B8E]/10 bg-[#F8F9FB] px-3 py-2 dark:border-[#40485A] dark:bg-[#212225]">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-[#1A2233] dark:text-white">{typeLabel}</span>
        <span className="text-xs text-[#727B8E]">
          {period} · {times}
        </span>
        {schedule.notes && (
          <span className="text-xs italic text-[#727B8E]">{schedule.notes}</span>
        )}
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="rounded p-1 text-[#727B8E] hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Card do funcionário ───────────────────────────────────────

interface StaffCardProps {
  staff: Staff
  specialties: Specialty[]
  onEdit: () => void
  onDeactivate: () => void
  onReactivate: () => void
}

function StaffCard({ staff, specialties, onEdit, onDeactivate, onReactivate }: StaffCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [schedules, setSchedules] = useState<StaffSchedule[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [addingSchedule, setAddingSchedule] = useState(false);
  const [scheduleForm, setScheduleForm] = useState<CreateScheduleData>({
    type: "folga",
    start_date: "",
    end_date: "",
    start_time: "",
    end_time: "",
    notes: "",
  });
  const { success: toastSuccess, error: toastError } = useToast();

  const staffSpecialties = specialties.filter(s => staff.specialtyIds.includes(s.id));
  const hasPerDay = staff.workHoursByDay && Object.keys(staff.workHoursByDay).length > 0;
  const workDays = staff.daysOfWeek.map(d => {
    if (hasPerDay && staff.workHoursByDay![String(d)]) {
      const h = staff.workHoursByDay![String(d)];
      return `${DAYS_LABELS[d]} ${h.start}–${h.end}`;
    }
    return DAYS_LABELS[d];
  }).join(", ");

  const loadSchedules = useCallback(async () => {
    setLoadingSchedules(true);
    try {
      const data = await staffService.listSchedules(staff.id);
      setSchedules(data);
    } catch {
      toastError("Erro ao carregar bloqueios");
    } finally {
      setLoadingSchedules(false);
    }
  }, [staff.id, toastError]);

  useEffect(() => {
    if (expanded) loadSchedules();
  }, [expanded, loadSchedules]);

  const [savingSchedule, setSavingSchedule] = useState(false);

  async function handleAddSchedule() {
    if (!scheduleForm.start_date) {
      toastError("Data de início é obrigatória");
      return;
    }
    setSavingSchedule(true);
    try {
      const clean: CreateScheduleData = {
        type: scheduleForm.type || undefined,
        start_date: scheduleForm.start_date,
        end_date: scheduleForm.end_date || scheduleForm.start_date,
        start_time: scheduleForm.start_time || undefined,
        end_time: scheduleForm.end_time || undefined,
        notes: scheduleForm.notes || undefined,
      };
      await staffService.createSchedule(staff.id, clean);
      toastSuccess("Bloqueio adicionado");
      setAddingSchedule(false);
      setScheduleForm({ type: "folga", start_date: "", end_date: "", start_time: "", end_time: "", notes: "" });
      loadSchedules();
    } catch {
      toastError("Erro ao adicionar bloqueio");
    } finally {
      setSavingSchedule(false);
    }
  }

  async function handleDeleteSchedule(scheduleId: string) {
    try {
      await staffService.deleteSchedule(staff.id, scheduleId);
      toastSuccess("Bloqueio removido");
      loadSchedules();
    } catch {
      toastError("Erro ao remover bloqueio");
    }
  }

  return (
    <div className={cn(
      "rounded-xl border bg-white transition-all dark:bg-[#1A1B1D]",
      staff.isActive
        ? "border-[#727B8E]/10 dark:border-[#40485A]"
        : "border-[#727B8E]/10 bg-[#F8F9FB] opacity-60 dark:bg-[#212225]"
    )}>
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#3B63F6]/10 text-[#3B63F6] font-semibold text-sm">
          {staff.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate font-medium text-[#1A2233] dark:text-white">{staff.name}</p>
          <p className="text-xs text-[#727B8E]">
            {staff.role && <span className="mr-2">{staff.role}</span>}
            {fmt(staff.workStart)} – {fmt(staff.workEnd)} · {workDays}
          </p>
          {staffSpecialties.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {staffSpecialties.map(s => (
                <span
                  key={s.id}
                  className="rounded-full bg-[#3B63F6]/10 px-2 py-0.5 text-[10px] font-medium text-[#3B63F6]"
                >
                  {s.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded p-1.5 text-[#727B8E] hover:bg-[#F0F4FF] hover:text-[#3B63F6] dark:hover:bg-[#2a2d36]"
          >
            <Edit2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={staff.isActive ? onDeactivate : onReactivate}
            className={cn(
              "rounded p-1.5 transition-colors",
              staff.isActive
                ? "text-[#727B8E] hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                : "text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
            )}
          >
            {staff.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="rounded p-1.5 text-[#727B8E] hover:bg-[#F0F4FF] dark:hover:bg-[#2a2d36]"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Bloqueios expandidos */}
      {expanded && (
        <div className="border-t border-[#727B8E]/10 px-4 pb-4 pt-3 dark:border-[#40485A]">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
              Bloqueios / Ausências
            </span>
            <button
              type="button"
              onClick={() => setAddingSchedule(v => !v)}
              className="flex items-center gap-1 rounded-lg border border-[#727B8E]/20 px-2 py-1 text-xs text-[#3B63F6] hover:bg-[#F0F4FF] dark:hover:bg-[#2a2d36]"
            >
              {addingSchedule ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
              {addingSchedule ? "Cancelar" : "Adicionar"}
            </button>
          </div>

          {addingSchedule && (
            <div className="mb-3 rounded-lg border border-[#727B8E]/10 bg-[#F8F9FB] p-3 dark:border-[#40485A] dark:bg-[#212225]">
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-[#434A57] dark:text-[#f5f9fc]">Tipo</label>
                  <select
                    value={scheduleForm.type ?? "folga"}
                    onChange={e => setScheduleForm(f => ({ ...f, type: e.target.value }))}
                    className="w-full rounded-lg border border-[#727B8E]/20 bg-white px-3 py-2 text-sm text-[#1A2233] dark:border-[#40485A] dark:bg-[#1A1B1D] dark:text-white"
                  >
                    {SCHEDULE_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <Input
                  label="Data início *"
                  type="date"
                  value={scheduleForm.start_date}
                  onChange={e => setScheduleForm(f => ({ ...f, start_date: e.target.value }))}
                />
                <Input
                  label="Data fim"
                  type="date"
                  value={scheduleForm.end_date ?? ""}
                  onChange={e => setScheduleForm(f => ({ ...f, end_date: e.target.value || undefined }))}
                />
                <Input
                  label="Hora início (parcial)"
                  type="time"
                  value={scheduleForm.start_time ?? ""}
                  onChange={e => setScheduleForm(f => ({ ...f, start_time: e.target.value || undefined }))}
                />
                <Input
                  label="Hora fim (parcial)"
                  type="time"
                  value={scheduleForm.end_time ?? ""}
                  onChange={e => setScheduleForm(f => ({ ...f, end_time: e.target.value || undefined }))}
                />
                <div className="col-span-2">
                  <Input
                    label="Observação"
                    value={scheduleForm.notes ?? ""}
                    onChange={e => setScheduleForm(f => ({ ...f, notes: e.target.value || undefined }))}
                    placeholder="Ex: Viagem de férias"
                  />
                </div>
              </div>
              <div className="mt-2 flex justify-end">
                <Button onClick={handleAddSchedule} disabled={savingSchedule} className="text-sm py-1.5">
                  {savingSchedule ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar bloqueio"}
                </Button>
              </div>
            </div>
          )}

          {loadingSchedules ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-[#727B8E]" />
            </div>
          ) : schedules.length === 0 ? (
            <p className="text-center text-xs text-[#727B8E] py-3">Nenhum bloqueio cadastrado</p>
          ) : (
            <div className="flex flex-col gap-2">
              {schedules.map(s => (
                <ScheduleRow
                  key={s.id}
                  schedule={s}
                  onDelete={() => handleDeleteSchedule(s.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────

export function AbaFuncionarios() {
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [saving, setSaving] = useState(false);
  const { success: toastSuccess, error: toastError } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [staff, specs] = await Promise.all([
        staffService.list(),
        specialtyService.list(),
      ]);
      setStaffList(staff);
      setSpecialties(specs);
    } catch {
      toastError("Erro ao carregar funcionários");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => { load(); }, [load]);

  async function handleSave(data: CreateStaffData) {
    setSaving(true);
    try {
      if (editingStaff) {
        const upd: UpdateStaffData = {
          name: data.name,
          role: data.role,
          specialty_ids: data.specialty_ids,
          days_of_week: data.days_of_week,
          work_start: data.work_start,
          work_end: data.work_end,
          lunch_start: data.lunch_start || null,
          lunch_end: data.lunch_end || null,
          work_hours_by_day: data.work_hours_by_day ?? null,
        };
        await staffService.update(editingStaff.id, upd);
        toastSuccess("Funcionário atualizado");
      } else {
        await staffService.create(data);
        toastSuccess("Funcionário criado");
      }
      setModalOpen(false);
      setEditingStaff(null);
      load();
    } catch {
      toastError("Erro ao salvar funcionário");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(id: string) {
    try {
      await staffService.deactivate(id);
      toastSuccess("Funcionário desativado");
      load();
    } catch {
      toastError("Erro ao desativar funcionário");
    }
  }

  function openEdit(staff: Staff) {
    setEditingStaff(staff);
    setModalOpen(true);
  }

  function openNew() {
    setEditingStaff(null);
    setModalOpen(true);
  }

  const initialForm: Partial<CreateStaffData> = editingStaff
    ? {
        name: editingStaff.name,
        role: editingStaff.role ?? "",
        specialty_ids: editingStaff.specialtyIds,
        days_of_week: editingStaff.daysOfWeek,
        work_start: fmt(editingStaff.workStart),
        work_end: fmt(editingStaff.workEnd),
        lunch_start: fmt(editingStaff.lunchStart) || undefined,
        lunch_end: fmt(editingStaff.lunchEnd) || undefined,
        work_hours_by_day: editingStaff.workHoursByDay ?? undefined,
      }
    : {};

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#1A2233] dark:text-white">Funcionários</h2>
          <p className="mt-0.5 text-sm text-[#727B8E]">
            Gerencie a equipe, jornada e bloqueios de cada profissional.
          </p>
        </div>
        <Button onClick={openNew} className="flex items-center gap-1.5">
          <Plus className="h-4 w-4" />
          Novo funcionário
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-[#727B8E]" />
        </div>
      ) : staffList.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#727B8E]/30 py-12 text-center dark:border-[#40485A]">
          <Calendar className="mx-auto mb-2 h-8 w-8 text-[#727B8E]/40" />
          <p className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
            Nenhum funcionário cadastrado
          </p>
          <p className="mt-1 text-xs text-[#727B8E]">
            Adicione os profissionais para ativar a agenda por funcionário.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {staffList.map(s => (
            <StaffCard
              key={s.id}
              staff={s}
              specialties={specialties}
              onEdit={() => openEdit(s)}
              onDeactivate={() => handleDeactivate(s.id)}
              onReactivate={() => openEdit(s)}
            />
          ))}
        </div>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setEditingStaff(null); }}
        title={editingStaff ? "Editar funcionário" : "Novo funcionário"}
        className="max-w-[520px]"
      >
        <StaffForm
          key={editingStaff?.id ?? "new"}
          initial={initialForm}
          specialties={specialties}
          onSave={handleSave}
          onCancel={() => { setModalOpen(false); setEditingStaff(null); }}
          saving={saving}
          title={editingStaff ? "Editar funcionário" : "Novo funcionário"}
        />
      </Modal>
    </div>
  );
}
