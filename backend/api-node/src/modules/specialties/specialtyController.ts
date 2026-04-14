import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'

// ─── GET /specialties ─────────────────────────────────────────────────────────

export async function listSpecialties(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { is_active } = req.query

    const where: any = { companyId }
    if (is_active !== undefined) where.isActive = is_active === 'true'

    const specialties = await prisma.petshopSpecialty.findMany({
      where,
      orderBy: { name: 'asc' },
    })

    res.json(specialties)
  } catch (error) {
    console.error('Error listing specialties:', error)
    res.status(500).json({ error: 'Failed to list specialties' })
  }
}

// ─── GET /specialties/:id ─────────────────────────────────────────────────────

export async function getSpecialty(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const id = req.params.id!

    const specialty = await prisma.petshopSpecialty.findUnique({
      where: { id },
      include: {
        services: { where: { isActive: true }, select: { id: true, name: true, price: true, priceBySize: true, durationMin: true } },
      },
    })

    if (!specialty || specialty.companyId !== companyId) {
      return res.status(404).json({ error: 'Specialty not found' })
    }

    res.json(specialty)
  } catch (error) {
    console.error('Error getting specialty:', error)
    res.status(500).json({ error: 'Failed to get specialty' })
  }
}

// ─── POST /specialties ────────────────────────────────────────────────────────

export async function createSpecialty(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { name, color, description } = req.body

    if (!name) return res.status(400).json({ error: 'name é obrigatório' })

    const specialty = await prisma.petshopSpecialty.create({
      data: { companyId, name, color, description, isActive: true },
    })

    res.status(201).json(specialty)
  } catch (error: any) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'Já existe uma especialidade com este nome' })
    console.error('Error creating specialty:', error)
    res.status(500).json({ error: 'Failed to create specialty' })
  }
}

// ─── PATCH /specialties/:id ───────────────────────────────────────────────────

export async function updateSpecialty(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const id = req.params.id!
    const { name, color, description, is_active } = req.body

    const existing = await prisma.petshopSpecialty.findUnique({ where: { id } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Specialty not found' })
    }

    const data: any = {}
    if (name !== undefined) data.name = name
    if (color !== undefined) data.color = color
    if (description !== undefined) data.description = description
    if (is_active !== undefined) data.isActive = is_active

    const specialty = await prisma.petshopSpecialty.update({ where: { id }, data })

    if (is_active === false) {
      await prisma.petshopService.updateMany({
        where: { specialtyId: id, companyId },
        data: { isActive: false },
      })
    }

    res.json(specialty)
  } catch (error: any) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'Já existe uma especialidade com este nome' })
    console.error('Error updating specialty:', error)
    res.status(500).json({ error: 'Failed to update specialty' })
  }
}

// ─── DELETE /specialties/:id ──────────────────────────────────────────────────

export async function deleteSpecialty(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const id = req.params.id!

    const existing = await prisma.petshopSpecialty.findUnique({ where: { id } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Specialty not found' })
    }

    await prisma.petshopSpecialty.update({ where: { id }, data: { isActive: false } })
    await prisma.petshopService.updateMany({
      where: { specialtyId: id, companyId },
      data: { isActive: false },
    })
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting specialty:', error)
    res.status(500).json({ error: 'Failed to delete specialty' })
  }
}
