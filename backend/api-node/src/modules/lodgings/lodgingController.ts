import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'

function shapeLodging(l: any) {
  return {
    id: l.id,
    client_id: l.clientId,
    client_name: l.client?.name ?? null,
    phone_client: l.client?.phone ?? null,
    pet_id: l.petId,
    pet_name: l.pet?.name ?? null,
    specialty_id: l.specialtyId,
    kennel_id: l.kennelId,
    checkin_date: l.checkinDate,
    checkout_date: l.checkoutDate,
    checkin_time: l.checkinTime ? `${String(new Date(l.checkinTime).getUTCHours()).padStart(2,'0')}:${String(new Date(l.checkinTime).getUTCMinutes()).padStart(2,'0')}` : '08:00',
    checkout_time: l.checkoutTime ? `${String(new Date(l.checkoutTime).getUTCHours()).padStart(2,'0')}:${String(new Date(l.checkoutTime).getUTCMinutes()).padStart(2,'0')}` : '18:00',
    status: l.status,
    confirmed: l.confirmed,
    daily_rate: l.dailyRate ? Number(l.dailyRate) : null,
    total_amount: l.totalAmount ? Number(l.totalAmount) : null,
    care_notes: l.careNotes ?? {},
    emergency_vet: l.emergencyVet,
    created_at: l.createdAt,
    updated_at: l.updatedAt,
  }
}

const lodgingInclude = {
  client: { select: { name: true, phone: true } },
  pet: { select: { name: true, species: true, breed: true, size: true } },
  specialty: { select: { name: true, color: true } },
}

// GET /lodgings
export async function listLodgings(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { status, client_id, pet_id, checkin_from, checkin_to } = req.query

    const where: any = { companyId }
    if (status) {
      const statuses = (status as string).split(',').map((s) => s.trim()).filter(Boolean)
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses }
    }
    if (client_id) where.clientId = client_id
    if (pet_id) where.petId = pet_id
    if (checkin_from || checkin_to) {
      where.checkinDate = {}
      if (checkin_from) where.checkinDate.gte = new Date(checkin_from as string)
      if (checkin_to) where.checkinDate.lte = new Date(checkin_to as string)
    }

    const lodgings = await prisma.petshopLodging.findMany({
      where,
      include: lodgingInclude,
      orderBy: { checkinDate: 'desc' },
    })

    res.json(lodgings.map(shapeLodging))
  } catch (error) {
    console.error('Error listing lodgings:', error)
    res.status(500).json({ error: 'Failed to list lodgings' })
  }
}

// GET /lodgings/kennel-availability
export async function getKennelAvailability(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { checkin_date, checkout_date } = req.query

    if (!checkin_date || !checkout_date) {
      return res.status(400).json({ error: 'checkin_date e checkout_date são obrigatórios' })
    }

    const checkin = new Date(checkin_date as string)
    const checkout = new Date(checkout_date as string)

    if (checkout <= checkin) {
      return res.status(400).json({ error: 'checkout_date deve ser posterior a checkin_date' })
    }

    // Busca kennels ocupados no período (sobreposição de datas)
    const occupied = await prisma.petshopLodging.findMany({
      where: {
        companyId,
        status: { notIn: ['cancelled', 'checked_out'] },
        checkinDate: { lt: checkout },
        checkoutDate: { gt: checkin },
        kennelId: { not: null },
      },
      select: { kennelId: true, pet: { select: { name: true } } },
    })

    const occupiedKennels = occupied.map(l => ({
      kennel_id: l.kennelId,
      pet_name: l.pet?.name,
    }))

    res.json({
      checkin_date: checkin_date,
      checkout_date: checkout_date,
      occupied_kennels: occupiedKennels,
      occupied_count: occupiedKennels.length,
    })
  } catch (error) {
    console.error('Error getting kennel availability:', error)
    res.status(500).json({ error: 'Failed to get kennel availability' })
  }
}

// GET /lodgings/:id
export async function getLodging(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { id } = req.params

    const lodging = await prisma.petshopLodging.findUnique({
      where: { id: id! },
      include: lodgingInclude,
    })

    if (!lodging || lodging.companyId !== companyId) {
      return res.status(404).json({ error: 'Lodging not found' })
    }

    res.json(shapeLodging(lodging))
  } catch (error) {
    console.error('Error getting lodging:', error)
    res.status(500).json({ error: 'Failed to get lodging' })
  }
}

// POST /lodgings
export async function createLodging(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { client_id, pet_id, specialty_id, kennel_id, checkin_date, checkout_date, checkin_time, checkout_time, daily_rate, care_notes, emergency_vet, notes } = req.body

    if (!client_id || !pet_id || !checkin_date || !checkout_date) {
      return res.status(400).json({ error: 'client_id, pet_id, checkin_date e checkout_date são obrigatórios' })
    }

    const checkin = new Date(checkin_date)
    const checkout = new Date(checkout_date)

    if (checkout <= checkin) {
      return res.status(400).json({ error: 'checkout_date deve ser posterior a checkin_date' })
    }

    const days = Math.ceil((checkout.getTime() - checkin.getTime()) / (1000 * 60 * 60 * 24))
    const totalAmount = daily_rate ? Number(daily_rate) * days : null

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

    const lodging = await prisma.petshopLodging.create({
      data: {
        companyId,
        clientId: client_id,
        petId: pet_id,
        specialtyId: specialty_id ?? null,
        kennelId: kennel_id ?? null,
        checkinDate: checkin,
        checkoutDate: checkout,
        ...(checkinTimeDate ? { checkinTime: checkinTimeDate } : {}),
        ...(checkoutTimeDate ? { checkoutTime: checkoutTimeDate } : {}),
        dailyRate: daily_rate ? Number(daily_rate) : null,
        totalAmount,
        careNotes: care_notes ?? {},
        emergencyVet: emergency_vet ?? null,
        status: 'pending',
        confirmed: false,
      },
      include: lodgingInclude,
    })

    res.status(201).json(shapeLodging(lodging))
  } catch (error) {
    console.error('Error creating lodging:', error)
    res.status(500).json({ error: 'Failed to create lodging' })
  }
}

// PATCH /lodgings/:id
export async function updateLodging(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { id } = req.params
    const { status, kennel_id, care_notes, emergency_vet, confirmed } = req.body

    const existing = await prisma.petshopLodging.findUnique({ where: { id: id! } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Lodging not found' })
    }

    const data: any = { updatedAt: new Date() }
    if (status !== undefined) data.status = status
    if (kennel_id !== undefined) data.kennelId = kennel_id
    if (care_notes !== undefined) data.careNotes = care_notes
    if (emergency_vet !== undefined) data.emergencyVet = emergency_vet
    if (confirmed !== undefined) data.confirmed = confirmed

    const lodging = await prisma.petshopLodging.update({
      where: { id: id! },
      data,
      include: lodgingInclude,
    })

    res.json(shapeLodging(lodging))
  } catch (error) {
    console.error('Error updating lodging:', error)
    res.status(500).json({ error: 'Failed to update lodging' })
  }
}

// DELETE /lodgings/:id (cancel)
export async function cancelLodging(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { id } = req.params

    const existing = await prisma.petshopLodging.findUnique({ where: { id: id! } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Lodging not found' })
    }

    await prisma.petshopLodging.update({
      where: { id: id! },
      data: { status: 'cancelled', updatedAt: new Date() },
    })

    res.json({ success: true, lodging_id: id })
  } catch (error) {
    console.error('Error cancelling lodging:', error)
    res.status(500).json({ error: 'Failed to cancel lodging' })
  }
}
