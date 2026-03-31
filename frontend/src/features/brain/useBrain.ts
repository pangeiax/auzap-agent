import { useState, useCallback, useEffect } from 'react'
import { BrainMessage } from './brain.types'
import { sendBrainMessage, fetchBrainSuggestions } from './brain.api'
import { splitAssistantReply } from './parseAssistantStructured'

/** Em HTTP (não-localhost), `crypto.randomUUID` costuma não existir; fallback evita quebra em produção. */
function newBrainMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Alinhadas ao segundo cérebro (agenda, faturamento, hotel/creche, clientes, sentimento) e ao resumo do contexto — até carregar sugestões do servidor. */
const FALLBACK_SUGGESTIONS = [
  'Quem está na minha agenda hoje e o que já está confirmado?',
  'Quais agendamentos pendentes nos próximos 7 dias?',
  'Como foi meu faturamento mês a mês nos últimos 6 meses?',
  'Quais serviços mais puxam o faturamento e qual o ticket médio?',
  'Tem vaga de hotel e creche nos próximos 14 dias?',
  'Quais tutores sumiram há mais de 45 dias para eu planejar reativação?',
  'Quais pets fazem aniversário nos próximos 7 dias?',
  'Quem aparece com risco alto de churn neste mês segundo o sentimento?',
  'Tenho atendimentos concluídos sem valor registrado no caixa?',
  'Qual minha conversão pelo WhatsApp e quantos clientes ativos eu tenho?',
]

function pickTwoRandom(pool: string[]): string[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 2)
}

export function useBrain() {
  const [messages, setMessages] = useState<BrainMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>(() => pickTwoRandom(FALLBACK_SUGGESTIONS))

  useEffect(() => {
    let cancelled = false
    fetchBrainSuggestions()
      .then((list) => {
        if (cancelled || list.length < 2) return
        setSuggestions(list.slice(0, 2))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return

    const userMsg: BrainMessage = { id: newBrainMessageId(), role: 'user', content: text }
    const loadingMsg: BrainMessage = { id: newBrainMessageId(), role: 'assistant', content: '', loading: true }

    setMessages(prev => [...prev, userMsg, loadingMsg])
    setLoading(true)

    try {
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }))
      const result = await sendBrainMessage(text, history)
      const { displayText, structured } = splitAssistantReply(result.reply)

      setMessages(prev => [
        ...prev.slice(0, -1),
        {
          id: newBrainMessageId(),
          role: 'assistant',
          content: displayText || result.reply,
          ...(structured ? { structured } : {}),
        },
      ])
    } catch {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { id: newBrainMessageId(), role: 'assistant', content: 'Não consegui processar sua pergunta. Tente novamente.' },
      ])
    } finally {
      setLoading(false)
    }
  }, [messages, loading])

  const clear = useCallback(() => {
    setMessages([])
    fetchBrainSuggestions()
      .then((list) => {
        if (list.length >= 2) setSuggestions(list.slice(0, 2))
      })
      .catch(() => {})
  }, [])

  return { messages, suggestions, loading, sendMessage, clear }
}
