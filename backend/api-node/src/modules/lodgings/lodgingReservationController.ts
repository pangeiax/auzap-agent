import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { Prisma } from '@prisma/client'

function formatTime(d: Date | null): string | null {
  if (!d) return null
  const h = String(new Date(d).getUTCHours()).padStart(2, '0')
  const m = String(new Date(d).getUTCMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

function shapeLodgingReservation(r: any) {
  return {
    id: r.id,
    company_id: r.companyId,
    client_id: r.clientId,
    client_name: r.client?.name ?? null,
    phone_client: r.client?.phone ?? null,
    pet_id: r.petId,
    pet_name: r.pet?.name ?? null,
    pet_breed: r.pet?.breed ?? null,
    pet_size: r.pet?.size ?? null,
    type: r.type,
    checkin_date: r.checkinDate,
    checkout_date: r.checkoutDate,
    checkin_time: r.checkinTime ? formatTime(r.checkinTime) : null,
    checkout_time: r.checkoutTime ? formatTime(r.checkoutTime) : null,
    kennel_id: r.kennelId,
    status: r.status,
    confirmed: r.confirmed,
    daily_rate: r.dailyRate ? Number(r.dailyRate) : null,
    total_amount: r.totalAmount ? Number(r.totalAmount) : null,
    care_notes: r.careNotes ?? {},
    emergency_contact: r.emergencyContact,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }
}

const reservationInclude = {
  client: { select: { name: true, phone: true } },
  pet: { select: { name: true, breed: true, size: true } },
}

/** Calendar day in UTC (YYYY-MM-DD), matches PostgreSQL @db.Date semantics with toISOString. */
function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Pet occupies calendar day D iff checkin_date <= D AND checkout_date > D (checkout exclusive).
 * Capacity counts only rows with status confirmed | checked_in (same as vw_lodging_availability).
 */
function lodgingOccupiesUtcCalendarDay(checkin: Date, checkout: Date, dayStart: Date): boolean {
  const d = utcDateKey(dayStart)
  return utcDateKey(checkin) <= d && utcDateKey(checkout) > d
}

// GET /lodging-reservations
export async function listLodgingReservations(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { status, type, client_id, pet_id, checkin_from, checkin_to } = req.query

    const where: any = { companyId }

    if (status) {
      const statuses = (status as string).split(',').map((s) => s.trim()).filter(Boolean)
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses }
    }
    if (type) where.type = type
    if (client_id) where.clientId = client_id
    if (pet_id) where.petId = pet_id
    if (checkin_from || checkin_to) {
      where.checkinDate = {}
      if (checkin_from) where.checkinDate.gte = new Date(checkin_from as string)
      if (checkin_to) where.checkinDate.lte = new Date(checkin_to as string)
    }

    const reservations = await prisma.petshopLodgingReservation.findMany({
      where,
      include: reservationInclude,
      orderBy: { checkinDate: 'desc' },
    })

    res.json(reservations.map(shapeLodgingReservation))
  } catch (error) {
    console.error('Error listing lodging reservations:', error)
    res.status(500).json({ error: 'Failed to list lodging reservations' })
  }
}

// GET /lodging-reservations/:id
export async function getLodgingReservation(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { id } = req.params

    const reservation = await prisma.petshopLodgingReservation.findUnique({
      where: { id: id! },
      include: reservationInclude,
    })

    if (!reservation || reservation.companyId !== companyId) {
      return res.status(404).json({ error: 'Lodging reservation not found' })
    }

    res.json(shapeLodgingReservation(reservation))
  } catch (error) {
    console.error('Error getting lodging reservation:', error)
    res.status(500).json({ error: 'Failed to get lodging reservation' })
  }
}

// POST /lodging-reservations
export async function createLodgingReservation(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const {
      client_id,
      pet_id,
      type,
      checkin_date,
      checkout_date,
      checkin_time,
      checkout_time,
      daily_rate,
      care_notes,
      emergency_contact,
    } = req.body

    if (!client_id || !pet_id || !type || !checkin_date || !checkout_date) {
      return res.status(400).json({
        error: 'client_id, pet_id, type, checkin_date e checkout_date são obrigatórios',
      })
    }

    const checkin = new Date(checkin_date)
    const checkout = new Date(checkout_date)

    if (checkout <= checkin) {
      return res.status(400).json({ error: 'checkout_date deve ser posterior a checkin_date' })
    }

    const totalAmount = daily_rate
      ? Number(daily_rate) * Math.ceil((checkout.getTime() - checkin.getTime()) / 86400000)
      : null

    let checkinTimeDate: Date | undefined
    let checkoutTimeDate: Date | undefined
    if (checkin_time) {
      const [hh, mm] = String(checkin_time).split(':').map(Number)
      checkinTimeDate = new Date(Date.UTC(1970, 0, 1, hh, mm, 0))
    }
    if (checkout_time) {
      const [hh, mm] = String(checkout_time).split(':').map(Number)
      checkoutTimeDate = new Date(Date.UTC(1970, 0, 1, hh, mm, 0))
    }

    // Atomically check capacity and create — prevents double-booking under concurrent requests
    const reservation = await prisma.$transaction(async (tx) => {
      // Load capacity config for this type (all days of week)
      const caps = await tx.petshopLodgingCapacity.findMany({
        where: { companyId, type },
      })
      const capByDay = new Map(caps.map((c) => [c.dayOfWeek, c]))

      // Só confirmed e checked_in ocupam vaga fisicamente (alinhado à view e à query de capacidade)
      const overlapping = await tx.petshopLodgingReservation.findMany({
        where: {
          companyId,
          type,
          status: { in: ['confirmed', 'checked_in'] },
          checkinDate: { lt: checkout }, // sobrepõe o período solicitado [checkin, checkout)
          checkoutDate: { gt: checkin },
        },
        select: { checkinDate: true, checkoutDate: true },
      })

      // Check each day in the requested period [checkin, checkout)
      const cursor = new Date(Date.UTC(
        checkin.getUTCFullYear(),
        checkin.getUTCMonth(),
        checkin.getUTCDate(),
      ))
      const endDay = new Date(Date.UTC(
        checkout.getUTCFullYear(),
        checkout.getUTCMonth(),
        checkout.getUTCDate(),
      ))

      while (cursor < endDay) {
        const dow = cursor.getUTCDay() // 0=Sun … 6=Sat
        const cap = capByDay.get(dow)

        if (!cap || !cap.isActive || cap.maxCapacity <= 0) {
          const dayStr = cursor.toISOString().slice(0, 10)
          throw Object.assign(new Error(`Dia ${dayStr} está fechado ou sem vagas configuradas para ${type === 'hotel' ? 'Hotel' : 'Creche'}.`), { statusCode: 409 })
        }

        const count = overlapping.filter((r) =>
          lodgingOccupiesUtcCalendarDay(new Date(r.checkinDate), new Date(r.checkoutDate), cursor),
        ).length

        if (count >= cap.maxCapacity) {
          const dayStr = cursor.toISOString().slice(0, 10)
          throw Object.assign(
            new Error(`Sem vagas disponíveis em ${dayStr}: capacidade máxima de ${cap.maxCapacity} ${cap.maxCapacity === 1 ? 'vaga' : 'vagas'} atingida.`),
            { statusCode: 409 },
          )
        }

        cursor.setUTCDate(cursor.getUTCDate() + 1)
      }

      // All days have capacity — create the reservation
      return tx.petshopLodgingReservation.create({
        data: {
          companyId,
          clientId: client_id,
          petId: pet_id,
          type,
          checkinDate: checkin,
          checkoutDate: checkout,
          ...(checkinTimeDate ? { checkinTime: checkinTimeDate } : {}),
          ...(checkoutTimeDate ? { checkoutTime: checkoutTimeDate } : {}),
          dailyRate: daily_rate ? Number(daily_rate) : null,
          totalAmount,
          careNotes: care_notes ?? {},
          emergencyContact: emergency_contact ?? null,
          status: 'confirmed',
          confirmed: true,
        },
        include: reservationInclude,
      })
    })

    res.status(201).json(shapeLodgingReservation(reservation))
  } catch (error: any) {
    console.error('Error creating lodging reservation:', error)
    if (error?.statusCode === 409) {
      return res.status(409).json({ error: error.message })
    }
    res.status(500).json({ error: 'Failed to create lodging reservation' })
  }
}

// PATCH /lodging-reservations/:id
export async function updateLodgingReservation(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { id } = req.params
    const { status, kennel_id, care_notes, emergency_contact, confirmed } = req.body

    const existing = await prisma.petshopLodgingReservation.findUnique({ where: { id: id! } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Lodging reservation not found' })
    }

    const data: any = { updatedAt: new Date() }
    if (status !== undefined) data.status = status
    if (kennel_id !== undefined) data.kennelId = kennel_id
    if (care_notes !== undefined) data.careNotes = care_notes
    if (emergency_contact !== undefined) data.emergencyContact = emergency_contact
    if (confirmed !== undefined) data.confirmed = confirmed

    const reservation = await prisma.petshopLodgingReservation.update({
      where: { id: id! },
      data,
      include: reservationInclude,
    })

    res.json(shapeLodgingReservation(reservation))
  } catch (error) {
    console.error('Error updating lodging reservation:', error)
    res.status(500).json({ error: 'Failed to update lodging reservation' })
  }
}

// DELETE /lodging-reservations/:id (cancel)
export async function cancelLodgingReservation(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { id } = req.params

    const existing = await prisma.petshopLodgingReservation.findUnique({ where: { id: id! } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Lodging reservation not found' })
    }

    await prisma.petshopLodgingReservation.update({
      where: { id: id! },
      data: { status: 'cancelled', updatedAt: new Date() },
    })

    res.json({ success: true, reservation_id: id })
  } catch (error) {
    console.error('Error cancelling lodging reservation:', error)
    res.status(500).json({ error: 'Failed to cancel lodging reservation' })
  }
}

// GET /lodging-reservations/availability
export async function checkAvailability(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { type, checkin_date, checkout_date } = req.query

    if (!type || !checkin_date || !checkout_date) {
      return res.status(400).json({ error: 'type, checkin_date e checkout_date são obrigatórios' })
    }

    const rows = await prisma.$queryRaw<{ type: string; min_vagas: bigint }[]>(
      Prisma.sql`
        SELECT type, MIN(available_capacity) AS min_vagas
        FROM vw_lodging_availability
        WHERE company_id = ${companyId}
          AND check_date BETWEEN ${new Date(checkin_date as string)}::date
            AND (${new Date(checkout_date as string)}::date - interval '1 day')
          AND type = ${type as string}
        GROUP BY type
        HAVING MIN(available_capacity) > 0
      `
    )

    const row = rows[0] ?? null

    res.json({
      type,
      checkin_date,
      checkout_date,
      available: row !== null,
      min_available_capacity: row ? Number(row.min_vagas) : 0,
    })
  } catch (error) {
    console.error('Error checking lodging availability:', error)
    res.status(500).json({ error: 'Failed to check lodging availability' })
  }
}
