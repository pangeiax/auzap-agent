import { useState, useCallback, useEffect } from 'react'
import { BrainMessage } from './brain.types'
import { sendBrainMessage, fetchBrainSuggestions } from './brain.api'

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

/** Alinhadas às tools do second brain — usadas até carregar sugestões do servidor. */
const FALLBACK_SUGGESTIONS = [
  'Como está minha agenda de hoje, com quem já confirmou?',
  'Quais agendamentos estão previstos para os próximos 7 dias?',
  'Quanto faturei mês a mês nos últimos 6 meses?',
  'Quais serviços mais faturam e qual o ticket médio de cada um?',
  'Há vagas no hotel ou na creche nos próximos 14 dias?',
  'Quais clientes estão há mais de 45 dias sem agendar?',
  'Quais pets fazem aniversário nos próximos 7 dias?',
  'Quais clientes aparecem com risco alto de churn neste mês?',
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

      setMessages(prev => [
        ...prev.slice(0, -1),
        { id: newBrainMessageId(), role: 'assistant', content: result.reply },
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
