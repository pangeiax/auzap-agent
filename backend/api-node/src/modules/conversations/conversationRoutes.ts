import { Router } from 'express'
import { verifyToken } from '../../middleware/authMiddleware'
import {
  listConversations,
  getConversation,
  getMessages,
  sendMessage,
  getAnalysis,
  toggleAI,
  searchMessages,
  updateConversationStage,
} from './conversationController'

const router = Router()

// Apply auth middleware to all routes
router.use(verifyToken)

// GET /conversations - List all conversations
router.get('/', listConversations)

// GET /conversations/search - Search conversations
router.get('/search', searchMessages)

// GET /conversations/:conversationId - Get conversation details
router.get('/:conversationId', getConversation)

// GET /conversations/:conversationId/messages - Get messages
router.get('/:conversationId/messages', getMessages)

// POST /conversations/:conversationId/message - Send message
router.post('/:conversationId/message', sendMessage)

// GET /conversations/:conversationId/analysis - Get analysis
router.get('/:conversationId/analysis', getAnalysis)

// PUT /conversations/:conversationId/toggle-ai - Toggle AI
router.put('/:conversationId/toggle-ai', toggleAI)

// PUT /conversations/:conversationId/stage - Update pipeline stage
router.put('/:conversationId/stage', updateConversationStage)

export default router
