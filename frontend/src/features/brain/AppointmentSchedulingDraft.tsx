import { useEffect, useMemo, useState } from 'react'
import { appointmentService, serviceService } from '@/services'
import type { AppointmentDraftPayload } from './parseAssistantStructured'
import { normalizeHhMm } from './normalizeSlotTime'

interface Props {
  draft: AppointmentDraftPayload
}

export function AppointmentSchedulingDraft({ draft }: Props) {
  const [scheduledDate, setScheduledDate] = useState(draft.scheduled_date)
  const [timeField, setTimeField] = useState(draft.time)
  const [notes, setNotes] = useState(draft.notes ?? '')
  const [serviceId, setServiceId] = useState(draft.service_id)
  const [serviceNameLabel, setServiceNameLabel] = useState(
    (draft.service_name ?? `Serviço #${draft.service_id}`).trim(),
  )
  const [services, setServices] = useState<{ id: number; name: string }[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const draftKey = `${draft.slot_id}|${draft.scheduled_date}|${draft.time}|${draft.service_id}|${draft.pet_id}`

  useEffect(() => {
    let cancelled = false
    serviceService
      .listServices({ is_active: true })
      .then((list) => {
        if (cancelled) return
        setServices(list.map((s) => ({ id: s.id, name: s.name ?? `Serviço ${s.id}` })))
      })
      .catch(() => {
        if (!cancelled) setServices([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setScheduledDate(draft.scheduled_date)
    setTimeField(draft.time)
    setNotes(draft.notes ?? '')
    setServiceId(draft.service_id)
    setServiceNameLabel((draft.service_name ?? `Serviço #${draft.service_id}`).trim())
    setDone(false)
    setError(null)
  }, [draftKey, draft.scheduled_date, draft.time, draft.notes, draft.slot_id, draft.service_id, draft.pet_id, draft.service_name])

  useEffect(() => {
    const opt = services.find((s) => s.id === serviceId)
    if (opt) setServiceNameLabel(opt.name)
  }, [serviceId, services])

  const selectOptions = useMemo(() => {
    const o = [...services]
    if (!o.some((s) => s.id === serviceId)) {
      o.unshift({ id: serviceId, name: serviceNameLabel })
    }
    return o
  }, [services, serviceId, serviceNameLabel])

  async function handleConfirm() {
    setError(null)
    const date = scheduledDate.trim()
    const tnorm = normalizeHhMm(timeField)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !tnorm) {
      setError('Use data AAAA-MM-DD e horário HH:MM.')
      return
    }

    setSending(true)
    try {
      let slotId = draft.slot_id
      const initialTimeNorm = normalizeHhMm(draft.time)
      const serviceChanged = serviceId !== draft.service_id
      const dateOrTimeChanged = date !== draft.scheduled_date || tnorm !== initialTimeNorm

      if (serviceChanged || dateOrTimeChanged) {
        const res = await appointmentService.getAvailableSlots({
          date,
          service_id: String(serviceId),
          pet_id: draft.pet_id,
        })
        const found = res.available_slots.find((s) => normalizeHhMm(s.time) === tnorm)
        if (!found?.slot_id) {
          setError('Horário indisponível nesta data para o serviço escolhido. Ajuste ou peça novas opções ao assistente.')
          return
        }
        slotId = found.slot_id
      }

      const scheduled_at = `${date}T${tnorm}:00`

      await appointmentService.scheduleAppointment({
        client_id: draft.client_id,
        pet_id: draft.pet_id,
        service_id: String(serviceId),
        slot_id: slotId,
        scheduled_at,
        notes: notes.trim() || undefined,
        payment_method: 'manual',
        origin_channel: 'brain_draft',
      })
      setDone(true)
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? String(
              (err as { response?: { data?: { error?: string } } }).response?.data?.error ??
                'Não foi possível confirmar.',
            )
          : 'Não foi possível confirmar.'
      setError(msg)
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <div className="mt-3 rounded-xl border border-[#727B8E1A] bg-emerald-500/10 dark:border-[#40485A] px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
        Agendamento confirmado na agenda.
      </div>
    )
  }

  const timeHint =
    draft.uses_consecutive_slots && draft.paired_slot_time
      ? `Dois blocos: ${draft.time} e ${draft.paired_slot_time}`
      : null

  return (
    <div className="mt-3 rounded-xl border border-[#727B8E1A] bg-gray-50 dark:border-[#40485A] dark:bg-[#141518] px-4 py-3 text-sm">
      <p className="mb-2 text-xs font-medium text-[#434A57] dark:text-[#f5f9fc]">Confirmar agendamento</p>
      <p className="mb-3 text-xs text-[#727B8E] dark:text-[#8a94a6]">
        {(draft.client_name ?? 'Cliente').trim()} · {(draft.pet_name ?? 'Pet').trim()}
      </p>
      <label className="mb-3 block text-xs text-[#727B8E] dark:text-[#8a94a6]">
        Serviço
        <select
          value={serviceId}
          onChange={(e) => setServiceId(Number(e.target.value))}
          className="mt-1 w-full rounded-lg border border-[#727B8E33] bg-white px-2 py-1.5 text-[#434A57] dark:border-[#40485A] dark:bg-[#1A1B1D] dark:text-[#f5f9fc]"
        >
          {selectOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div className="mb-2 grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-[#727B8E] dark:text-[#8a94a6]">
          Data (AAAA-MM-DD)
          <input
            type="text"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[#727B8E33] bg-white px-2 py-1.5 text-[#434A57] dark:border-[#40485A] dark:bg-[#1A1B1D] dark:text-[#f5f9fc]"
          />
        </label>
        <label className="block text-xs text-[#727B8E] dark:text-[#8a94a6]">
          Horário (HH:MM)
          <input
            type="text"
            value={timeField}
            onChange={(e) => setTimeField(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[#727B8E33] bg-white px-2 py-1.5 text-[#434A57] dark:border-[#40485A] dark:bg-[#1A1B1D] dark:text-[#f5f9fc]"
          />
        </label>
      </div>
      {timeHint && <p className="mb-2 text-[11px] text-[#727B8E] dark:text-[#8a94a6]">{timeHint}</p>}
      <label className="mb-3 block text-xs text-[#727B8E] dark:text-[#8a94a6]">
        Observações (opcional)
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="mt-1 w-full resize-y rounded-lg border border-[#727B8E33] bg-white px-2 py-1.5 text-[#434A57] dark:border-[#40485A] dark:bg-[#1A1B1D] dark:text-[#f5f9fc]"
        />
      </label>
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        onClick={handleConfirm}
        disabled={sending}
        className="rounded-lg bg-[#0F172A] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-[#f5f9fc] dark:text-[#0F172A]"
      >
        {sending ? 'Confirmando…' : 'Confirmar na agenda'}
      </button>
    </div>
  )
}
