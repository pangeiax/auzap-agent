import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'

// GET /pets - List all pets for the company
export async function listPets(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { client_id, species, limit = 50, offset = 0 } = req.query

    const where: any = { companyId }

    if (client_id) {
      where.clientId = client_id
    }

    if (species) {
      where.species = species
    }

    const pets = await prisma.petshopPet.findMany({
      where,
      skip: parseInt(offset as string),
      take: parseInt(limit as string),
      include: {
        client: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    res.json(pets)
  } catch (error) {
    console.error('Error listing pets:', error)
    res.status(500).json({ error: 'Failed to list pets' })
  }
}

// GET /pets/:petId - Get pet details
export async function getPet(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const petId = req.params.petId!

    const pet = await prisma.petshopPet.findUnique({
      where: { id: petId },
      include: {
        client: true,
        appointments: {
          include: { service: true, schedule: true },
          orderBy: { scheduledDate: 'desc' },
        },
      },
    })

    if (!pet || pet.companyId !== companyId) {
      return res.status(404).json({ error: 'Pet not found' })
    }

    res.json(pet)
  } catch (error) {
    console.error('Error getting pet:', error)
    res.status(500).json({ error: 'Failed to get pet' })
  }
}

// POST /pets - Create a new pet
export async function createPet(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { client_id, name, species, breed, age, size, weight, color, medical_info, vaccination_date, last_vet_visit, emergency_contact, photo_url } = req.body

    if (!client_id || !name) {
      return res.status(400).json({ error: 'client_id and name are required' })
    }

    // Verify client exists and belongs to company
    const client = await prisma.client.findUnique({
      where: { id: client_id },
    })

    if (!client || client.companyId !== companyId) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const pet = await prisma.petshopPet.create({
      data: {
        companyId,
        clientId: client_id as string,
        name,
        species,
        breed,
        size,
        notes: medical_info ? JSON.stringify(medical_info) : null,
      },
    })

    res.status(201).json(pet)
  } catch (error) {
    console.error('Error creating pet:', error)
    res.status(500).json({ error: 'Failed to create pet' })
  }
}

// PUT /pets/:petId - Update pet
export async function updatePet(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const petId = req.params.petId!
    const updateData = req.body

    const existing = await prisma.petshopPet.findUnique({
      where: { id: petId },
    })

    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Pet not found' })
    }

    const pet = await prisma.petshopPet.update({
      where: { id: petId },
      data: updateData,
    })

    res.json(pet)
  } catch (error) {
    console.error('Error updating pet:', error)
    res.status(500).json({ error: 'Failed to update pet' })
  }
}

// DELETE /pets/:petId - Delete pet
export async function deletePet(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const petId = req.params.petId!

    const existing = await prisma.petshopPet.findUnique({
      where: { id: petId },
    })

    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Pet not found' })
    }

    await prisma.petshopPet.delete({
      where: { id: petId },
    })

    res.json({ success: true, message: 'Pet deleted' })
  } catch (error) {
    console.error('Error deleting pet:', error)
    res.status(500).json({ error: 'Failed to delete pet' })
  }
}

// GET /clients/:clientId/pets - Get pets for a specific client
export async function getClientPets(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const clientId = req.params.clientId!

    // Verify client exists
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    })

    if (!client || client.companyId !== companyId) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const pets = await prisma.petshopPet.findMany({
      where: {
        clientId,
        companyId,
      },
      orderBy: { createdAt: 'desc' },
    })

    res.json(pets)
  } catch (error) {
    console.error('Error getting client pets:', error)
    res.status(500).json({ error: 'Failed to get client pets' })
  }
}
