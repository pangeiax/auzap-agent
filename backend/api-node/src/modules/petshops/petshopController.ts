import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { attachBusinessHoursToPetshopJson } from '../../lib/businessHoursTable'

// GET /petshops — lista restrita à empresa do usuário
export async function listPetshops(req: Request, res: Response) {
  try {
    const { skip = 0, limit = 50, is_active } = req.query
    const where: { companyId: number; isActive?: boolean } = { companyId: req.user!.companyId }
    if (is_active !== undefined) where.isActive = is_active === 'true'

    const petshops = await prisma.petshopProfile.findMany({
      where,
      skip: parseInt(skip as string),
      take: parseInt(limit as string),
      include: { company: true },
      orderBy: { createdAt: 'desc' },
    })

    const withHours = await Promise.all(petshops.map((p) => attachBusinessHoursToPetshopJson(p)))
    res.json(withHours)
  } catch (error) {
    console.error('Error listing petshops:', error)
    res.status(500).json({ error: 'Failed to list petshops' })
  }
}

// GET /petshops/:petshopId
export async function getPetshop(req: Request, res: Response) {
  try {
    const { petshopId } = req.params
    const petshop = await prisma.petshopProfile.findUnique({
      where: { id: parseInt(petshopId as any) },
      include: { company: true },
    })
    if (!petshop) return res.status(404).json({ error: 'Petshop not found' })
    if (petshop.companyId !== req.user!.companyId) {
      return res.status(403).json({ error: 'Acesso negado' })
    }
    res.json(await attachBusinessHoursToPetshopJson(petshop))
  } catch (error) {
    console.error('Error getting petshop:', error)
    res.status(500).json({ error: 'Failed to get petshop' })
  }
}

// POST /petshops
export async function createPetshop(req: Request, res: Response) {
  try {
    const { company_id, address, cep, phone, latitude, longitude, owner_phone, emergency_contact, assistant_name } = req.body
    if (!company_id || !phone) return res.status(400).json({ error: 'company_id and phone are required' })
    if (Number(company_id) !== req.user!.companyId) {
      return res.status(403).json({ error: 'company_id deve ser o da sua conta' })
    }

    const existing = await prisma.petshopProfile.findUnique({ where: { companyId: company_id } })
    if (existing) return res.status(409).json({ error: 'Petshop already exists for this company' })

    const petshop = await prisma.petshopProfile.create({
      data: {
        companyId: company_id,
        address,
        cep,
        phone,
        latitude,
        longitude,
        ownerPhone: owner_phone,
        emergencyContact: emergency_contact,
        assistantName: assistant_name,
        isActive: true,
      },
      include: { company: true },
    })

    res.status(201).json(await attachBusinessHoursToPetshopJson(petshop))
  } catch (error) {
    console.error('Error creating petshop:', error)
    res.status(500).json({ error: 'Failed to create petshop' })
  }
}

// PATCH /petshops/:petshopId
export async function updatePetshop(req: Request, res: Response) {
  try {
    const { petshopId } = req.params
    const { address, cep, phone, latitude, longitude, owner_phone, emergency_contact, assistant_name, company_name, is_active } = req.body

    const existing = await prisma.petshopProfile.findUnique({ where: { id: parseInt(petshopId as any) } })
    if (!existing) return res.status(404).json({ error: 'Petshop not found' })
    if (existing.companyId !== req.user!.companyId) {
      return res.status(403).json({ error: 'Acesso negado' })
    }

    if (company_name !== undefined) {
      await prisma.saasCompany.update({ where: { id: existing.companyId }, data: { name: company_name } })
    }

    const data: any = {}
    if (address !== undefined) data.address = address
    if (cep !== undefined) data.cep = cep
    if (phone !== undefined) data.phone = phone
    if (latitude !== undefined) data.latitude = latitude
    if (longitude !== undefined) data.longitude = longitude
    if (owner_phone !== undefined) data.ownerPhone = owner_phone
    if (emergency_contact !== undefined) data.emergencyContact = emergency_contact
    if (assistant_name !== undefined) data.assistantName = assistant_name
    if (is_active !== undefined) data.isActive = is_active

    const petshop = await prisma.petshopProfile.update({
      where: { id: parseInt(petshopId as any) },
      data,
      include: { company: true },
    })

    res.json(await attachBusinessHoursToPetshopJson(petshop))
  } catch (error) {
    console.error('Error updating petshop:', error)
    res.status(500).json({ error: 'Failed to update petshop' })
  }
}

// GET /petshops/info/company
export async function getPetshopInfo(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const petshop = await prisma.petshopProfile.findUnique({
      where: { companyId },
      include: { company: true },
    })
    if (!petshop) return res.status(404).json({ error: 'Petshop not found' })
    res.json(await attachBusinessHoursToPetshopJson(petshop))
  } catch (error) {
    console.error('Error getting petshop info:', error)
    res.status(500).json({ error: 'Failed to get petshop info' })
  }
}
