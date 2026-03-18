'use client'
import { useState, useCallback, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { DashboardLayout } from '@/components/templates/DashboardLayout'
import { Modal } from '@/components/molecules/Modal'
import { Button } from '@/components/atoms/Button'
import { Input } from '@/components/atoms/Input'
import { PawPrint, Clock, LogIn, LogOut, Home, Loader2, AlertTriangle, Plus, Search, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { lodgingConfigService, lodgingReservationService } from '@/services/lodgingService'
import type { LodgingReservation, LodgingType, LodgingConfig } from '@/services/lodgingService'
import { clientService } from '@/services'
import type { Client, Pet } from '@/types'

function formatDateBR(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (isNaN(d.getTime())) return String(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}

function getInitials(name: string): string {
  return name.trim().split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '—'
}

function daysFromNow(isoDate: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(isoDate); d.setHours(0, 0, 0, 0)
  return Math.ceil((d.getTime() - today.getTime()) / 86400000)
}

// ─── Cards ────────────────────────────────────────────────────────────────────

function ReservadoCard({ res, onCheckin }: { res: LodgingReservation; onCheckin: (r: LodgingReservation) => void }) {
  const petName = res.pet_name ?? 'Pet'
  const daysToCheckin = daysFromNow(res.checkin_date)
  const urgent = daysToCheckin <= 0
  const soon = daysToCheckin === 1 || daysToCheckin === 0
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
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[#727B8E]">
          <span>
            Check-in: <span className="font-medium text-[#434A57] dark:text-[#f5f9fc]">{formatDateBR(res.checkin_date)}</span>
            {daysToCheckin === 0 ? <span className="ml-1 font-semibold text-green-600">(hoje)</span>
             : daysToCheckin === 1 ? <span className="ml-1 font-semibold text-blue-600">(amanhã)</span>
             : daysToCheckin > 0 ? <span className="ml-1">({daysToCheckin}d)</span>
             : <span className="ml-1 font-semibold text-red-500">({Math.abs(daysToCheckin)}d atraso)</span>}
          </span>
          <span>Saída: <span className="font-medium text-[#434A57] dark:text-[#f5f9fc]">{formatDateBR(res.checkout_date)}</span></span>
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

function HospedadoCard({ res, onCheckout, loadingId }: { res: LodgingReservation; onCheckout: (r: LodgingReservation) => void; loadingId: string | null }) {
  const petName = res.pet_name ?? 'Pet'
  const remaining = daysFromNow(res.checkout_date)
  const checkoutUrgent = remaining <= 0
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
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[#727B8E]">
          <span>
            Check-out: <span className="font-medium text-[#434A57] dark:text-[#f5f9fc]">{formatDateBR(res.checkout_date)}</span>
            {remaining <= 0 ? <span className="ml-1 font-semibold text-amber-500">(vence hoje)</span>
             : remaining === 1 ? <span className="ml-1 font-semibold text-amber-500">(1 dia)</span>
             : <span className="ml-1">({remaining}d restantes)</span>}
          </span>
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function HotelCrechePage() {
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

  // Nova reserva manual
  const [newResOpen, setNewResOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Client[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [clientPets, setClientPets] = useState<Pet[]>([])
  const [selectedPetId, setSelectedPetId] = useState('')
  const [newCheckinDate, setNewCheckinDate] = useState('')
  const [newCheckoutDate, setNewCheckoutDate] = useState('')
  const [newDailyRate, setNewDailyRate] = useState('')
  const [newEmergencyContact, setNewEmergencyContact] = useState('')
  const [newResLoading, setNewResLoading] = useState(false)
  const [newResError, setNewResError] = useState('')
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const currentRes = reservations.filter((r) => r.type === activeTab)
  const reservados = currentRes.filter((r) => r.status === 'confirmed' || r.status === 'needs_reschedule')
  const hospedados = currentRes.filter((r) => r.status === 'checked_in')

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
          new Date(r.checkin_date) < new Date(checkinTarget.checkout_date) &&
          new Date(r.checkout_date) > new Date(checkinTarget.checkin_date)
      )
      if (conflict) { setCheckinError('Esta vaga já está ocupada neste período.'); return }
    }

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

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    setSelectedClient(null)
    setClientPets([])
    setSelectedPetId('')
    if (searchRef.current) clearTimeout(searchRef.current)
    if (!value.trim()) { setSearchResults([]); setShowDropdown(false); return }
    setSearchLoading(true)
    searchRef.current = setTimeout(async () => {
      try {
        const results = await clientService.searchClients(value, 8)
        setSearchResults(results)
        setShowDropdown(true)
      } catch { setSearchResults([]) } finally { setSearchLoading(false) }
    }, 350)
  }

  const handleSelectClient = async (client: Client) => {
    setSelectedClient(client)
    setSearchQuery(client.name ?? '')
    setShowDropdown(false)
    setSelectedPetId('')
    try {
      const pets = await clientService.getClientPets(client.id)
      setClientPets(pets)
      if (pets.length === 1) setSelectedPetId(pets[0].id)
    } catch { setClientPets([]) }
  }

  const handleOpenNewRes = () => {
    setSearchQuery('')
    setSearchResults([])
    setShowDropdown(false)
    setSelectedClient(null)
    setClientPets([])
    setSelectedPetId('')
    const today = new Date().toISOString().slice(0, 10)
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    setNewCheckinDate(today)
    setNewCheckoutDate(tomorrow)
    const rate = activeTab === 'hotel' ? config?.hotel_daily_rate : config?.daycare_daily_rate
    setNewDailyRate(rate ? String(Number(rate).toFixed(2)) : '')
    setNewEmergencyContact('')
    setNewResError('')
    setNewResOpen(true)
  }

  const handleCreateReservation = async () => {
    if (!selectedClient) { setNewResError('Selecione um cliente.'); return }
    if (!selectedPetId) { setNewResError('Selecione um pet.'); return }
    if (!newCheckinDate) { setNewResError('Informe a data de check-in.'); return }
    if (!newCheckoutDate) { setNewResError('Informe a data de check-out.'); return }
    if (newCheckoutDate <= newCheckinDate) { setNewResError('A data de check-out deve ser após o check-in.'); return }
    setNewResLoading(true)
    setNewResError('')
    try {
      await lodgingReservationService.create({
        client_id: selectedClient.id,
        pet_id: selectedPetId,
        type: activeTab,
        checkin_date: newCheckinDate,
        checkout_date: newCheckoutDate,
        ...(newDailyRate ? { daily_rate: Number(newDailyRate.replace(',', '.')) } : {}),
        ...(newEmergencyContact.trim() ? { emergency_contact: newEmergencyContact.trim() } : {}),
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

  if (loadingConfig) {
    return (
      <DashboardLayout>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#1E62EC]" />
        </div>
      </DashboardLayout>
    )
  }

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

  return (
    <DashboardLayout>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#727B8E]/10 bg-white shadow-sm dark:border-[#40485A] dark:bg-[#1A1B1D] sm:p-6 p-4">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">

            {/* ─── Header ─── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {/* Tabs Hotel / Creche */}
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

                {/* Rate + check-in info pills */}
                <div className="hidden sm:flex items-center gap-2">
                  {(isHotel ? config?.hotel_daily_rate : config?.daycare_daily_rate) && (
                    <span className={cn('rounded-lg border px-2.5 py-1 text-xs font-medium', accentBg, accentText, 'border-transparent')}>
                      R$ {Number(isHotel ? config?.hotel_daily_rate : config?.daycare_daily_rate).toFixed(2)}/dia
                    </span>
                  )}
                  <span className="rounded-lg border border-[#727B8E]/10 bg-[#F4F6F9] dark:bg-[#212225] px-2.5 py-1 text-xs text-[#727B8E]">
                    Entrada: {isHotel ? config?.hotel_checkin_time : config?.daycare_checkin_time}
                  </span>
                  <span className="rounded-lg border border-[#727B8E]/10 bg-[#F4F6F9] dark:bg-[#212225] px-2.5 py-1 text-xs text-[#727B8E]">
                    Saída: {isHotel ? config?.hotel_checkout_time : config?.daycare_checkout_time}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleOpenNewRes}
                className="flex items-center gap-1.5 rounded-lg bg-[#1E62EC] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#1a55d4] transition-colors"
              >
                <Plus className="h-4 w-4" />
                Nova Reserva
              </button>
            </div>

            {/* ─── Stats bar ─── */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Aguardando check-in', value: reservados.length, color: 'text-[#1E62EC]', bg: 'bg-[#1E62EC]/5 dark:bg-[#1E62EC]/10', border: 'border-[#1E62EC]/10' },
                { label: 'Hospedados agora', value: hospedados.length, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-950/20', border: 'border-green-200 dark:border-green-800/30' },
                { label: 'Diária', value: (isHotel ? config?.hotel_daily_rate : config?.daycare_daily_rate) ? `R$ ${Number(isHotel ? config?.hotel_daily_rate : config?.daycare_daily_rate).toFixed(2)}` : '—', color: accentText, bg: accentBg, border: 'border-transparent' },
                { label: 'Horário de entrada', value: isHotel ? config?.hotel_checkin_time : config?.daycare_checkin_time, color: 'text-[#434A57] dark:text-[#f5f9fc]', bg: 'bg-[#F4F6F9] dark:bg-[#212225]', border: 'border-[#727B8E]/10' },
              ].map((stat, i) => (
                <motion.div key={stat.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: i * 0.05 }}
                  className={cn('rounded-xl border p-3.5', stat.bg, stat.border)}>
                  <p className="text-[11px] font-medium text-[#727B8E] dark:text-[#8a94a6]">{stat.label}</p>
                  <p className={cn('mt-1.5 text-2xl font-bold', stat.color)}>{stat.value}</p>
                </motion.div>
              ))}
            </div>

            {/* ─── Two-column reservation lists ─── */}
            {loadingRes ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-[#1E62EC]" />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {/* Reservados */}
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
                      reservados.map((r) => <ReservadoCard key={r.id} res={r} onCheckin={handleOpenCheckin} />)
                    )}
                  </div>
                </motion.div>

                {/* Hospedados */}
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
                      hospedados.map((r) => <HospedadoCard key={r.id} res={r} onCheckout={(r) => setCheckoutTarget(r)} loadingId={checkoutLoadingId} />)
                    )}
                  </div>
                </motion.div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Check-in Modal */}
      <Modal isOpen={!!checkinTarget} onClose={() => setCheckinTarget(null)} title="Fazer Check-in" className="max-w-[420px]">
        {checkinTarget && (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg bg-[#F4F6F9] dark:bg-[#212225] p-3 text-sm">
              <p className="font-semibold text-[#434A57] dark:text-[#f5f9fc]">{checkinTarget.pet_name}</p>
              <p className="text-[#727B8E]">{checkinTarget.client_name}</p>
              <p className="text-[#727B8E]">{formatDateBR(checkinTarget.checkin_date)} → {formatDateBR(checkinTarget.checkout_date)}</p>
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

      {/* Nova Reserva Manual Modal */}
      <Modal isOpen={newResOpen} onClose={() => setNewResOpen(false)} title={`Nova Reserva — ${activeTab === 'hotel' ? 'Hotel' : 'Creche'}`} className="max-w-[480px]">
        <div className="flex flex-col gap-4">
          {/* Busca de cliente */}
          <div className="relative">
            <p className="mb-1.5 text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">Cliente</p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#727B8E]" />
              <input
                type="text"
                placeholder="Buscar cliente por nome ou telefone..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                className="w-full rounded-lg border border-[#727B8E]/20 bg-white dark:bg-[#212225] py-2 pl-9 pr-3 text-sm text-[#434A57] dark:text-[#f5f9fc] placeholder-[#727B8E] focus:border-[#1E62EC] focus:outline-none focus:ring-1 focus:ring-[#1E62EC]/20"
              />
              {searchLoading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#727B8E]" />}
            </div>
            {showDropdown && searchResults.length > 0 && (
              <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-[#727B8E]/20 bg-white dark:bg-[#1A1B1D] shadow-lg">
                {searchResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={() => handleSelectClient(c)}
                    className="flex w-full flex-col px-3 py-2.5 text-left text-sm hover:bg-[#F4F6F9] dark:hover:bg-[#212225] transition-colors"
                  >
                    <span className="font-medium text-[#434A57] dark:text-[#f5f9fc]">{c.name}</span>
                    {c.phone && <span className="text-xs text-[#727B8E]">{c.phone}</span>}
                  </button>
                ))}
              </div>
            )}
            {selectedClient && (
              <p className="mt-1 text-xs text-green-600 dark:text-green-400">✓ {selectedClient.name} selecionado</p>
            )}
          </div>

          {/* Pet */}
          {selectedClient && (
            <div>
              <p className="mb-1.5 text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">Pet</p>
              {clientPets.length === 0 ? (
                <p className="text-sm text-[#727B8E]">Nenhum pet cadastrado para este cliente.</p>
              ) : (
                <div className="relative">
                  <select
                    value={selectedPetId}
                    onChange={(e) => setSelectedPetId(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-[#727B8E]/20 bg-white dark:bg-[#212225] px-3 py-2 pr-8 text-sm text-[#434A57] dark:text-[#f5f9fc] focus:border-[#1E62EC] focus:outline-none focus:ring-1 focus:ring-[#1E62EC]/20"
                  >
                    <option value="">Selecione um pet</option>
                    {clientPets.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.breed ? ` · ${p.breed}` : ''}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#727B8E]" />
                </div>
              )}
            </div>
          )}

          {/* Datas */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1.5 text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">Check-in</p>
              <Input
                type="date"
                value={newCheckinDate}
                onChange={(e) => setNewCheckinDate(e.target.value)}
              />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">Check-out</p>
              <Input
                type="date"
                value={newCheckoutDate}
                onChange={(e) => setNewCheckoutDate(e.target.value)}
                min={newCheckinDate}
              />
            </div>
          </div>

          {/* Diária */}
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

          {/* Contato de emergência */}
          <div>
            <p className="mb-1.5 text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">Contato de emergência (opcional)</p>
            <Input
              placeholder="Ex: João — (11) 99999-9999"
              value={newEmergencyContact}
              onChange={(e) => setNewEmergencyContact(e.target.value)}
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

      {/* Check-out Modal */}
      <Modal isOpen={!!checkoutTarget} onClose={() => setCheckoutTarget(null)} title="Fazer Check-out" className="max-w-[400px]">
        {checkoutTarget && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
              Confirmar check-out de <span className="font-semibold text-[#434A57] dark:text-[#f5f9fc]">{checkoutTarget.pet_name}</span>?
              A estadia será encerrada e o pet liberado.
            </p>
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
