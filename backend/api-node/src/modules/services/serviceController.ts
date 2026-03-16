import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'

// GET /services - List all services
export async function listServices(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { is_active } = req.query

    const where: any = { companyId }

    if (is_active !== undefined) {
      where.isActive = is_active === 'true'
    }

    const services = await prisma.petshopService.findMany({
      where,
      orderBy: { name: 'asc' },
    })

    res.json(services)
  } catch (error) {
    console.error('Error listing services:', error)
    res.status(500).json({ error: 'Failed to list services' })
  }
}

// GET /services/:serviceId - Get service details
export async function getService(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { serviceId } = req.params

    const service = await prisma.petshopService.findUnique({
      where: { id: parseInt(serviceId) },
    })

    if (!service || service.companyId !== companyId) {
      return res.status(404).json({ error: 'Service not found' })
    }

    res.json(service)
  } catch (error) {
    console.error('Error getting service:', error)
    res.status(500).json({ error: 'Failed to get service' })
  }
}

// POST /services - Create a new service
export async function createService(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { name, description, duration_min, price, price_by_size, duration_multiplier_large } =
      req.body

    if (!name) {
      return res.status(400).json({ error: 'name is required' })
    }

    const service = await prisma.petshopService.create({
      data: {
        companyId,
        name,
        description,
        durationMin: duration_min || 60,
        price: price ? parseFloat(price) : undefined,
        priceBySize: price_by_size,
        durationMultiplierLarge: duration_multiplier_large ? parseFloat(duration_multiplier_large) : undefined,
        isActive: true,
      },
    })

    res.status(201).json(service)
  } catch (error) {
    console.error('Error creating service:', error)
    res.status(500).json({ error: 'Failed to create service' })
  }
}

// PUT /services/:serviceId - Update service
export async function updateService(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { serviceId } = req.params
    const { name, description, duration_min, price, price_by_size, is_active } = req.body

    const existing = await prisma.petshopService.findUnique({
      where: { id: parseInt(serviceId) },
    })

    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Service not found' })
    }

    const service = await prisma.petshopService.update({
      where: { id: parseInt(serviceId) },
      data: {
        name,
        description,
        durationMin: duration_min,
        price: price !== undefined ? (price !== null && price !== '' ? parseFloat(String(price)) : null) : undefined,
        priceBySize: price_by_size !== undefined ? price_by_size : undefined,
        isActive: is_active,
      },
    })

    res.json(service)
  } catch (error) {
    console.error('Error updating service:', error)
    res.status(500).json({ error: 'Failed to update service' })
  }
}

// DELETE /services/:serviceId - Delete service
export async function deleteService(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { serviceId } = req.params

    const existing = await prisma.petshopService.findUnique({
      where: { id: parseInt(serviceId) },
    })

    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Service not found' })
    }

    await prisma.petshopService.delete({
      where: { id: parseInt(serviceId) },
    })

    res.json({ success: true, message: 'Service deleted' })
  } catch (error) {
    console.error('Error deleting service:', error)
    res.status(500).json({ error: 'Failed to delete service' })
  }
}

// GET /services/bookable - Get bookable services (filtrable)
export async function getBookableServices(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { specialty, pet_species, pet_size } = req.query

    const where: any = {
      companyId,
      isActive: true,
    }

    const services = await prisma.petshopService.findMany({
      where,
      orderBy: { name: 'asc' },
    })

    // Filter based on pet characteristics if provided
    let filtered = services
    if (pet_size === 'large') {
      filtered = services.filter((s) => s.durationMultiplierLarge !== null)
    }

    res.json(filtered)
  } catch (error) {
    console.error('Error getting bookable services:', error)
    res.status(500).json({ error: 'Failed to get bookable services' })
  }
}

// GET /professionals/:professionalId/services - Get services by professional
// Note: This is a placeholder since the schema doesn't have a professional field
export async function getServicesByProfessional(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId

    const services = await prisma.petshopService.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
    })

    res.json(services)
  } catch (error) {
    console.error('Error getting services:', error)
    res.status(500).json({ error: 'Failed to get services' })
  }
}
