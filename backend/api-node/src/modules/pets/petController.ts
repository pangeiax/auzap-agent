import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'

const PET_SIZE_LOOKUP: Record<string, string> = {
  // Canonical (pass-through)
  p: 'P', m: 'M', g: 'G', gg: 'GG',
  // English
  mini: 'P', small: 'P', medium: 'M', large: 'G',
  gigante: 'GG', xl: 'GG', extra_large: 'GG', 'extra grande': 'GG',
  // Portuguese
  pequeno: 'P', médio: 'M', medio: 'M', grande: 'G',
}

function normalizePetSize(size: unknown): string | undefined {
  if (typeof size !== 'string') return undefined
  const code = PET_SIZE_LOOKUP[size.toLowerCase().trim()]
  return code ?? (size.trim() || undefined)
}

function calculateAge(birthDate?: Date | null): number | null {
  if (!birthDate) return null

  const today = new Date()
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear()
  const monthDelta = today.getUTCMonth() - birthDate.getUTCMonth()

  if (
    monthDelta < 0 ||
    (monthDelta === 0 && today.getUTCDate() < birthDate.getUTCDate())
  ) {
    age -= 1
  }

  return age >= 0 ? age : null
}

function parseBirthDate(value: unknown): Date | undefined {
  if (!value) return undefined

  const parsed = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function ageToBirthDate(age: unknown): Date | undefined {
  const years = Number(age)
  if (!Number.isFinite(years) || years < 0) return undefined

  const now = new Date()
  return new Date(
    Date.UTC(
      now.getUTCFullYear() - years,
      now.getUTCMonth(),
      now.getUTCDate()
    )
  )
}

function parseWeightKg(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined

  const parsed = Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : undefined
}

function extractPetNotes(notes: unknown, medicalInfo: unknown): string | null | undefined {
  if (notes === null) return null
  if (typeof notes === 'string') {
    const normalized = notes.trim()
    return normalized || null
  }

  if (medicalInfo === null) return null
  if (typeof medicalInfo === 'string') {
    const normalized = medicalInfo.trim()
    return normalized || null
  }

  if (medicalInfo && typeof medicalInfo === 'object') {
    const data = medicalInfo as {
      notes?: string
      conditions?: string[]
      medications?: string[]
      allergies?: string[]
    }

    if (typeof data.notes === 'string' && data.notes.trim()) {
      return data.notes.trim()
    }

    const values = [
      ...(data.conditions ?? []),
      ...(data.medications ?? []),
      ...(data.allergies ?? []),
    ]
      .map((value) => value.trim())
      .filter(Boolean)

    return values.length > 0 ? values.join(', ') : null
  }

  return undefined
}

function buildPetPayload(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {}

  if (body.name !== undefined) data.name = body.name
  if (body.species !== undefined) data.species = body.species
  if (body.breed !== undefined) data.breed = body.breed

  const birthDate =
    parseBirthDate(body.birthDate ?? body.birth_date) ?? ageToBirthDate(body.age)
  if (birthDate) data.birthDate = birthDate

  const weightKg = parseWeightKg(body.weightKg ?? body.weight_kg ?? body.weight)
  if (weightKg !== undefined) data.weightKg = weightKg

  const size = normalizePetSize(body.size)
  if (size !== undefined) data.size = size

  const notes = extractPetNotes(body.notes, body.medical_info)
  if (notes !== undefined) data.notes = notes

  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive)
  if (body.is_active !== undefined) data.isActive = Boolean(body.is_active)

  return data
}

function shapePet(pet: any) {
  const birthDate = pet.birthDate
    ? new Date(pet.birthDate).toISOString().slice(0, 10)
    : null
  const weightKg = pet.weightKg != null ? Number(pet.weightKg) : null

  return {
    ...pet,
    birthDate,
    birth_date: birthDate,
    age: calculateAge(pet.birthDate),
    weightKg,
    weight_kg: weightKg,
    weight: weightKg,
    size: pet.size ?? null,
    medical_info: pet.notes ? { conditions: [pet.notes] } : null,
    is_active: pet.isActive,
  }
}

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

    res.json(pets.map((pet) => ({ ...shapePet(pet), client: pet.client })))
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

    res.json({
      ...shapePet(pet),
      client: pet.client,
      appointments: pet.appointments,
    })
  } catch (error) {
    console.error('Error getting pet:', error)
    res.status(500).json({ error: 'Failed to get pet' })
  }
}

// POST /pets - Create a new pet
export async function createPet(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { client_id, name } = req.body

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
        ...buildPetPayload(req.body),
      },
    })

    res.status(201).json(shapePet(pet))
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
    const updateData = buildPetPayload(req.body)

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

    res.json(shapePet(pet))
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

    res.json(pets.map(shapePet))
  } catch (error) {
    console.error('Error getting client pets:', error)
    res.status(500).json({ error: 'Failed to get client pets' })
  }
}
