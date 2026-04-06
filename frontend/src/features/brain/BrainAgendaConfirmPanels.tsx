import { useEffect, useState } from 'react'
import { appointmentService } from '@/services'
import type {
  BrainStructuredUi,
  ManualScheduleDraftPayload,
  ManualScheduleBatchDraftPayload,
  CancelAppointmentDraftPayload,
  CancelAppointmentsBatchDraftPayload,
  RescheduleAppointmentsBatchDraftPayload,
} from './parseAssistantStructured'

function apiErr(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    return String(
      (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Falha na requisição.',
    )
  }
  return 'Falha na requisição.'
}

function panelClass() {
  return 'mt-3 rounded-xl border border-[#727B8E1A] bg-gray-50 dark:border-[#40485A] dark:bg-[#141518] px-4 py-3 text-sm'
}

function ManualScheduleDraftConfirm({ draft }: { draft: ManualScheduleDraftPayload }) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function confirm() {
    setError(null)
    setSending(true)
    try {
      await appointmentService.scheduleAppointment({
        client_id: draft.client_id,
        pet_id: draft.pet_id,
        service_id: String(draft.service_id),
        slot_id: draft.slot_id,
        scheduled_at: draft.scheduled_at,
        notes: draft.notes?.trim() || undefined,
        payment_method: 'manual',
        origin_channel: 'brain_manual_draft',
      })
      setDone(true)
    } catch (err: unknown) {
      setError(apiErr(err))
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
        Agendamento confirmado na agenda.
      </div>
    )
  }

  return (
    <div className={panelClass()}>
      <p className="mb-2 text-xs font-medium text-[#434A57] dark:text-[#f5f9fc]">Confirmar agendamento</p>
      <p className="mb-3 text-xs text-[#727B8E] dark:text-[#8a94a6]">
        {(draft.client_name ?? 'Cliente').trim()} · {draft.pet_name} · {draft.service_name}
      </p>
      <p className="mb-2 text-xs text-[#727B8E] dark:text-[#8a94a6]">
        {draft.scheduled_date} às {draft.time}
      </p>
      {draft.notes ? (
        <p className="mb-2 text-xs text-[#727B8E] dark:text-[#8a94a6]">Obs.: {draft.notes}</p>
      ) : null}
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        onClick={confirm}
        disabled={sending}
        className="rounded-lg bg-[#0F172A] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-[#f5f9fc] dark:text-[#0F172A]"
      >
        {sending ? 'Confirmando…' : 'Confirmar na agenda'}
      </button>
    </div>
  )
}

function ManualScheduleBatchConfirm({ draft }: { draft: ManualScheduleBatchDraftPayload }) {
  const batchKey = draft.items.map((it) => it.slot_id).join('|')
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(() => new Set(draft.items.map((_, i) => i)))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batchResult, setBatchResult] = useState<{
    ok: number
    fail: { label: string; message: string }[]
    attemptTotal: number
  } | null>(null)

  useEffect(() => {
    setSelectedIdx(new Set(draft.items.map((_, i) => i)))
    setBatchResult(null)
    setError(null)
  }, [batchKey, draft.items.length])

  function toggleIdx(i: number) {
    setSelectedIdx((prev) => {
      const n = new Set(prev)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })
  }

  async function confirm() {
    setError(null)
    setSending(true)
    const fail: { label: string; message: string }[] = []
    let ok = 0
    let attemptTotal = 0
    for (let i = 0; i < draft.items.length; i++) {
      if (!selectedIdx.has(i)) continue
      attemptTotal += 1
      const item = draft.items[i]!
      const label = `${item.pet_name} · ${item.scheduled_date} ${item.time}`
      try {
        await appointmentService.scheduleAppointment({
          client_id: item.client_id,
          pet_id: item.pet_id,
          service_id: String(item.service_id),
          slot_id: item.slot_id,
          scheduled_at: item.scheduled_at,
          notes: item.notes?.trim() || undefined,
          payment_method: 'manual',
          origin_channel: 'brain_manual_batch_draft',
        })
        ok += 1
      } catch (err: unknown) {
        fail.push({ label, message: apiErr(err) })
      }
    }
    setBatchResult({ ok, fail, attemptTotal })
    setSending(false)
  }

  if (batchResult) {
    const allOk = batchResult.fail.length === 0
    return (
      <div
        className={`mt-3 rounded-xl border px-4 py-3 text-sm ${
          allOk
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
            : 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200'
        }`}
      >
        <p>
          {batchResult.ok} de {batchResult.attemptTotal} agendamento(s) confirmado(s).
        </p>
        {batchResult.fail.length > 0 && (
          <ul className="mt-2 list-inside list-disc text-xs opacity-95">
            {batchResult.fail.map((f, i) => (
              <li key={`${i}-${f.label}`}>
                {f.label}: {f.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const nSel = selectedIdx.size

  return (
    <div className={panelClass()}>
      <p className="mb-2 text-xs font-medium text-[#434A57] dark:text-[#f5f9fc]">
        Confirmar agendamentos ({nSel} selecionado(s) de {draft.items.length})
      </p>
      <p className="mb-2 text-[11px] text-[#727B8E] dark:text-[#8a94a6]">
        Desmarque os que não devem ser criados agora.
      </p>
      <ul className="mb-3 max-h-40 space-y-2 overflow-y-auto text-xs text-[#727B8E] dark:text-[#8a94a6]">
        {draft.items.map((it, i) => (
          <li key={`${it.slot_id}-${i}`} className="flex gap-2">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={selectedIdx.has(i)}
                onChange={() => toggleIdx(i)}
                className="mt-0.5 rounded border-[#727B8E66]"
              />
              <span>
                {i + 1}. {it.client_name ?? 'Cliente'} · {it.pet_name} · {it.service_name} — {it.scheduled_date}{' '}
                {it.time}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        onClick={confirm}
        disabled={sending || nSel === 0}
        className="rounded-lg bg-[#0F172A] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-[#f5f9fc] dark:text-[#0F172A]"
      >
        {sending ? 'Confirmando…' : `Confirmar ${nSel} na agenda`}
      </button>
    </div>
  )
}

function CancelOneConfirm({ draft }: { draft: CancelAppointmentDraftPayload }) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function confirm() {
    setError(null)
    setSending(true)
    try {
      await appointmentService.cancelAppointment(draft.appointment_id, draft.cancel_reason ?? undefined)
      setDone(true)
    } catch (err: unknown) {
      setError(apiErr(err))
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
        Cancelamento aplicado.
      </div>
    )
  }

  return (
    <div className={panelClass()}>
      <p className="mb-2 text-xs font-medium text-[#434A57] dark:text-[#f5f9fc]">Confirmar cancelamento</p>
      {draft.summary ? (
        <p className="mb-3 text-xs text-[#727B8E] dark:text-[#8a94a6]">{draft.summary}</p>
      ) : null}
      <p className="mb-2 font-mono text-[10px] text-[#727B8E] dark:text-[#8a94a6]">{draft.appointment_id}</p>
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        onClick={confirm}
        disabled={sending}
        className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-red-600"
      >
        {sending ? 'Cancelando…' : 'Confirmar cancelamento'}
      </button>
    </div>
  )
}

function CancelBatchConfirm({ draft }: { draft: CancelAppointmentsBatchDraftPayload }) {
  const idsKey = draft.appointment_ids.join('|')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(draft.appointment_ids))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batchResult, setBatchResult] = useState<{
    ok: number
    fail: { id: string; message: string }[]
    attemptTotal: number
  } | null>(null)

  useEffect(() => {
    setSelectedIds(new Set(draft.appointment_ids))
    setBatchResult(null)
    setError(null)
  }, [idsKey, draft.appointment_ids.length])

  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  async function confirm() {
    setError(null)
    setSending(true)
    const fail: { id: string; message: string }[] = []
    let ok = 0
    let attemptTotal = 0
    for (const id of draft.appointment_ids) {
      if (!selectedIds.has(id)) continue
      attemptTotal += 1
      try {
        await appointmentService.cancelAppointment(id, draft.cancel_reason ?? undefined)
        ok += 1
      } catch (err: unknown) {
        fail.push({ id, message: apiErr(err) })
      }
    }
    setBatchResult({ ok, fail, attemptTotal })
    setSending(false)
  }

  if (batchResult) {
    const allOk = batchResult.fail.length === 0
    return (
      <div
        className={`mt-3 rounded-xl border px-4 py-3 text-sm ${
          allOk
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200'
            : 'border-amber-600/40 bg-amber-500/10 text-amber-950 dark:text-amber-100'
        }`}
      >
        <p>
          {batchResult.ok} de {batchResult.attemptTotal} cancelamento(s) aplicado(s).
        </p>
        {batchResult.fail.length > 0 && (
          <ul className="mt-2 max-h-32 list-inside list-disc overflow-y-auto text-xs opacity-95">
            {batchResult.fail.map((f) => (
              <li key={f.id} className="font-mono text-[10px]">
                {f.id.slice(0, 8)}… — {f.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const nSel = selectedIds.size

  return (
    <div className={panelClass()}>
      <p className="mb-2 text-xs font-medium text-[#434A57] dark:text-[#f5f9fc]">
        Confirmar cancelamentos ({nSel} selecionado(s) de {draft.appointment_ids.length})
      </p>
      <p className="mb-2 text-[11px] text-[#727B8E] dark:text-[#8a94a6]">Desmarque os que não devem ser cancelados.</p>
      <ul className="mb-3 max-h-40 space-y-2 overflow-y-auto text-xs text-[#727B8E] dark:text-[#8a94a6]">
        {draft.summaries.map((s) => (
          <li key={s.appointment_id}>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={selectedIds.has(s.appointment_id)}
                onChange={() => toggleId(s.appointment_id)}
                className="mt-0.5 rounded border-[#727B8E66]"
              />
              <span>
                <span className="font-mono text-[10px]">{s.appointment_id.slice(0, 8)}…</span> — {s.summary}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        onClick={confirm}
        disabled={sending || nSel === 0}
        className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-red-600"
      >
        {sending ? 'Cancelando…' : `Confirmar ${nSel} cancelamento(s)`}
      </button>
    </div>
  )
}

function RescheduleBatchConfirm({ draft }: { draft: RescheduleAppointmentsBatchDraftPayload }) {
  const itemsKey = draft.items.map((it) => it.appointment_id).join('|')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(draft.items.map((it) => it.appointment_id)))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batchResult, setBatchResult] = useState<{
    ok: number
    fail: { label: string; message: string }[]
    attemptTotal: number
  } | null>(null)

  useEffect(() => {
    setSelectedIds(new Set(draft.items.map((it) => it.appointment_id)))
    setBatchResult(null)
    setError(null)
  }, [itemsKey, draft.items.length])

  function toggleResId(id: string) {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  async function confirm() {
    setError(null)
    setSending(true)
    const fail: { label: string; message: string }[] = []
    let ok = 0
    let attemptTotal = 0
    for (const it of draft.items) {
      if (!selectedIds.has(it.appointment_id)) continue
      attemptTotal += 1
      const label = it.summary ?? it.appointment_id
      try {
        await appointmentService.rescheduleToSlot({
          appointment_id: it.appointment_id,
          new_slot_id: it.new_slot_id,
          new_scheduled_date: it.new_scheduled_date,
          new_time: it.new_time,
        })
        ok += 1
      } catch (err: unknown) {
        fail.push({ label, message: apiErr(err) })
      }
    }
    setBatchResult({ ok, fail, attemptTotal })
    setSending(false)
  }

  if (batchResult) {
    const allOk = batchResult.fail.length === 0
    return (
      <div
        className={`mt-3 rounded-xl border px-4 py-3 text-sm ${
          allOk
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
            : 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200'
        }`}
      >
        <p>
          {batchResult.ok} de {batchResult.attemptTotal} remarcação(ões) aplicada(s).
        </p>
        {batchResult.fail.length > 0 && (
          <ul className="mt-2 list-inside list-disc text-xs opacity-95">
            {batchResult.fail.map((f, i) => (
              <li key={`${i}-${f.label}`}>
                {f.label}: {f.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const nSel = selectedIds.size

  return (
    <div className={panelClass()}>
      <p className="mb-2 text-xs font-medium text-[#434A57] dark:text-[#f5f9fc]">
        Confirmar remarcações ({nSel} selecionada(s) de {draft.items.length})
      </p>
      <p className="mb-2 text-[11px] text-[#727B8E] dark:text-[#8a94a6]">Desmarque as que não devem ser aplicadas.</p>
      <ul className="mb-3 max-h-40 space-y-2 overflow-y-auto text-xs text-[#727B8E] dark:text-[#8a94a6]">
        {draft.items.map((it, i) => (
          <li key={`${it.appointment_id}-${i}`}>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={selectedIds.has(it.appointment_id)}
                onChange={() => toggleResId(it.appointment_id)}
                className="mt-0.5 rounded border-[#727B8E66]"
              />
              <span>
                {it.summary ?? it.appointment_id}
                {(it.new_scheduled_date && it.new_time) || it.new_slot_id ? (
                  <span className="block text-[10px] opacity-90">
                    →{' '}
                    {it.new_slot_id
                      ? `slot ${it.new_slot_id.slice(0, 8)}…`
                      : `${it.new_scheduled_date} ${it.new_time}`}
                  </span>
                ) : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        onClick={confirm}
        disabled={sending || nSel === 0}
        className="rounded-lg bg-[#0F172A] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-[#f5f9fc] dark:text-[#0F172A]"
      >
        {sending ? 'Remarcando…' : `Confirmar ${nSel} remarcação(ões)`}
      </button>
    </div>
  )
}

export function BrainAgendaConfirmPanels({ structured }: { structured?: BrainStructuredUi }) {
  if (!structured) return null
  switch (structured.type) {
    case 'manual_schedule_draft':
      return <ManualScheduleDraftConfirm draft={structured} />
    case 'manual_schedule_batch_draft':
      return <ManualScheduleBatchConfirm draft={structured} />
    case 'cancel_appointment_draft':
      return <CancelOneConfirm draft={structured} />
    case 'cancel_appointments_batch_draft':
      return <CancelBatchConfirm draft={structured} />
    case 'reschedule_appointments_batch_draft':
      return <RescheduleBatchConfirm draft={structured} />
    default:
      return null
  }
}
