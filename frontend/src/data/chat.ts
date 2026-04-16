export interface ChatMessage {
  id: string
  variant: 'sent' | 'received'
  message: string
  time: string
  rawDate?: string
  isRead?: boolean
  isAudio?: boolean
  audioDuration?: string
  audioUrl?: string
  /** Distingue quem enviou: 'assistant' (IA), 'staff' (humano), 'user' (cliente) */
  senderRole?: 'user' | 'assistant' | 'staff'
}

export interface ChatConversation {
  id: string
  name: string
  pets: string
  lastMessage: string
  time: string
  /** Data da última mensagem (ex: "14/04") */
  date?: string
  unreadCount: number
  isOnline: boolean
  phone: string
  // Numero do cliente (usado para envio no WhatsApp) - deve continuar vindo do `client_phone`.
  whatsappPhone?: string
  isAiPaused?: boolean
  clientId?: string
}

export const AI_RESPONSES = [
  'Entendi! Vou verificar a disponibilidade e já te retorno.',
  'Perfeito! Seu agendamento foi confirmado.',
  'Claro! Temos horários disponíveis amanhã às 10h, 14h e 16h.',
  'Obrigado por entrar em contato! Como posso ajudar?',
  'Seu pet está em boas mãos! Qualquer dúvida é só chamar.',
  'Anotado! Vou preparar tudo para a consulta.',
] as const

export const MOCK_CONVERSATIONS: ChatConversation[] = [
  {
    id: '1',
    name: 'Ana Silva',
    pets: 'Thor e Mia',
    lastMessage: 'Obrigada pelo atendimento!',
    time: '10:30',
    unreadCount: 2,
    isOnline: true,
    phone: '(11) 99999-9999',
    whatsappPhone: '(11) 99999-9999',
  },
  {
    id: '2',
    name: 'Carlos Souza',
    pets: 'Rex',
    lastMessage: 'Qual horário tem disponível?',
    time: '09:15',
    unreadCount: 0,
    isOnline: false,
    phone: '(11) 88888-8888',
    whatsappPhone: '(11) 88888-8888',
  },
  {
    id: '3',
    name: 'Maria Santos',
    pets: 'Luna',
    lastMessage: 'Preciso remarcar a consulta',
    time: 'Ontem',
    unreadCount: 1,
    isOnline: true,
    phone: '(11) 77777-7777',
    whatsappPhone: '(11) 77777-7777',
  },
]

export const MOCK_MESSAGES: Record<string, ChatMessage[]> = {
  '1': [
    {
      id: '1',
      variant: 'received',
      message: 'Olá! Gostaria de agendar uma consulta para meu cachorro.',
      time: '10:15',
    },
    {
      id: '2',
      variant: 'sent',
      message:
        'Olá, Ana! Claro, temos horários disponíveis amanhã às 14h ou 16h. Qual prefere?',
      time: '10:20',
      isRead: true,
    },
    {
      id: '3',
      variant: 'received',
      message: 'Às 14h seria perfeito! Obrigada pelo atendimento!',
      time: '10:30',
    },
  ],
  '2': [
    {
      id: '1',
      variant: 'received',
      message: 'Boa tarde! O Rex precisa de uma vacina.',
      time: '09:00',
    },
    {
      id: '2',
      variant: 'sent',
      message: 'Olá Carlos! Qual vacina o Rex precisa?',
      time: '09:10',
      isRead: true,
    },
    {
      id: '3',
      variant: 'received',
      message: 'Qual horário tem disponível?',
      time: '09:15',
    },
  ],
  '3': [
    {
      id: '1',
      variant: 'received',
      message: 'Oi! Tudo bem?',
      time: '14:00',
    },
    {
      id: '2',
      variant: 'sent',
      message: 'Olá Maria! Tudo ótimo, e você?',
      time: '14:05',
      isRead: true,
    },
    {
      id: '3',
      variant: 'received',
      message: 'Preciso remarcar a consulta',
      time: '14:10',
    },
  ],
}
