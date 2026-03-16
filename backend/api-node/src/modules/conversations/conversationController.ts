import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'

// GET /conversations - List all conversations
export async function listConversations(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { client_id, status, limit = 50, offset = 0 } = req.query

    const where: any = { companyId }

    if (client_id) {
      where.clientId = client_id
    }

    const conversations = await prisma.agentConversation.findMany({
      where,
      skip: parseInt(offset as string),
      take: parseInt(limit as string),
      include: {
        client: true,
        _count: { select: { messages: true } },
      },
      orderBy: { lastMessageAt: 'desc' },
    })

    const shaped = conversations.map((conv) => ({
      id: conv.id,
      conversation_id: conv.id,
      client_id: conv.clientId,
      client_name: conv.client?.name ?? null,
      client_phone: conv.client?.phone ?? conv.whatsappNumber ?? null,
      message_count: conv._count.messages,
      last_message_at: conv.lastMessageAt,
      started_at: conv.startedAt,
      ai_paused: conv.client?.aiPaused ?? false,
      stage: conv.client?.conversationStage ?? null,
      kanban_column: conv.client?.kanbanColumn ?? null,
    }))

    res.json(shaped)
  } catch (error) {
    console.error('Error listing conversations:', error)
    res.status(500).json({ error: 'Failed to list conversations' })
  }
}

// GET /conversations/:conversationId - Get conversation details with messages
export async function getConversation(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const conversationId = req.params.conversationId!
    const { limit = 50, offset = 0 } = req.query

    const conversation = await prisma.agentConversation.findUnique({
      where: { id: conversationId },
      include: {
        client: true,
        messages: {
          skip: parseInt(offset as string),
          take: parseInt(limit as string),
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!conversation || conversation.companyId !== companyId) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    res.json(conversation)
  } catch (error) {
    console.error('Error getting conversation:', error)
    res.status(500).json({ error: 'Failed to get conversation' })
  }
}

// GET /conversations/:conversationId/messages - Get messages for a conversation
export async function getMessages(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const conversationId = req.params.conversationId!
    const { limit = 50, offset = 0 } = req.query

    const conversation = await prisma.agentConversation.findUnique({
      where: { id: conversationId },
    })

    if (!conversation || conversation.companyId !== companyId) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    const messages = await prisma.agentMessage.findMany({
      where: { conversationId },
      skip: parseInt(offset as string),
      take: parseInt(limit as string),
      orderBy: { createdAt: 'asc' },
    })

    res.json(messages)
  } catch (error) {
    console.error('Error getting messages:', error)
    res.status(500).json({ error: 'Failed to get messages' })
  }
}

// POST /conversations/:conversationId/message - Send a message
export async function sendMessage(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const conversationId = req.params.conversationId!
    const { role, content } = req.body

    if (!role || !content) {
      return res.status(400).json({ error: 'role and content are required' })
    }

    const conversation = await prisma.agentConversation.findUnique({
      where: { id: conversationId },
    })

    if (!conversation || conversation.companyId !== companyId) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    const message = await prisma.agentMessage.create({
      data: {
        conversationId,
        companyId,
        role,
        content,
      },
    })

    // Update conversation's lastMessageAt
    await prisma.agentConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    })

    res.status(201).json(message)
  } catch (error) {
    console.error('Error sending message:', error)
    res.status(500).json({ error: 'Failed to send message' })
  }
}

// GET /conversations/:conversationId/analysis - Get conversation analysis
export async function getAnalysis(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const conversationId = req.params.conversationId!

    const conversation = await prisma.agentConversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: true,
        client: true,
      },
    })

    if (!conversation || conversation.companyId !== companyId) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    const messageCount = conversation.messages.length
    const userMessages = conversation.messages.filter((m) => m.role === 'user')
    const assistantMessages = conversation.messages.filter((m) => m.role === 'assistant')

    res.json({
      conversation_id: conversationId,
      total_messages: messageCount,
      user_messages: userMessages.length,
      assistant_messages: assistantMessages.length,
      duration: conversation.lastMessageAt
        ? new Date(conversation.lastMessageAt).getTime() -
          new Date(conversation.startedAt || 0).getTime()
        : 0,
      specialty: conversation.client?.specialtyIdentified,
      stage: conversation.client?.conversationStage,
    })
  } catch (error) {
    console.error('Error getting analysis:', error)
    res.status(500).json({ error: 'Failed to get analysis' })
  }
}

// PUT /conversations/:conversationId/toggle-ai - Pause/resume AI
export async function toggleAI(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const conversationId = req.params.conversationId!
    const { ai_paused, ai_pause_reason } = req.body

    const conversation = await prisma.agentConversation.findUnique({
      where: { id: conversationId },
      include: { client: true },
    })

    if (!conversation || conversation.companyId !== companyId) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    if (!conversation.clientId) {
      return res.status(400).json({ error: 'Conversation has no associated client' })
    }

    const wasAiPaused = conversation.client?.aiPaused ?? false

    // Update client's AI pause status
    await prisma.client.update({
      where: { id: conversation.clientId },
      data: {
        aiPaused: ai_paused,
        aiPausedAt: ai_paused ? new Date() : null,
        aiPauseReason: ai_pause_reason ?? null,
      },
    })

    // Quando IA é reativada: notifica ai-service para logar e limpar Redis
    if (wasAiPaused && !ai_paused) {
      const phone = conversation.client?.phone ?? conversation.whatsappNumber ?? ''
      const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000'
      fetch(`${aiServiceUrl}/reactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, client_phone: phone }),
      }).catch((err) =>
        console.error(`[toggleAI][company:${companyId}] Falha ao notificar reativação no ai-service:`, err)
      )
    }

    res.json({
      success: true,
      ai_paused,
      conversation_id: conversationId,
    })
  } catch (error) {
    console.error('Error toggling AI:', error)
    res.status(500).json({ error: 'Failed to toggle AI' })
  }
}

// PUT /conversations/:conversationId/stage - Update pipeline kanban column
export async function updateConversationStage(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const conversationId = req.params.conversationId!
    const { kanban_column } = req.body

    if (!kanban_column) {
      return res.status(400).json({ error: 'kanban_column is required' })
    }

    const conversation = await prisma.agentConversation.findUnique({
      where: { id: conversationId },
    })

    if (!conversation || conversation.companyId !== companyId) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    if (!conversation.clientId) {
      return res.status(400).json({ error: 'Conversation has no associated client' })
    }

    await prisma.client.update({
      where: { id: conversation.clientId },
      data: { kanbanColumn: kanban_column },
    })

    res.json({ success: true, kanban_column, conversation_id: conversationId })
  } catch (error) {
    console.error('Error updating conversation stage:', error)
    res.status(500).json({ error: 'Failed to update conversation stage' })
  }
}

// GET /conversations/search - Search conversations by content
export async function searchMessages(req: Request, res: Response) {
  try {
    const companyId = req.user!.companyId
    const { q, client_id, limit = 10 } = req.query

    if (!q) {
      return res.status(400).json({ error: 'Search query (q) is required' })
    }

    const where: any = {
      companyId,
      content: { contains: q as string, mode: 'insensitive' },
    }

    if (client_id) {
      where.conversation = { clientId: client_id }
    }

    const messages = await prisma.agentMessage.findMany({
      where,
      take: parseInt(limit as string),
      include: {
        conversation: {
          include: { client: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    res.json(messages)
  } catch (error) {
    console.error('Error searching messages:', error)
    res.status(500).json({ error: 'Failed to search messages' })
  }
}
