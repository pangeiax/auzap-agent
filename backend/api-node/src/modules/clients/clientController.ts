import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'

function shapeClient(client: any) {
  const { _count, ...rest } = client

  return {
    ...rest,
    is_active: client.isActive,
    total_appointments:
      _count?.appointments ?? client.total_appointments ?? undefined,
    total_pets: _count?.pets ?? client.total_pets ?? undefined,
    total_conversations:
      _count?.conversations ?? client.total_conversations ?? undefined,
  }
}

// GET /clients - List all clients for the company
export async function listClients(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { search, is_active, stage, limit = 50, offset = 0 } = req.query

    const where: any = { companyId }

    if (is_active !== undefined) {
      where.isActive = is_active === 'true'
    }

    if (stage) {
      where.conversationStage = stage
    }

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ]
    }

    const clients = await prisma.client.findMany({
      where,
      skip: parseInt(offset as string),
      take: parseInt(limit as string),
      include: {
        conversations: { take: 1, orderBy: { startedAt: 'desc' } },
        _count: { select: { appointments: true, pets: true, conversations: true } },
      },
      orderBy: { lastMessageAt: 'desc' },
    })

    res.json(clients.map(shapeClient))
  } catch (error) {
    console.error('Error listing clients:', error)
    res.status(500).json({ error: 'Failed to list clients' })
  }
}

// GET /clients/search - Search clients
export async function searchClients(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { q, limit = 10 } = req.query

    if (!q) {
      return res.status(400).json({ error: 'Search query (q) is required' })
    }

    const clients = await prisma.client.findMany({
      where: {
        companyId,
        OR: [
          { name: { contains: q as string, mode: 'insensitive' } },
          { phone: { contains: q as string, mode: 'insensitive' } },
          { email: { contains: q as string, mode: 'insensitive' } },
          { companyName: { contains: q as string, mode: 'insensitive' } },
        ],
      },
      take: parseInt(limit as string),
    })

    res.json(clients)
  } catch (error) {
    console.error('Error searching clients:', error)
    res.status(500).json({ error: 'Failed to search clients' })
  }
}

// GET /clients/:clientId - Get client details
export async function getClientDetails(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { clientId } = req.params as { clientId: string }

    const client = await prisma.client.findUnique({
      where: { id: clientId },
    })

    if (!client || client.companyId !== companyId) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const conversations = await prisma.agentConversation.findMany({
      where: { clientId },
      include: { messages: true },
      orderBy: { startedAt: 'desc' },
    })

    const pets = await prisma.petshopPet.findMany({
      where: { clientId, companyId },
    })

    const appointments = await prisma.petshopAppointment.findMany({
      where: { clientId },
      include: { service: true, schedule: true },
      orderBy: { scheduledDate: 'desc' },
    })

    res.json({
      ...shapeClient(client),
      conversations,
      pets,
      appointments,
    })
  } catch (error) {
    console.error('Error getting client details:', error)
    res.status(500).json({ error: 'Failed to get client details' })
  }
}

// POST /clients - Create a new client
export async function createClient(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const {
      phone,
      manualPhone,
      manual_phone,
      name,
      email,
      companyName,
      conversationStage,
      notes,
      is_active,
    } = req.body

    const phoneValue = String(phone ?? '').trim()
    const manualPhoneValueRaw = manualPhone ?? manual_phone
    const manualPhoneValue =
      manualPhoneValueRaw === undefined || manualPhoneValueRaw === null
        ? undefined
        : String(manualPhoneValueRaw).trim()

    if (!phoneValue) {
      return res.status(400).json({ error: 'Phone is required' })
    }

    const client = await prisma.client.create({
      data: {
        companyId,
        phone: phoneValue,
        ...(manualPhoneValue ? { manualPhone: manualPhoneValue } : {}),
        name,
        email,
        companyName,
        conversationStage,
        notes,
        isActive: is_active !== undefined ? Boolean(is_active) : true,
      },
    })

    res.status(201).json(shapeClient(client))
  } catch (error: any) {
    console.error('Error creating client:', error)
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Client with this phone already exists' })
    }
    res.status(500).json({ error: 'Failed to create client' })
  }
}

// PUT /clients/:clientId - Update client
export async function updateClient(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { clientId } = req.params as { clientId: string }
    const updateData: any = { ...req.body }

    if (updateData.is_active !== undefined) {
      updateData.isActive = Boolean(updateData.is_active)
      delete updateData.is_active
    }

    if (updateData.manual_phone !== undefined) {
      updateData.manualPhone = String(updateData.manual_phone).trim()
      delete updateData.manual_phone
    }

    const existing = await prisma.client.findUnique({ where: { id: clientId } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const client = await prisma.client.update({
      where: { id: clientId },
      data: updateData,
    })

    res.json(shapeClient(client))
  } catch (error) {
    console.error('Error updating client:', error)
    res.status(500).json({ error: 'Failed to update client' })
  }
}

// DELETE /clients/:clientId - Delete client
export async function deleteClient(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { clientId } = req.params as { clientId: string }

    const existing = await prisma.client.findUnique({ where: { id: clientId } })
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ error: 'Client not found' })
    }

    await prisma.client.delete({ where: { id: clientId } })

    res.json({ success: true, client_id: clientId })
  } catch (error) {
    console.error('Error deleting client:', error)
    res.status(500).json({ error: 'Failed to delete client' })
  }
}

// GET /clients/:clientId/conversations - Get client conversations
export async function getClientConversations(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { clientId } = req.params as { clientId: string }
    const { limit = 50, offset = 0 } = req.query

    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (!client || client.companyId !== companyId) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const conversations = await prisma.agentConversation.findMany({
      where: { clientId },
      skip: parseInt(offset as string),
      take: parseInt(limit as string),
      include: {
        _count: {
          select: { messages: true },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    })

    const total = await prisma.agentConversation.count({ where: { clientId } })

    res.json({
      client_id: clientId,
      conversations: conversations.map((conv) => ({
        conversation_id: conv.id,
        message_count: conv._count?.messages ?? 0,
        started_at: conv.startedAt?.toISOString(),
        last_message_at:
          conv.lastMessageAt?.toISOString() ?? conv.startedAt?.toISOString(),
      })),
      total,
    })
  } catch (error) {
    console.error('Error getting client conversations:', error)
    res.status(500).json({ error: 'Failed to get client conversations' })
  }
}

// GET /clients/:clientId/pets - Get client pets
export async function getClientPets(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { clientId } = req.params as { clientId: string }

    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (!client || client.companyId !== companyId) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const pets = await prisma.petshopPet.findMany({
      where: { clientId, companyId },
    })

    res.json(pets)
  } catch (error) {
    console.error('Error getting client pets:', error)
    res.status(500).json({ error: 'Failed to get client pets' })
  }
}

// GET /clients/:clientId/context - Get client context for AI
export async function getClientContext(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { clientId } = req.params as { clientId: string }

    const client = await prisma.client.findUnique({
      where: { id: clientId },
    })

    if (!client || client.companyId !== companyId) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const pets = await prisma.petshopPet.findMany({
      where: { clientId, companyId },
    })

    const appointments = await prisma.petshopAppointment.findMany({
      where: { clientId },
      take: 5,
      orderBy: { scheduledDate: 'desc' },
      include: { service: true },
    })

    res.json({
      client_id: clientId,
      name: client.name,
      phone: client.phone,
      manual_phone: (client as any).manualPhone ?? undefined,
      email: client.email,
      conversation_stage: client.conversationStage,
      specialty_identified: client.specialtyIdentified,
      professional_preference: client.professionalPreference,
      pets,
      recent_appointments: appointments,
      notes: client.notes,
    })
  } catch (error) {
    console.error('Error getting client context:', error)
    res.status(500).json({ error: 'Failed to get client context' })
  }
}

// GET /clients/:clientId/activities - Get client activities
export async function getClientActivities(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { clientId } = req.params as { clientId: string }
    const { limit = 20, offset = 0 } = req.query

    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (!client || client.companyId !== companyId) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const messages = await prisma.agentMessage.findMany({
      where: { conversation: { clientId } },
      skip: parseInt(offset as string),
      take: parseInt(limit as string),
      orderBy: { createdAt: 'desc' },
      include: { conversation: true },
    })

    res.json(
      messages.map((msg) => ({
        id: msg.id,
        type: 'message',
        role: msg.role,
        content: msg.content,
        timestamp: msg.createdAt?.toISOString(),
        conversation_id: msg.conversationId,
      }))
    )
  } catch (error) {
    console.error('Error getting client activities:', error)
    res.status(500).json({ error: 'Failed to get client activities' })
  }
}

// POST /clients/import - Import clients from file
export async function importClients(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId

    const file = (req as any).file
    if (!file) {
      return res.status(400).json({ error: 'File is required' })
    }

    // Parse CSV or JSON file
    const content = file.buffer.toString('utf-8')
    const lines = content.split('\n').filter((line: string) => line.trim())

    const imported: string[] = []
    const failed: string[] = []

    for (const line of lines) {
      try {
        const [phone, name, email, companyName] = line.split(',').map((s: string) => s.trim())

        if (!phone) continue

        const existing = await prisma.client.findFirst({
          where: { companyId, phone },
        })

        if (existing) {
          await prisma.client.update({
            where: { id: existing.id },
            data: { name, email, companyName },
          })
        } else {
          await prisma.client.create({
            data: { companyId, phone, name, email, companyName, isActive: true },
          })
        }

        imported.push(phone)
      } catch (err) {
        failed.push(line)
      }
    }

    res.json({
      total: imported.length + failed.length,
      imported: imported.length,
      failed: failed.length,
      failed_rows: failed,
    })
  } catch (error) {
    console.error('Error importing clients:', error)
    res.status(500).json({ error: 'Failed to import clients' })
  }
}
