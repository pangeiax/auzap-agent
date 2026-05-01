'use client'
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { motion } from 'framer-motion'
import { DashboardLayout } from '@/components/templates/DashboardLayout'
import { Modal } from '@/components/molecules/Modal'
import { Button } from '@/components/atoms/Button'
import { Input } from '@/components/atoms/Input'
import { TextArea } from '@/components/atoms/TextArea'
import { useToast } from '@/hooks'
import { ClientCombobox } from '@/components/molecules/ClientCombobox'
import { PawPrint, Clock, LogIn, LogOut, Home, Loader2, AlertTriangle, Plus, ChevronDown, Eye, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { lodgingConfigService, lodgingReservationService, roomTypeService } from '@/services/lodgingService'
import type { LodgingReservation, LodgingType, LodgingConfig, RoomTypeAvailability, RoomType } from '@/services/lodgingService'
import { clientService } from '@/services'
import type { Client, Pet } from '@/types'

function formatDateBR(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (isNaN(d.getTime())) return String(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}

function careNotesToText(n: Record<string, unknown> | null | undefined): string {
  if (!n || typeof n !== 'object') return ''
  const o = n as Record<string, unknown>
  const keys = ['descricao', 'texto', 'observacoes', 'observations', 'description', 'notes'] as const
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  try {
    const s = JSON.stringify(n, null, 2)
    return s === '{}' ? '' : s
  } catch {
    return ''
  }
}

function getInitials(name: string): string {
  return name.trim().split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '—'
}

function daysFromNow(isoDate: string): number {
  // Evita problemas de timezone ao parsear YYYY-MM-DD
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const d = ymdToLocalDate(isoDate)
  d.setHours(12, 0, 0, 0)
  const diff = d.getTime() - today.getTime()
  return Math.ceil(diff / 86400000)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function ymdToLocalDate(ymd: string): Date {
  const s = String(ymd)
  // Normaliza entradas do tipo "YYYY-MM-DD" ou "YYYY-MM-DDTHH:mm:ss..."
  const normalized = s.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
  if (normalized) {
    const [y, m, d] = normalized.split('-').map(Number)
    const safeY = Number.isFinite(y) ? y : 1970
    const safeM = Number.isFinite(m) ? m : 1
    const safeD = Number.isFinite(d) ? d : 1
    return new Date(safeY, safeM - 1, safeD, 12, 0, 0, 0)
  }

  const parsed = new Date(s)
  if (isNaN(parsed.getTime())) return new Date(1970, 0, 1, 12, 0, 0, 0)
  return new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    12,
    0,
    0,
    0,
  )
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const dt = ymdToLocalDate(ymd)
  dt.setDate(dt.getDate() + deltaDays)
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
}

// checkout_date no backend é fim exclusivo do período (estilo hotel): o pet ocupa os dias
// [checkin, checkout). Para creche, o “último dia na creche” = dia anterior a checkout_date no calendário.

function getTodayYmd(): string {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function formatYmdToBR(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  if (!y || !m || !d) return '—'
  return `${d}/${m}/${y}`
}

function isoYmd(iso: string | Date | null | undefined): string {
  if (!iso) return ''
  const s = typeof iso === 'string' ? iso : iso.toISOString()
  return s.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? ''
}

/** Último dia civil em que o pet usa a creche (checkout no API é exclusivo). */
function lastCrecheDayYmd(checkoutYmd: string): string {
  return shiftYmd(checkoutYmd, -1)
}

function isDaycareSingleDiaria(res: LodgingReservation): boolean {
  if (res.type !== 'daycare') return false
  return isoYmd(res.checkin_date) === lastCrecheDayYmd(isoYmd(res.checkout_date))
}

function MiniDatePicker({
  label,
  value,
  minYmd,
  onChange,
  disabled,
}: {
  label: string
  value: string
  minYmd: string
  onChange: (ymd: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [viewMonth, setViewMonth] = useState<Date>(() => ymdToLocalDate(value || getTodayYmd()))

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (!rootRef.current) return
      if (rootRef.current.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selectedDate = value ? ymdToLocalDate(value) : null
  const monthStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1, 12, 0, 0, 0)
  const startWeekDay = monthStart.getDay() // 0..6 (Dom..Sáb)

  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0, 12, 0, 0, 0).getDate()
  const grid = Array.from({ length: 42 }, (_, idx) => {
    const dayNum = idx - startWeekDay + 1
    const dt = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), dayNum, 12, 0, 0, 0)
    const inMonth = dayNum >= 1 && dayNum <= daysInMonth
    const ymd = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
    const isBeforeMin = ymd < minYmd
    return { ymd, inMonth, isBeforeMin }
  })

  const monthLabel = viewMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  return (
    <div className="relative flex flex-col gap-3" ref={rootRef}>
      <p className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">{label}</p>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          setOpen((v) => !v)
        }}
        className="flex h-[47px] w-full items-center justify-between rounded-lg border border-[#727B8E]/20 bg-white px-3 text-sm text-[#434A57] dark:bg-[#212225] dark:border-[#40485A] dark:text-[#f5f9fc] hover:border-[#1E62EC]/40 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="truncate">{value ? formatYmdToBR(value) : 'Selecione...'}</span>
        <ChevronDown className={cn('h-4 w-4 text-[#727B8E] transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full rounded-xl border border-[#727B8E]/15 bg-white p-3 shadow-lg dark:border-[#40485A] dark:bg-[#1A1B1D]">
          <div className="mb-2 flex items-center justify-between px-1">
            <button
              type="button"
              className="rounded-lg border border-[#727B8E]/20 px-2 py-1 text-xs text-[#727B8E] dark:border-[#40485A]"
              onClick={() => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1, 12, 0, 0, 0))}
            >
              ←
            </button>
            <span className="text-xs font-semibold text-[#434A57] dark:text-[#f5f9fc]">{monthLabel}</span>
            <button
              type="button"
              className="rounded-lg border border-[#727B8E]/20 px-2 py-1 text-xs text-[#727B8E] dark:border-[#40485A]"
              onClick={() => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1, 12, 0, 0, 0))}
            >
              →
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 px-1">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => (
              <div key={d} className="text-center text-[10px] font-semibold text-[#727B8E]">
                {d}
              </div>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-7 gap-1 px-1">
            {grid.map((cell) => {
              const isSelected = value && cell.ymd === value
              return (
                <button
                  key={cell.ymd}
                  type="button"
                  disabled={cell.isBeforeMin || !cell.inMonth}
                  onClick={() => {
                    if (cell.isBeforeMin) return
                    onChange(cell.ymd)
                    setOpen(false)
                  }}
                  className={cn(
                    'h-8 rounded-lg border text-xs transition-colors',
                    cell.inMonth
                      ? 'border-[#727B8E]/10 bg-white dark:bg-[#212225]'
                      : 'border-transparent bg-transparent',
                    cell.isBeforeMin && 'opacity-40 cursor-not-allowed',
                    isSelected
                      ? 'border-[#1E62EC]/40 bg-[#1E62EC]/10 text-[#1E62EC]'
                      : !cell.isBeforeMin && cell.inMonth
                        ? 'text-[#434A57] hover:border-[#1E62EC]/40 hover:bg-[#1E62EC]/5 dark:text-[#f5f9fc]'
                        : 'text-[#727B8E]',
                  )}
                >
                  {Number(cell.ymd.split('-')[2])}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function PetCombobox({
  pets,
  value,
  onChange,
  placeholder = 'Selecione um pet',
  disabled,
  loading,
}: {
  pets: Pet[]
  value: string
  onChange: (petId: string) => void
  placeholder?: string
  disabled?: boolean
  loading?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return pets
    return pets.filter((p) => {
      const name = (p.name ?? '').toLowerCase()
      const species = (p.species ?? '').toLowerCase()
      const breed = (p.breed ?? '').toLowerCase()
      const size = (p.size ?? '').toLowerCase()
      const digits = q.replace(/\D/g, '')
      return name.includes(q) || species.includes(q) || breed.includes(q) || size.includes(q) || (digits && name.includes(digits))
    })
  }, [pets, query])

  const selected = useMemo(() => pets.find((p) => p.id === value) ?? null, [pets, value])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (!rootRef.current) return
      if (rootRef.current.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const labelForPet = (p: Pet) => {
    const bits = [p.name ?? 'Pet']
    if (p.species) bits.push(p.species)
    if (p.breed) bits.push(p.breed)
    if (p.size) bits.push(p.size)
    return bits.join(' · ')
  }

  return (
    <div className="flex flex-col gap-3" ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          if (loading) return
          setOpen((v) => !v)
          if (!open) setQuery('')
        }}
        className="relative flex h-[47px] w-full items-center justify-between rounded-lg border border-[#727B8E]/20 bg-white px-3 text-sm text-[#434A57] dark:bg-[#212225] dark:border-[#40485A] dark:text-[#f5f9fc] hover:border-[#1E62EC]/40 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="truncate">{value && selected ? labelForPet(selected) : placeholder}</span>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-[#727B8E]" />
        ) : (
          <ChevronDown className={cn('h-4 w-4 text-[#727B8E] transition-transform', open && 'rotate-180')} />
        )}
      </button>

      {open && !loading && (
        <div className="relative z-50 rounded-xl border border-[#727B8E]/15 bg-white p-2 shadow-lg dark:border-[#40485A] dark:bg-[#1A1B1D]">
          <input
            type="text"
            value={query}
            placeholder="Buscar pet..."
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg border border-[#727B8E]/20 bg-white px-3 py-2 text-sm text-[#434A57] outline-none focus:border-[#1E62EC] focus:ring-1 focus:ring-[#1E62EC]/20 dark:bg-[#212225] dark:border-[#40485A] dark:text-[#f5f9fc]"
          />
          <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-[#727B8E]/10">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-[#727B8E]">Nenhum pet encontrado</div>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={cn(
                    'w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[#F4F6F9] dark:hover:bg-[#212225]',
                    p.id === value && 'bg-[#1E62EC]/10',
                  )}
                  onClick={() => {
                    onChange(p.id)
                    setOpen(false)
                    setQuery('')
                  }}
                >
                  {labelForPet(p)}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Cards ────────────────────────────────────────────────────────────────────

function ReservadoCard({
  res,
  onCheckin,
  onOpenDetails,
  onCancelReservation,
  cancelLoadingId,
  config,
}: {
  res: LodgingReservation
  onCheckin: (r: LodgingReservation) => void
  onOpenDetails: (r: LodgingReservation) => void
  onCancelReservation?: (r: LodgingReservation) => void
  cancelLoadingId: string | null
  config: LodgingConfig | null
}) {
  const petName = res.pet_name ?? 'Pet'
  const daysToCheckin = daysFromNow(res.checkin_date)
  const urgent = daysToCheckin <= 0
  const soon = daysToCheckin === 1 || daysToCheckin === 0
  const cin = config?.daycare_checkin_time
  const cout = config?.daycare_checkout_time
  return (
    <div className={cn(
      'group flex items-start gap-3 rounded-xl border p-3 transition-colors',
      res.status === 'needs_reschedule'
        ? 'border-amber-200 dark:border-amber-800/50 bg-amber-50/60 dark:bg-amber-950/20'
        : urgent
        ? 'border-red-200 dark:border-red-800/30 bg-red-50/40 dark:bg-red-950/10'
        : 'border-[#727B8E]/10 dark:border-[#40485A] bg-white dark:bg-[#1A1B1D] hover:border-[#727B8E]/20'
    )}>
      <div className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
        res.status === 'needs_reschedule' ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-[#F4F6F9] dark:bg-[#212225]'
      )}>
        <span className={cn('text-sm font-bold', res.status === 'needs_reschedule' ? 'text-amber-600' : 'text-[#727B8E]')}>
          {getInitials(petName)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-bold text-[#434A57] dark:text-[#f5f9fc]">{petName}</p>
          {res.room_type_name && (
            <span className="rounded-full bg-[#8B5CF6]/10 dark:bg-[#8B5CF6]/20 px-2 py-0.5 text-[10px] font-semibold text-[#8B5CF6]">
              {res.room_type_name}
            </span>
          )}
          {res.status === 'needs_reschedule' && (
            <span className="flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-2.5 w-2.5" />Reagendar
            </span>
          )}
        </div>
        {(res.pet_breed || res.pet_size) && (
          <p className="text-xs text-[#727B8E]">{[res.pet_breed, res.pet_size].filter(Boolean).join(' · ')}</p>
        )}
        <p className="mt-0.5 text-xs text-[#727B8E]">{res.client_name ?? '—'}</p>
        <div className="mt-1 flex flex-col gap-0.5 text-xs text-[#727B8E]">
          <span>
            {res.type === 'daycare' ? 'Entrada' : 'Check-in'}:{' '}
            <span className="font-medium text-[#434A57] dark:text-[#f5f9fc]">{formatDateBR(res.checkin_date)}</span>
            {daysToCheckin === 0 ? <span className="ml-1 font-semibold text-green-600">(hoje)</span>
             : daysToCheckin === 1 ? <span className="ml-1 font-semibold text-blue-600">(amanhã)</span>
             : daysToCheckin > 0 ? <span className="ml-1">({daysToCheckin}d)</span>
             : <span className="ml-1 font-semibold text-red-500">({Math.abs(daysToCheckin)}d atraso)</span>}
          </span>
          {res.type === 'daycare' ? (
            isDaycareSingleDiaria(res) ? (
              <span>
                Dia na creche:{' '}
                <span className="font-medium text-[#434A57] dark:text-[#f5f9fc]">{formatYmdToBR(isoYmd(res.checkin_date))}</span>
                {cin && cout ? (
                  <span className="ml-1 text-[#727B8E]">· {cin} — {cout}</span>
                ) : null}
              </span>
            ) : (
              <span>
                Período:{' '}
                <span className="font-medium text-[#434A57] dark:text-[#f5f9fc]">
                  {formatYmdToBR(isoYmd(res.checkin_date))} a {formatYmdToBR(lastCrecheDayYmd(isoYmd(res.checkout_date)))}
                </span>
              </span>
            )
          ) : (
            <span>
              Saída: <span className="font-medium text-[#434A57] dark:text-[#f5f9fc]">{formatDateBR(res.checkout_date)}</span>
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onOpenDetails(res)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#727B8E]/20 bg-white px-2.5 py-1 text-[10px] font-semibold text-[#434A57] transition-colors hover:bg-[#F4F6F9] dark:border-[#40485A] dark:bg-[#212225] dark:text-[#f5f9fc] dark:hover:bg-[#2a2d36]"
          >
            <Eye className="h-3 w-3 shrink-0" aria-hidden />
            Ver detalhes
          </button>
          {onCancelReservation && (res.status === 'confirmed' || res.status === 'needs_reschedule') && (
            <button
              type="button"
              disabled={cancelLoadingId === res.id}
              onClick={() => onCancelReservation(res)}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:pointer-events-none disabled:opacity-60 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
            >
              {cancelLoadingId === res.id ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="h-3 w-3 shrink-0" aria-hidden />
              )}
              Cancelar reserva
            </button>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onCheckin(res)}
        className={cn(
          'shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
          soon
            ? 'bg-[#1E62EC] text-white hover:bg-[#1a55d4] shadow-sm'
            : 'bg-[#1E62EC]/10 text-[#1E62EC] hover:bg-[#1E62EC]/20'
        )}
      >
        <LogIn className="h-3.5 w-3.5" />
        Check-in
      </button>
    </div>
  )
}

function HospedadoCard({
  res,
  onCheckout,
  onOpenDetails,
  loadingId,
  config,
}: {
  res: LodgingReservation
  onCheckout: (r: LodgingReservation) => void
  onOpenDetails: (r: LodgingReservation) => void
  loadingId: string | null
  config: LodgingConfig | null
}) {
  const petName = res.pet_name ?? 'Pet'
  const lastDayYmd =
    res.type === 'daycare' ? lastCrecheDayYmd(isoYmd(res.checkout_date)) : isoYmd(res.checkout_date)
  const remaining = daysFromNow(lastDayYmd)
  const checkoutUrgent = remaining <= 0
  const cout = config?.daycare_checkout_time
  return (
    <div className={cn(
      'group flex items-start gap-3 rounded-xl border p-3 transition-colors',
      checkoutUrgent
        ? 'border-amber-200 dark:border-amber-800/30 bg-amber-50/40 dark:bg-amber-950/10'
        : 'border-[#727B8E]/10 dark:border-[#40485A] bg-white dark:bg-[#1A1B1D] hover:border-[#727B8E]/20'
    )}>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-green-100 dark:bg-green-950/30">
        <span className="text-sm font-bold text-green-600">{getInitials(petName)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-bold text-[#434A57] dark:text-[#f5f9fc]">{petName}</p>
          {res.room_type_name && (
            <span className="rounded-full bg-[#8B5CF6]/10 dark:bg-[#8B5CF6]/20 px-2 py-0.5 text-[10px] font-semibold text-[#8B5CF6]">
              {res.room_type_name}
            </span>
          )}
          {res.kennel_id && (
            <span className="rounded-full bg-[#727B8E]/10 px-2 py-0.5 text-[10px] font-semibold text-[#727B8E]">
              Vaga {res.kennel_id}
            </span>
          )}
        </div>
        {(res.pet_breed || res.pet_size) && (
          <p className="text-xs text-[#727B8E]">{[res.pet_breed, res.pet_size].filter(Boolean).join(' · ')}</p>
        )}
        <p className="mt-0.5 text-xs text-[#727B8E]">{res.client_name ?? '—'}</p>
        <div className="mt-1 flex flex-col gap-0.5 text-xs text-[#727B8E]">
          {res.type === 'daycare' ? (
            isDaycareSingleDiaria(res) ? (
              <span>
                Dia na creche:{' '}
                <span className="font-medium text-[#434A57] dark:text-[#f5f9fc]">{formatYmdToBR(isoYmd(res.checkin_date))}</span>
                {cout ? <span className="ml-1">· retirada até {cout}</span> : null}
                {remaining <= 0 ? <span className="ml-1 font-semibold text-amber-500">(hoje)</span>
                 : remaining === 1 ? <span className="ml-1 font-semibold text-amber-500">(amanhã)</span>
                 : <span className="ml-1">({remaining}d)</span>}
              </span>
            ) : (
              <span>
                Até{' '}
                <span className="font-medium text-[#434A57] dark:text-[#f5f9fc]">{formatYmdToBR(lastCrecheDayYmd(isoYmd(res.checkout_date)))}</span>
                {remaining <= 0 ? <span className="ml-1 font-semibold text-amber-500">(último dia hoje)</span>
                 : <span className="ml-1">({remaining}d no período)</span>}
              </span>
            )
          ) : (
            <span>
              Check-out: <span className="font-medium text-[#434A57] dark:text-[#f5f9fc]">{formatDateBR(res.checkout_date)}</span>
              {remaining <= 0 ? <span className="ml-1 font-semibold text-amber-500">(vence hoje)</span>
               : remaining === 1 ? <span className="ml-1 font-semibold text-amber-500">(1 dia)</span>
               : <span className="ml-1">({remaining}d restantes)</span>}
            </span>
          )}
        </div>
        <div className="mt-2">
          <button
            type="button"
            onClick={() => onOpenDetails(res)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#727B8E]/20 bg-white px-2.5 py-1 text-[10px] font-semibold text-[#434A57] transition-colors hover:bg-[#F4F6F9] dark:border-[#40485A] dark:bg-[#212225] dark:text-[#f5f9fc] dark:hover:bg-[#2a2d36]"
          >
            <Eye className="h-3 w-3 shrink-0" aria-hidden />
            Ver detalhes
          </button>
        </div>
      </div>
      <button
        type="button"
        disabled={loadingId === res.id}
        onClick={() => onCheckout(res)}
        className={cn(
          'shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50',
          checkoutUrgent
            ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm'
            : 'bg-green-50 dark:bg-green-950/20 text-green-600 hover:bg-green-100 dark:hover:bg-green-950/40'
        )}
      >
        {loadingId === res.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
        Check-out
      </button>
    </div>
  )
}

// ─── Skeleton primitives ─────────────────────────────────────────────────────

function Sk({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-lg bg-[#727B8E]/10 dark:bg-[#40485A]/40', className)} />
  )
}

function ReservationCardSkeleton() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[#727B8E]/10 dark:border-[#40485A] bg-white dark:bg-[#1A1B1D] p-3">
      <Sk className="h-11 w-11 shrink-0 rounded-xl" />
      <div className="flex-1 min-w-0 space-y-2">
        <Sk className="h-4 w-32" />
        <Sk className="h-3 w-20" />
        <Sk className="h-3 w-40" />
      </div>
      <Sk className="h-7 w-20 shrink-0 rounded-lg" />
    </div>
  )
}

function PageSkeleton() {
  return (
    <DashboardLayout>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#727B8E]/10 bg-white shadow-sm dark:border-[#40485A] dark:bg-[#1A1B1D] sm:p-6 p-4">
          <div className="flex flex-col gap-5">

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sk className="h-9 w-36 rounded-xl" />
                <Sk className="hidden sm:block h-7 w-[88px] rounded-lg" />
                <Sk className="hidden sm:block h-7 w-[88px] rounded-lg" />
              </div>
              <div className="flex items-center gap-2">
                <Sk className="h-[34px] w-36 rounded-lg" />
                <Sk className="h-9 w-32 rounded-lg" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(['border-[#1E62EC]/10', 'border-green-200/60 dark:border-green-800/20', 'border-transparent', 'border-[#727B8E]/10'] as const).map((border, i) => (
                <div key={i} className={cn('rounded-xl border p-3.5 bg-[#F4F6F9]/60 dark:bg-[#212225]/60', border)}>
                  <Sk className="h-3 w-28 mb-3" />
                  <Sk className="h-8 w-16" />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {[0, 1].map((col) => (
                <div key={col} className="flex flex-col overflow-hidden rounded-2xl border border-[#727B8E]/10 dark:border-[#40485A]">
                  <div className="flex items-center gap-3 border-b border-[#727B8E]/10 dark:border-[#40485A] bg-white dark:bg-[#1A1B1D] px-4 py-3.5">
                    <Sk className="h-8 w-8 shrink-0 rounded-lg" />
                    <div className="flex-1 space-y-1.5">
                      <Sk className="h-4 w-24" />
                      <Sk className="h-3 w-32" />
                    </div>
                    <Sk className="h-7 w-8 rounded-lg" />
                  </div>
                  <div className="bg-[#F4F6F9]/40 dark:bg-[#212225]/40 p-3 space-y-2">
                    {[0, 1, 2].map((j) => <ReservationCardSkeleton key={j} />)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function HotelCrechePage() {
  const toast = useToast()
  const [config, setConfig] = useState<LodgingConfig | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [activeTab, setActiveTab] = useState<LodgingType>('hotel')

  const [reservations, setReservations] = useState<LodgingReservation[]>([])
  const [loadingRes, setLoadingRes] = useState(false)

  // Check-in modal
  const [checkinTarget, setCheckinTarget] = useState<LodgingReservation | null>(null)
  const [kennelMode, setKennelMode] = useState<'auto' | 'manual'>('auto')
  const [autoKennel, setAutoKennel] = useState('')
  const [kennelInput, setKennelInput] = useState('')
  const [checkinLoading, setCheckinLoading] = useState(false)
  const [checkinError, setCheckinError] = useState('')

  // Check-out
  const [checkoutLoadingId, setCheckoutLoadingId] = useState<string | null>(null)
  const [checkoutTarget, setCheckoutTarget] = useState<LodgingReservation | null>(null)

  const [detailReservation, setDetailReservation] = useState<LodgingReservation | null>(null)
  const [cancelResLoadingId, setCancelResLoadingId] = useState<string | null>(null)

  // Nova reserva manual
  const [newResOpen, setNewResOpen] = useState(false)
  const [modalClients, setModalClients] = useState<Client[]>([])
  const [modalClientsLoading, setModalClientsLoading] = useState(false)
  const [selectedClientId, setSelectedClientId] = useState('')
  const [clientPets, setClientPets] = useState<Pet[]>([])
  const [clientPetsLoading, setClientPetsLoading] = useState(false)
  const [selectedPetId, setSelectedPetId] = useState('')
  const [newCheckinDate, setNewCheckinDate] = useState('')
  const [newCheckoutDate, setNewCheckoutDate] = useState('')
  const [newDailyRate, setNewDailyRate] = useState('')
  const [newEmergencyContact, setNewEmergencyContact] = useState('')
  const [newResNotes, setNewResNotes] = useState('')
  const [newResLoading, setNewResLoading] = useState(false)
  const [newResError, setNewResError] = useState('')
  const [roomTypeOptions, setRoomTypeOptions] = useState<RoomTypeAvailability[]>([])
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState('')
  const [loadingRoomTypes, setLoadingRoomTypes] = useState(false)

  // Filtro de tipo de quarto (painel principal)
  const [allRoomTypes, setAllRoomTypes] = useState<RoomType[]>([])
  const [selectedRoomTypeFilter, setSelectedRoomTypeFilter] = useState<string>('all')
  const [todayRoomAvailability, setTodayRoomAvailability] = useState<RoomTypeAvailability[]>([])
  const [loadingTabData, setLoadingTabData] = useState(false)

  const fetchConfig = useCallback(async () => {
    try {
      setLoadingConfig(true)
      const cfg = await lodgingConfigService.get()
      setConfig(cfg)
      // Set initial tab based on what's enabled
      if (!cfg.hotel_enabled && cfg.daycare_enabled) setActiveTab('daycare')
    } catch (err) {
      console.error('Erro ao carregar config hospedagem:', err)
    } finally {
      setLoadingConfig(false)
    }
  }, [])

  const fetchReservations = useCallback(async () => {
    try {
      setLoadingRes(true)
      const list = await lodgingReservationService.list({ status: 'confirmed,checked_in,needs_reschedule' })
      setReservations(list)
    } catch (err) {
      console.error('Erro ao carregar reservas:', err)
    } finally {
      setLoadingRes(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
    fetchReservations()
  }, [fetchConfig, fetchReservations])

  // Carrega tipos de quarto do painel e disponibilidade de hoje ao trocar de aba
  const fetchRoomTypesForTab = useCallback(async () => {
    setLoadingTabData(true)
    const today = getTodayYmd()
    const tomorrow = shiftYmd(today, 1)
    const [types, avail] = await Promise.all([
      roomTypeService.list({ lodging_type: activeTab, is_active: true }).catch(() => []),
      roomTypeService.getAvailability(activeTab, today, tomorrow).catch(() => []),
    ])
    setAllRoomTypes(types as RoomType[])
    setTodayRoomAvailability(avail as RoomTypeAvailability[])
    setSelectedRoomTypeFilter((prev) =>
      prev === 'all' || (types as RoomType[]).some((t) => t.id === prev) ? prev : 'all',
    )
    setLoadingTabData(false)
  }, [activeTab])

  useEffect(() => {
    setSelectedRoomTypeFilter('all')
    fetchRoomTypesForTab()
  }, [activeTab, fetchRoomTypesForTab])

  // Carrega tipos de quarto disponíveis quando datas mudam no modal
  useEffect(() => {
    if (!newResOpen || !newCheckinDate || !newCheckoutDate) {
      setRoomTypeOptions([])
      setSelectedRoomTypeId('')
      return
    }
    const checkoutForApi = activeTab === 'daycare' ? shiftYmd(newCheckoutDate, 1) : newCheckoutDate
    if (checkoutForApi <= newCheckinDate) return

    let cancelled = false
    setLoadingRoomTypes(true)
    roomTypeService
      .getAvailability(activeTab, newCheckinDate, checkoutForApi)
      .then((opts) => {
        if (cancelled) return
        setRoomTypeOptions(opts)
        const preferred = selectedRoomTypeFilter !== 'all'
          ? opts.find((o) => o.room_type_id === selectedRoomTypeFilter && o.available)
          : null
        const toSelect = preferred ?? opts.find((o) => o.available)
        setSelectedRoomTypeId(toSelect?.room_type_id ?? '')
        if (toSelect) setNewDailyRate(String(Number(toSelect.daily_rate).toFixed(2)))
      })
      .catch(() => { if (!cancelled) setRoomTypeOptions([]) })
      .finally(() => { if (!cancelled) setLoadingRoomTypes(false) })

    return () => { cancelled = true }
  }, [newResOpen, newCheckinDate, newCheckoutDate, activeTab])

  const currentRes = reservations.filter((r) => r.type === activeTab)
  const filteredRes = selectedRoomTypeFilter === 'all'
    ? currentRes
    : currentRes.filter((r) => r.room_type_id === selectedRoomTypeFilter)
  const reservados = filteredRes.filter((r) => r.status === 'confirmed' || r.status === 'needs_reschedule')
  const hospedados = filteredRes.filter((r) => r.status === 'checked_in')

  const computeAutoKennel = (target: LodgingReservation) => {
    const occupied = reservations
      .filter((r) => r.status === 'checked_in' && r.kennel_id && /^\d+$/.test(r.kennel_id) && r.type === target.type)
      .map((r) => parseInt(r.kennel_id!))
    return String(occupied.length > 0 ? Math.max(...occupied) + 1 : 1)
  }

  const handleOpenCheckin = (r: LodgingReservation) => {
    const auto = computeAutoKennel(r)
    setAutoKennel(auto)
    setKennelInput(auto)
    setKennelMode('auto')
    setCheckinError('')
    setCheckinTarget(r)
  }

  const handleConfirmCheckin = async () => {
    if (!checkinTarget) return
    const kennelId = kennelMode === 'auto' ? autoKennel : kennelInput.trim()
    if (!kennelId) { setCheckinError('Informe o identificador da vaga.'); return }

    if (kennelMode === 'manual') {
      const conflict = reservations.find(
        (r) => r.kennel_id === kennelId && r.status === 'checked_in' && r.id !== checkinTarget.id && r.type === checkinTarget.type &&
          ymdToLocalDate(r.checkin_date).getTime() < ymdToLocalDate(checkinTarget.checkout_date).getTime() &&
          ymdToLocalDate(r.checkout_date).getTime() > ymdToLocalDate(checkinTarget.checkin_date).getTime()
      )
      if (conflict) { setCheckinError('Esta vaga já está ocupada neste período.'); return }
    }

    // Não chamar checkAvailability aqui: essa métrica é para *novas* reservas. Com hotel no limite,
    // min_available_capacity fica 0 mesmo com vaga já reservada para este pet (confirmed conta na ocupação).

    setCheckinLoading(true)
    try {
      await lodgingReservationService.update(checkinTarget.id, { status: 'checked_in', kennel_id: kennelId })
      setCheckinTarget(null)
      await fetchReservations()
    } catch {
      setCheckinError('Erro ao fazer check-in. Tente novamente.')
    } finally {
      setCheckinLoading(false)
    }
  }

  const handleCheckout = async (r: LodgingReservation) => {
    setCheckoutLoadingId(r.id)
    try {
      await lodgingReservationService.update(r.id, { status: 'checked_out' })
      setCheckoutTarget(null)
      await fetchReservations()
    } catch (err) {
      console.error('Erro ao fazer check-out:', err)
    } finally {
      setCheckoutLoadingId(null)
    }
  }

  const handleCancelReservation = async (r: LodgingReservation) => {
    if (cancelResLoadingId) return
    setCancelResLoadingId(r.id)
    try {
      await lodgingReservationService.cancel(r.id)
      setDetailReservation((prev) => (prev?.id === r.id ? null : prev))
      await fetchReservations()
      toast.success('Reserva cancelada', 'A reserva foi removida da lista ativa.')
    } catch (err: unknown) {
      console.error('Erro ao cancelar reserva:', err)
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Não foi possível cancelar a reserva.'
      toast.error('Erro ao cancelar', msg)
    } finally {
      setCancelResLoadingId(null)
    }
  }

  const fetchModalClients = useCallback(async () => {
    try {
      setModalClientsLoading(true)
      const list = await clientService.listClients({ is_active: true })
      setModalClients(list)
    } catch {
      setModalClients([])
    } finally {
      setModalClientsLoading(false)
    }
  }, [])

  const handleSelectClientId = async (clientId: string) => {
    setSelectedClientId(clientId)
    setSelectedPetId('')
    setClientPets([])
    if (!clientId) return

    setClientPetsLoading(true)
    try {
      const pets = await clientService.getClientPets(clientId)
      setClientPets(pets)
      if (pets.length === 1) setSelectedPetId(pets[0].id)
    } catch {
      setClientPets([])
    } finally {
      setClientPetsLoading(false)
    }
  }

  const handleOpenNewRes = () => {
    setSelectedClientId('')
    setClientPets([])
    setSelectedPetId('')
    setClientPetsLoading(false)
    setNewDailyRate('')
    setNewEmergencyContact('')
    setNewResNotes('')
    setNewResError('')
    setRoomTypeOptions([])
    setSelectedRoomTypeId('')
    const today = getTodayYmd()
    const tomorrow = shiftYmd(today, 1)
    setNewCheckinDate(today)
    // Creche: segundo campo = último dia na creche (inclusivo); hotel: check-out exclusivo (dia após última noite).
    setNewCheckoutDate(activeTab === 'daycare' ? today : tomorrow)

    const rate = activeTab === 'hotel' ? config?.hotel_daily_rate : config?.daycare_daily_rate
    setNewDailyRate(rate ? String(Number(rate).toFixed(2)) : '')

    setNewResOpen(true)

    // Lazy-load dos clientes apenas quando abrir o modal
    if (modalClients.length === 0) fetchModalClients()
  }

  const handleCreateReservation = async () => {
    if (!selectedClientId) { setNewResError('Selecione um cliente.'); return }
    if (!selectedPetId) { setNewResError('Selecione um pet.'); return }
    if (!newCheckinDate) { setNewResError('Informe a data de check-in.'); return }
    if (!newCheckoutDate) {
      setNewResError(activeTab === 'daycare' ? 'Informe o último dia na creche.' : 'Informe a data de check-out.')
      return
    }

    const today = getTodayYmd()
    if (newCheckinDate < today) { setNewResError('Data de check-in não pode ser no passado.'); return }

    const checkoutForApi =
      activeTab === 'daycare' ? shiftYmd(newCheckoutDate, 1) : newCheckoutDate

    if (activeTab === 'daycare') {
      if (newCheckoutDate < newCheckinDate) {
        setNewResError('O último dia na creche não pode ser antes do primeiro dia.')
        return
      }
      if (newCheckoutDate < today) {
        setNewResError('O último dia na creche não pode ser no passado.')
        return
      }
    } else {
      if (newCheckoutDate < today) { setNewResError('Data de check-out não pode ser no passado.'); return }
      if (newCheckoutDate <= newCheckinDate) {
        setNewResError('A data de check-out deve ser após o check-in.')
        return
      }
    }

    if (roomTypeOptions.length > 0 && !selectedRoomTypeId) {
      setNewResError('Selecione um tipo de quarto.')
      return
    }

    const selectedOpt = roomTypeOptions.find((o) => o.room_type_id === selectedRoomTypeId)
    if (selectedOpt && !selectedOpt.available) {
      setNewResError('O tipo de quarto selecionado não possui vagas neste período.')
      return
    }

    setNewResLoading(true)
    setNewResError('')
    try {
      await lodgingReservationService.create({
        client_id: selectedClientId,
        pet_id: selectedPetId,
        type: activeTab,
        ...(selectedRoomTypeId ? { room_type_id: selectedRoomTypeId } : {}),
        checkin_date: newCheckinDate,
        checkout_date: checkoutForApi,
        ...(newDailyRate ? { daily_rate: Number(newDailyRate.replace(',', '.')) } : {}),
        ...(newEmergencyContact.trim() ? { emergency_contact: newEmergencyContact.trim() } : {}),
        ...(newResNotes.trim()
          ? { care_notes: { descricao: newResNotes.trim() } as Record<string, unknown> }
          : {}),
      })

      setNewResOpen(false)
      await fetchReservations()
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.detail ||
        'Erro ao criar reserva. Verifique os dados e tente novamente.'
      setNewResError(msg)
    } finally {
      setNewResLoading(false)
    }
  }

  // ── KPI computados com base no filtro de tipo de quarto ─────────────────────
  const kpiDiaria = (() => {
    if (allRoomTypes.length === 0) return '—'
    if (selectedRoomTypeFilter === 'all') {
      const rates = allRoomTypes.map((rt) => Number(rt.daily_rate))
      const min = Math.min(...rates)
      const max = Math.max(...rates)
      return min === max ? `R$ ${min.toFixed(2)}` : `R$ ${min.toFixed(2)}–${max.toFixed(2)}`
    }
    const rt = allRoomTypes.find((r) => r.id === selectedRoomTypeFilter)
    return rt ? `R$ ${Number(rt.daily_rate).toFixed(2)}` : '—'
  })()

  const kpiVagas = (() => {
    if (todayRoomAvailability.length === 0) return '—'
    if (selectedRoomTypeFilter === 'all') {
      return String(todayRoomAvailability.reduce((s, a) => s + a.available_capacity, 0))
    }
    const avail = todayRoomAvailability.find((a) => a.room_type_id === selectedRoomTypeFilter)
    return avail != null ? String(avail.available_capacity) : '—'
  })()

  if (loadingConfig) return <PageSkeleton />

  const noneEnabled = !config?.hotel_enabled && !config?.daycare_enabled

  if (noneEnabled) {
    return (
      <DashboardLayout>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#1E62EC]/10">
            <Home className="h-8 w-8 text-[#1E62EC]" />
          </div>
          <h2 className="text-lg font-semibold text-[#434A57] dark:text-[#f5f9fc]">Hospedagem não habilitada</h2>
          <p className="max-w-sm text-sm text-[#727B8E] dark:text-[#8a94a6]">
            Vá em Configurações → Hospedagem para habilitar o Hotel e/ou Creche.
          </p>
        </div>
      </DashboardLayout>
    )
  }

  const isHotel = activeTab === 'hotel'
  const accentBg = isHotel ? 'bg-[#8B5CF6]/10' : 'bg-amber-50 dark:bg-amber-950/20'
  const accentText = isHotel ? 'text-[#8B5CF6]' : 'text-amber-600 dark:text-amber-400'
  const todayYmd = getTodayYmd()

  return (
    <DashboardLayout>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#727B8E]/10 bg-white shadow-sm dark:border-[#40485A] dark:bg-[#1A1B1D] sm:p-6 p-4">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex gap-1 rounded-xl border border-[#727B8E]/10 dark:border-[#40485A] bg-[#F4F6F9] dark:bg-[#212225] p-1">
                  {config?.hotel_enabled && (
                    <button type="button" onClick={() => setActiveTab('hotel')}
                      className={cn('rounded-lg px-4 py-1.5 text-sm font-semibold transition-all',
                        activeTab === 'hotel' ? 'bg-[#8B5CF6] text-white shadow-sm' : 'text-[#727B8E] hover:text-[#434A57] dark:hover:text-[#f5f9fc]'
                      )}>Hotel</button>
                  )}
                  {config?.daycare_enabled && (
                    <button type="button" onClick={() => setActiveTab('daycare')}
                      className={cn('rounded-lg px-4 py-1.5 text-sm font-semibold transition-all',
                        activeTab === 'daycare' ? 'bg-amber-500 text-white shadow-sm' : 'text-[#727B8E] hover:text-[#434A57] dark:hover:text-[#f5f9fc]'
                      )}>Creche</button>
                  )}
                </div>

                <div className="hidden sm:flex items-center gap-2">
                  <span className="rounded-lg border border-[#727B8E]/10 bg-[#F4F6F9] dark:bg-[#212225] px-2.5 py-1 text-xs text-[#727B8E]">
                    Entrada: {isHotel ? config?.hotel_checkin_time : config?.daycare_checkin_time}
                  </span>
                  <span className="rounded-lg border border-[#727B8E]/10 bg-[#F4F6F9] dark:bg-[#212225] px-2.5 py-1 text-xs text-[#727B8E]">
                    Saída: {isHotel ? config?.hotel_checkout_time : config?.daycare_checkout_time}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {loadingTabData ? (
                  <Sk className="h-[34px] w-36 rounded-lg" />
                ) : allRoomTypes.length > 0 ? (
                  <select
                    value={selectedRoomTypeFilter}
                    onChange={(e) => setSelectedRoomTypeFilter(e.target.value)}
                    className="h-[34px] rounded-lg border border-[#727B8E]/20 bg-white dark:bg-[#212225] dark:border-[#40485A] px-2.5 text-xs text-[#434A57] dark:text-[#f5f9fc] focus:outline-none focus:border-[#1E62EC] cursor-pointer"
                  >
                    <option value="all">Todos os tipos</option>
                    {allRoomTypes.map((rt) => (
                      <option key={rt.id} value={rt.id}>{rt.name}</option>
                    ))}
                  </select>
                ) : null}
                <button
                  type="button"
                  onClick={handleOpenNewRes}
                  className="flex items-center gap-1.5 rounded-lg bg-[#1E62EC] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#1a55d4] transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Nova Reserva
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Aguardando check-in', value: loadingRes ? null : reservados.length, color: 'text-[#1E62EC]', bg: 'bg-[#1E62EC]/5 dark:bg-[#1E62EC]/10', border: 'border-[#1E62EC]/10' },
                { label: 'Hospedados agora', value: loadingRes ? null : hospedados.length, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-950/20', border: 'border-green-200 dark:border-green-800/30' },
                { label: 'Diária', value: loadingTabData ? null : kpiDiaria, color: accentText, bg: accentBg, border: 'border-transparent' },
                { label: 'Vagas restantes (hoje)', value: loadingTabData ? null : kpiVagas, color: 'text-[#434A57] dark:text-[#f5f9fc]', bg: 'bg-[#F4F6F9] dark:bg-[#212225]', border: 'border-[#727B8E]/10' },
              ].map((stat, i) => (
                <motion.div key={stat.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: i * 0.05 }}
                  className={cn('rounded-xl border p-3.5', stat.bg, stat.border)}>
                  <p className="text-[11px] font-medium text-[#727B8E] dark:text-[#8a94a6]">{stat.label}</p>
                  {stat.value === null
                    ? <Sk className="mt-2 h-8 w-16" />
                    : <p className={cn('mt-1.5 text-2xl font-bold truncate', stat.color)}>{stat.value}</p>
                  }
                </motion.div>
              ))}
            </div>

            {loadingRes ? (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {[0, 1].map((col) => (
                  <div key={col} className="flex flex-col overflow-hidden rounded-2xl border border-[#727B8E]/10 dark:border-[#40485A]">
                    <div className="flex items-center gap-3 border-b border-[#727B8E]/10 dark:border-[#40485A] bg-white dark:bg-[#1A1B1D] px-4 py-3.5">
                      <Sk className="h-8 w-8 shrink-0 rounded-lg" />
                      <div className="flex-1 space-y-1.5">
                        <Sk className="h-4 w-24" />
                        <Sk className="h-3 w-32" />
                      </div>
                      <Sk className="h-7 w-8 rounded-lg" />
                    </div>
                    <div className="bg-[#F4F6F9]/40 dark:bg-[#212225]/40 p-3 space-y-2">
                      {[0, 1, 2].map((j) => <ReservationCardSkeleton key={j} />)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}
                  className="flex flex-col overflow-hidden rounded-2xl border border-[#727B8E]/10 dark:border-[#40485A]">
                  <div className="flex items-center gap-3 border-b border-[#727B8E]/10 dark:border-[#40485A] bg-white dark:bg-[#1A1B1D] px-4 py-3.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1E62EC]/10">
                      <Clock className="h-4 w-4 text-[#1E62EC]" strokeWidth={2.5} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-bold text-[#434A57] dark:text-[#f5f9fc]">Reservados</h3>
                      <p className="text-xs text-[#727B8E]">Aguardando check-in</p>
                    </div>
                    <span className={cn('rounded-lg px-2.5 py-1 text-sm font-bold',
                      reservados.length > 0 ? 'bg-[#1E62EC]/10 text-[#1E62EC]' : 'bg-[#F4F6F9] dark:bg-[#212225] text-[#727B8E]'
                    )}>{reservados.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto bg-[#F4F6F9]/40 dark:bg-[#212225]/40 p-3 space-y-2">
                    {reservados.length === 0 ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
                        <PawPrint className="h-9 w-9 text-[#727B8E]/30" />
                        <p className="text-sm text-[#727B8E]">Nenhuma reserva pendente</p>
                      </div>
                    ) : (
                      reservados.map((r) => (
                        <ReservadoCard
                          key={r.id}
                          res={r}
                          onCheckin={handleOpenCheckin}
                          onOpenDetails={setDetailReservation}
                          onCancelReservation={handleCancelReservation}
                          cancelLoadingId={cancelResLoadingId}
                          config={config}
                        />
                      ))
                    )}
                  </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.15 }}
                  className="flex flex-col overflow-hidden rounded-2xl border border-[#727B8E]/10 dark:border-[#40485A]">
                  <div className="flex items-center gap-3 border-b border-[#727B8E]/10 dark:border-[#40485A] bg-white dark:bg-[#1A1B1D] px-4 py-3.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-100 dark:bg-green-950/30">
                      <Home className="h-4 w-4 text-green-600" strokeWidth={2.5} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-bold text-[#434A57] dark:text-[#f5f9fc]">Hospedados</h3>
                      <p className="text-xs text-[#727B8E]">Em estadia agora</p>
                    </div>
                    <span className={cn('rounded-lg px-2.5 py-1 text-sm font-bold',
                      hospedados.length > 0 ? 'bg-green-100 dark:bg-green-950/30 text-green-600 dark:text-green-400' : 'bg-[#F4F6F9] dark:bg-[#212225] text-[#727B8E]'
                    )}>{hospedados.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto bg-[#F4F6F9]/40 dark:bg-[#212225]/40 p-3 space-y-2">
                    {hospedados.length === 0 ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
                        <PawPrint className="h-9 w-9 text-[#727B8E]/30" />
                        <p className="text-sm text-[#727B8E]">Nenhum pet hospedado</p>
                      </div>
                    ) : (
                      hospedados.map((r) => (
                        <HospedadoCard
                          key={r.id}
                          res={r}
                          onCheckout={(x) => setCheckoutTarget(x)}
                          onOpenDetails={setDetailReservation}
                          loadingId={checkoutLoadingId}
                          config={config}
                        />
                      ))
                    )}
                  </div>
                </motion.div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        isOpen={detailReservation !== null}
        onClose={() => setDetailReservation(null)}
        title="Detalhes da hospedagem"
        className="max-w-[440px]"
      >
        {detailReservation && (
          <div className="flex flex-col gap-3 text-sm text-[#434A57] dark:text-[#f5f9fc]">
            <div className="rounded-lg bg-[#F4F6F9] dark:bg-[#212225] p-3 space-y-2">
              <p className="font-semibold">{detailReservation.pet_name ?? 'Pet'}</p>
              <p className="text-xs text-[#727B8E]">{detailReservation.client_name ?? '—'}</p>
              {detailReservation.phone_client && (
                <p className="text-xs text-[#727B8E]">Tel. {detailReservation.phone_client}</p>
              )}
              <p className="text-xs">
                <span className="font-medium">{detailReservation.type === 'hotel' ? 'Hotel' : 'Creche'}</span>
                {detailReservation.room_type_name ? ` · ${detailReservation.room_type_name}` : ''}
              </p>
              <p className="text-xs text-[#727B8E]">
                Entrada {formatDateBR(detailReservation.checkin_date)}
                {' → '}
                Saída {formatDateBR(detailReservation.checkout_date)}
              </p>
              {detailReservation.kennel_id && (
                <p className="text-xs">Vaga: <span className="font-medium">{detailReservation.kennel_id}</span></p>
              )}
              {detailReservation.emergency_contact && (
                <p className="text-xs">Emergência: {detailReservation.emergency_contact}</p>
              )}
              {detailReservation.total_amount != null && (
                <p className="text-xs">Total: R$ {Number(detailReservation.total_amount).toFixed(2)}</p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[#727B8E] dark:text-[#8a94a6] mb-1">
                Descrição / cuidados
              </p>
              {careNotesToText(detailReservation.care_notes as Record<string, unknown>) ? (
                <p className="whitespace-pre-wrap text-sm">{careNotesToText(detailReservation.care_notes as Record<string, unknown>)}</p>
              ) : (
                <p className="text-xs text-[#727B8E]">Nenhuma descrição registrada.</p>
              )}
            </div>
            {(detailReservation.status === 'confirmed' || detailReservation.status === 'needs_reschedule') && (
              <div className="flex justify-end pt-1">
                <Button
                  variant="outline"
                  className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800/50 dark:text-red-400 dark:hover:bg-red-950/30"
                  disabled={cancelResLoadingId === detailReservation.id}
                  onClick={() => handleCancelReservation(detailReservation)}
                >
                  {cancelResLoadingId === detailReservation.id ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Cancelando...
                    </>
                  ) : (
                    'Cancelar reserva'
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal isOpen={!!checkinTarget} onClose={() => setCheckinTarget(null)} title="Fazer Check-in" className="max-w-[420px]">
        {checkinTarget && (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg bg-[#F4F6F9] dark:bg-[#212225] p-3 text-sm">
              <p className="font-semibold text-[#434A57] dark:text-[#f5f9fc]">{checkinTarget.pet_name}</p>
              <p className="text-[#727B8E]">{checkinTarget.client_name}</p>
              {checkinTarget.type === 'daycare' ? (
                isDaycareSingleDiaria(checkinTarget) ? (
                  <p className="text-[#727B8E]">
                    <span className="font-medium text-[#434A57] dark:text-[#f5f9fc]">Dia na creche:</span>{' '}
                    {formatYmdToBR(isoYmd(checkinTarget.checkin_date))}
                    {config?.daycare_checkin_time && config?.daycare_checkout_time
                      ? ` · ${config.daycare_checkin_time} — ${config.daycare_checkout_time}`
                      : null}
                  </p>
                ) : (
                  <p className="text-[#727B8E]">
                    <span className="font-medium text-[#434A57] dark:text-[#f5f9fc]">Período:</span>{' '}
                    {formatYmdToBR(isoYmd(checkinTarget.checkin_date))} a{' '}
                    {formatYmdToBR(lastCrecheDayYmd(isoYmd(checkinTarget.checkout_date)))}
                  </p>
                )
              ) : (
                <p className="text-[#727B8E]">{formatDateBR(checkinTarget.checkin_date)} → {formatDateBR(checkinTarget.checkout_date)}</p>
              )}
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">Identificador da vaga</p>
              <div className="mb-3 flex gap-2">
                <button type="button" onClick={() => { setKennelMode('auto'); setKennelInput(autoKennel) }}
                  className={cn('rounded-lg px-3 py-1.5 text-sm font-medium transition-colors border',
                    kennelMode === 'auto' ? 'bg-[#1E62EC] text-white border-[#1E62EC]' : 'border-[#727B8E]/20 text-[#727B8E] hover:border-[#1E62EC]'
                  )}>Automático</button>
                <button type="button" onClick={() => setKennelMode('manual')}
                  className={cn('rounded-lg px-3 py-1.5 text-sm font-medium transition-colors border',
                    kennelMode === 'manual' ? 'bg-[#1E62EC] text-white border-[#1E62EC]' : 'border-[#727B8E]/20 text-[#727B8E] hover:border-[#1E62EC]'
                  )}>Manual</button>
              </div>
              {kennelMode === 'auto' ? (
                <div className="rounded-lg border border-[#727B8E]/20 bg-[#F4F6F9] dark:bg-[#212225] px-3 py-2 text-sm text-[#434A57] dark:text-[#f5f9fc]">
                  Vaga {autoKennel}
                </div>
              ) : (
                <Input placeholder="Ex: 3, Suite 1, Quarto VIP..." value={kennelInput} onChange={(e) => setKennelInput(e.target.value)} />
              )}
              {checkinError && <p className="mt-1 text-xs text-red-500">{checkinError}</p>}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCheckinTarget(null)} disabled={checkinLoading}>Cancelar</Button>
              <Button onClick={handleConfirmCheckin} disabled={checkinLoading}>
                {checkinLoading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Fazendo check-in...</> : 'Confirmar check-in'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={newResOpen} onClose={() => setNewResOpen(false)} title={`Nova Reserva — ${activeTab === 'hotel' ? 'Hotel' : 'Creche'}`} className="max-w-[480px]">
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-1.5 text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">Cliente</p>
            {modalClientsLoading ? (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#727B8E]/20 bg-[#F4F6F9] p-3 dark:border-[#40485A] dark:bg-[#212225]">
                <Loader2 className="h-4 w-4 animate-spin text-[#1E62EC]" />
                <span className="text-sm text-[#727B8E]">Carregando clientes...</span>
              </div>
            ) : (
              <ClientCombobox
                clients={modalClients}
                value={selectedClientId}
                onChange={handleSelectClientId}
                placeholder="Buscar ou selecionar cliente…"
                disabled={newResLoading}
              />
            )}
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">Pet</p>
            {!selectedClientId ? (
              <p className="mt-3 text-sm text-[#727B8E]">Selecione um cliente para ver os pets.</p>
            ) : clientPetsLoading ? (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#727B8E]/20 bg-[#F4F6F9] p-3 dark:border-[#40485A] dark:bg-[#212225]">
                <Loader2 className="h-4 w-4 animate-spin text-[#1E62EC]" />
                <span className="text-sm text-[#727B8E]">Carregando pets do cliente...</span>
              </div>
            ) : clientPets.length === 0 ? (
              <p className="mt-3 text-sm text-[#727B8E]">Nenhum pet cadastrado para este cliente.</p>
            ) : (
              <PetCombobox
                pets={clientPets}
                value={selectedPetId}
                onChange={setSelectedPetId}
                placeholder="Selecione um pet..."
                disabled={newResLoading}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <MiniDatePicker
              label={activeTab === 'daycare' ? 'Primeiro dia na creche' : 'Check-in'}
              value={newCheckinDate}
              minYmd={todayYmd}
              disabled={newResLoading}
              onChange={(ymd) => {
                setNewCheckinDate(ymd)
                setNewCheckoutDate((prev) => {
                  if (!prev) return prev
                  if (activeTab === 'daycare') {
                    return prev < ymd ? ymd : prev
                  }
                  const minCheckout = shiftYmd(ymd, 1)
                  return prev <= ymd ? minCheckout : prev
                })
              }}
            />
            <MiniDatePicker
              label={activeTab === 'daycare' ? 'Último dia na creche' : 'Check-out'}
              value={newCheckoutDate}
              minYmd={activeTab === 'daycare' ? (newCheckinDate || todayYmd) : shiftYmd(newCheckinDate || todayYmd, 1)}
              disabled={newResLoading}
              onChange={setNewCheckoutDate}
            />
          </div>
          {activeTab === 'daycare' && (
            <p className="text-xs leading-relaxed text-[#727B8E]">
              Selecione o período em dias corridos (pode ser o mesmo dia para uma diária). O cadastro envia automaticamente
              o dia seguinte ao último dia como fim do período no sistema. Horários: {config?.daycare_checkin_time ?? '—'} —{' '}
              {config?.daycare_checkout_time ?? '—'}.
            </p>
          )}

          {newCheckinDate && newCheckoutDate && (
            <div>
              <p className="mb-1.5 text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">Tipo de quarto</p>
              {loadingRoomTypes ? (
                <div className="flex items-center gap-2 rounded-lg border border-[#727B8E]/20 bg-[#F4F6F9] p-3 dark:border-[#40485A] dark:bg-[#212225]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#1E62EC]" />
                  <span className="text-sm text-[#727B8E]">Verificando disponibilidade...</span>
                </div>
              ) : roomTypeOptions.length === 0 ? (
                <p className="rounded-lg bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                  Nenhum tipo de quarto configurado. Configure em Configurações → Hospedagem.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {roomTypeOptions.map((opt) => (
                    <button
                      key={opt.room_type_id}
                      type="button"
                      disabled={!opt.available || newResLoading}
                      onClick={() => {
                        setSelectedRoomTypeId(opt.room_type_id)
                        setNewDailyRate(String(Number(opt.daily_rate).toFixed(2)))
                      }}
                      className={cn(
                        'flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors text-left',
                        selectedRoomTypeId === opt.room_type_id
                          ? 'border-[#1E62EC] bg-[#1E62EC]/5'
                          : opt.available
                          ? 'border-[#727B8E]/20 hover:border-[#1E62EC]/40 dark:border-[#40485A]'
                          : 'border-[#727B8E]/10 opacity-50 cursor-not-allowed',
                      )}
                    >
                      <div>
                        <span className={cn('font-medium', selectedRoomTypeId === opt.room_type_id ? 'text-[#1E62EC]' : 'text-[#434A57] dark:text-[#f5f9fc]')}>
                          {opt.room_type_name}
                        </span>
                        {!opt.available && <span className="ml-2 text-xs text-red-500">Sem vagas</span>}
                        {opt.available && opt.available_capacity <= 2 && (
                          <span className="ml-2 text-xs text-amber-500">Últimas {opt.available_capacity} vaga(s)</span>
                        )}
                      </div>
                      <div className="text-right ml-3 shrink-0">
                        <p className={cn('font-semibold', selectedRoomTypeId === opt.room_type_id ? 'text-[#1E62EC]' : 'text-[#434A57] dark:text-[#f5f9fc]')}>
                          R$ {Number(opt.daily_rate).toFixed(2)}/dia
                        </p>
                        <p className="text-xs text-[#727B8E]">
                          Total: R$ {Number(opt.total_amount).toFixed(2)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <p className="mb-1.5 text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">Valor da diária (opcional)</p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#727B8E]">R$</span>
              <Input
                type="text"
                placeholder="0,00"
                value={newDailyRate}
                onChange={(e) => setNewDailyRate(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">Contato de emergência (opcional)</p>
            <Input
              placeholder="Ex: João — (11) 99999-9999"
              value={newEmergencyContact}
              onChange={(e) => setNewEmergencyContact(e.target.value)}
            />
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">Descrição / observações (opcional)</p>
            <TextArea
              rows={3}
              placeholder="Cuidados especiais, alimentação, medicamentos, preferências..."
              value={newResNotes}
              onChange={(e) => setNewResNotes(e.target.value)}
              disabled={newResLoading}
            />
          </div>

          {newResError && (
            <p className="rounded-lg bg-red-50 dark:bg-red-950/20 px-3 py-2 text-xs text-red-600 dark:text-red-400">{newResError}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNewResOpen(false)} disabled={newResLoading}>Cancelar</Button>
            <Button onClick={handleCreateReservation} disabled={newResLoading}>
              {newResLoading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Salvando...</> : 'Criar Reserva'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!checkoutTarget} onClose={() => setCheckoutTarget(null)} title="Fazer Check-out" className="max-w-[400px]">
        {checkoutTarget && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
              Confirmar check-out de <span className="font-semibold text-[#434A57] dark:text-[#f5f9fc]">{checkoutTarget.pet_name}</span>?
              A estadia será encerrada e o pet liberado.
            </p>
            {checkoutTarget.type === 'daycare' && isDaycareSingleDiaria(checkoutTarget) && (
              <p className="text-xs text-[#727B8E]">
                Creche no dia {formatYmdToBR(isoYmd(checkoutTarget.checkin_date))}
                {config?.daycare_checkout_time ? ` · retirada até ${config.daycare_checkout_time}` : null}.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCheckoutTarget(null)} disabled={!!checkoutLoadingId}>Cancelar</Button>
              <Button onClick={() => handleCheckout(checkoutTarget)} disabled={!!checkoutLoadingId}
                className="bg-green-600 hover:bg-green-700 text-white">
                {checkoutLoadingId === checkoutTarget.id ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saindo...</> : 'Confirmar check-out'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  )
}
