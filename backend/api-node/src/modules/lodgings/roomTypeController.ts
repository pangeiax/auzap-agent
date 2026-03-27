import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { Prisma } from '@prisma/client'

function shapeRoomType(rt: any) {
  return {
    id: rt.id,
    company_id: rt.companyId,
    lodging_type: rt.lodgingType,
    name: rt.name,
    description: rt.description ?? null,
    capacity: rt.capacity,
    daily_rate: Number(rt.dailyRate),
    features: rt.features ?? {},
    is_active: rt.isActive,
    created_at: rt.createdAt,
    updated_at: rt.updatedAt,
  }
}

// GET /room-types
export async function listRoomTypes(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { lodging_type, is_active } = req.query

    const where: any = { companyId }
    if (lodging_type) where.lodgingType = lodging_type
    if (is_active !== undefined) where.isActive = is_active === 'true'

    const roomTypes = await prisma.petshopRoomType.findMany({
      where,
      orderBy: [{ lodgingType: 'asc' }, { dailyRate: 'asc' }, { name: 'asc' }],
    })

    res.json(roomTypes.map(shapeRoomType))
  } catch (error) {
    console.error('Error listing room types:', error)
    res.status(500).json({ error: 'Failed to list room types' })
  }
}

// GET /room-types/:id
export async function getRoomType(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { id } = req.params

    const roomType = await prisma.petshopRoomType.findUnique({ where: { id: id! } })

    if (!roomType || roomType.companyId !== companyId) {
      return res.status(404).json({ error: 'Room type not found' })
    }

    res.json(shapeRoomType(roomType))
  } catch (error) {
    console.error('Error getting room type:', error)
    res.status(500).json({ error: 'Failed to get room type' })
  }
}

// POST /room-types
export async function createRoomType(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { lodging_type, name, description, capacity, daily_rate, features } = req.body

    if (!lodging_type || !name || capacity === undefined || daily_rate === undefined) {
      return res.status(400).json({
        error: 'lodging_type, name, capacity e daily_rate são obrigatórios',
      })
    }

    if (!['hotel', 'daycare'].includes(lodging_type)) {
      return res.status(400).json({ error: 'lodging_type deve ser "hotel" ou "daycare"' })
    }

    if (Number(capacity) < 0) {
      return res.status(400).json({ error: 'capacity deve ser >= 0' })
    }

    if (Number(daily_rate) < 0) {
      return res.status(400).json({ error: 'daily_rate deve ser >= 0' })
    }

    const roomType = await prisma.petshopRoomType.create({
      data: {
        companyId,
        lodgingType: lodging_type,
        name,
        description: description ?? null,
        capacity: Number(capacity),
        dailyRate: Number(daily_rate),
        features: features ?? {},
        isActive: true,
      },
    })

    res.status(201).json(shapeRoomType(roomType))
  } catch (error) {
    console.error('Error creating room type:', error)
    res.status(500).json({ error: 'Failed to create room type' })
  }
}

// PATCH /room-types/:id
export async function updateRoomType(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { id } = req.params
    const { name, description, capacity, daily_rate, features, is_active } = req.body

    const existing = await prisma.petshopRoomType.findUnique({ where: { id: id! } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Room type not found' })
    }

    if (capacity !== undefined && Number(capacity) < 0) {
      return res.status(400).json({ error: 'capacity deve ser >= 0' })
    }

    if (daily_rate !== undefined && Number(daily_rate) < 0) {
      return res.status(400).json({ error: 'daily_rate deve ser >= 0' })
    }

    const data: any = { updatedAt: new Date() }
    if (name !== undefined) data.name = name
    if (description !== undefined) data.description = description
    if (capacity !== undefined) data.capacity = Number(capacity)
    if (daily_rate !== undefined) data.dailyRate = Number(daily_rate)
    if (features !== undefined) data.features = features
    if (is_active !== undefined) data.isActive = is_active

    const roomType = await prisma.petshopRoomType.update({
      where: { id: id! },
      data,
    })

    res.json(shapeRoomType(roomType))
  } catch (error) {
    console.error('Error updating room type:', error)
    res.status(500).json({ error: 'Failed to update room type' })
  }
}

// DELETE /room-types/:id
export async function deleteRoomType(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { id } = req.params

    const existing = await prisma.petshopRoomType.findUnique({ where: { id: id! } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Room type not found' })
    }

    // Verifica se existem reservas ativas vinculadas a este tipo de quarto
    const activeReservations = await prisma.petshopLodgingReservation.count({
      where: {
        roomTypeId: id,
        status: { in: ['confirmed', 'checked_in'] },
      },
    })

    if (activeReservations > 0) {
      return res.status(409).json({
        error: `Não é possível excluir: existem ${activeReservations} reserva(s) ativa(s) vinculada(s) a este tipo de quarto. Desative-o ao invés de excluir.`,
      })
    }

    await prisma.petshopRoomType.delete({ where: { id: id! } })

    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting room type:', error)
    res.status(500).json({ error: 'Failed to delete room type' })
  }
}

// GET /room-types/availability — disponibilidade por tipo de quarto num período
export async function getRoomTypeAvailability(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { lodging_type, checkin_date, checkout_date } = req.query

    if (!lodging_type || !checkin_date || !checkout_date) {
      return res.status(400).json({
        error: 'lodging_type, checkin_date e checkout_date são obrigatórios',
      })
    }

    type AvailRow = {
      room_type_id: string
      room_type_name: string
      daily_rate: string
      total_capacity: number
      min_available: bigint
      min_occupied: bigint
    }

    const rows = await prisma.$queryRaw<AvailRow[]>(
      Prisma.sql`
        SELECT
          room_type_id,
          room_type_name,
          daily_rate::text,
          total_capacity,
          MIN(available_capacity) AS min_available,
          MAX(occupied_capacity)  AS min_occupied
        FROM vw_room_type_availability
        WHERE company_id  = ${companyId}
          AND lodging_type = ${lodging_type as string}
          AND check_date BETWEEN ${new Date(checkin_date as string)}::date
              AND (${new Date(checkout_date as string)}::date - INTERVAL '1 day')
        GROUP BY room_type_id, room_type_name, daily_rate, total_capacity
        ORDER BY daily_rate::numeric ASC
      `
    )

    const days = Math.ceil(
      (new Date(checkout_date as string).getTime() - new Date(checkin_date as string).getTime()) / 86400000
    )

    res.json(
      rows.map((r) => ({
        room_type_id: r.room_type_id,
        room_type_name: r.room_type_name,
        daily_rate: Number(r.daily_rate),
        total_amount: Number(r.daily_rate) * days,
        days,
        total_capacity: r.total_capacity,
        available_capacity: Number(r.min_available),
        available: Number(r.min_available) > 0,
      }))
    )
  } catch (error) {
    console.error('Error getting room type availability:', error)
    res.status(500).json({ error: 'Failed to get room type availability' })
  }
}
