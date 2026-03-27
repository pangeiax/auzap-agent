import { useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { DashboardChatInput } from '@/components/molecules/DashboardChatInput'
import { Markdown } from '@/components/atoms/Markdown'
import { SpeechVisualization } from '@/components/molecules/SpeechVisualization'
import { ScrollIndicator } from '@/components/atoms/ScrollIndicator'
import { getImage } from '@/assets/images'
import { cn } from '@/lib/cn'
import { useBrain } from './useBrain'

interface Props {
  userName: string;
  assistantName?: string;
}

function TypingIndicator() {
  return (
    <div className="flex min-w-0 items-end gap-2 sm:gap-4 flex-row">
      <img
        src={getImage('logo_main').src}
        alt="AuZap.IA"
        width={55}
        height={60}
        className="hidden shrink-0 sm:block"
      />
      <div
        className="rounded-[0px_23px_23px_23px] border border-[#727B8E1A] bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] px-5 py-4"
        style={{ maxWidth: 'min(100%, 586px)' }}
      >
        <div className="flex items-center gap-1.5" aria-label="IA digitando">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-2 w-2 rounded-full bg-[#727B8E] dark:bg-[#8a94a6]"
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 0.6, repeat: Infinity, ease: 'easeInOut', delay: i * 0.15 }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function ChatBubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const isSent = role === 'user'
  return (
    <div className={cn('flex min-w-0 items-end gap-2 sm:gap-4', isSent ? 'flex-row-reverse' : 'flex-row')}>
      {!isSent && (
        <img
          src={getImage('logo_main').src}
          alt="AuZap.IA logo"
          width={55}
          height={60}
          className="hidden shrink-0 sm:block"
        />
      )}
      <div
        className={cn(
          'px-6 py-3.5 text-sm leading-6',
          isSent
            ? 'rounded-[23px_0px_23px_23px] bg-[#0F172A] text-white'
            : 'rounded-[0px_23px_23px_23px] border border-[#727B8E1A] bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] text-[#434A57] dark:text-[#f5f9fc]'
        )}
        style={{ maxWidth: 'min(100%, 586px)' }}
      >
        <Markdown
          className={cn(
            isSent
              ? 'prose-invert [&_*]:text-white [&_code]:bg-white/10 [&_pre]:bg-white/10'
              : '[&_*]:text-[#434A57] dark:[&_*]:text-[#f5f9fc] [&_code]:bg-gray-100 dark:[&_code]:bg-gray-800 [&_pre]:bg-gray-100 dark:[&_pre]:bg-gray-800',
          )}
        >
          {content}
        </Markdown>
      </div>
    </div>
  )
}

export function BrainChat({ userName, assistantName = 'AuZap' }: Props) {
  const { messages, suggestions, loading, sendMessage, clear } = useBrain()
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const hasMessages = messages.length > 0
  const firstName = userName.split(' ')[0]

  const brainPairs: [string, string][] | undefined =
    suggestions.length >= 2 ? [[suggestions[0]!, suggestions[1]!]] : undefined

  useEffect(() => {
    if (hasMessages && chatContainerRef.current) {
      setTimeout(() => {
        const el = chatContainerRef.current
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      }, 100)
    }
  }, [messages, hasMessages])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="mx-auto flex w-full flex-col items-center px-4 lg:px-6 xl:px-10 min-h-[calc(100vh-75px)] relative"
    >
      <div className="my-auto w-full">
        <AnimatePresence mode="wait">
          {!hasMessages ? (
            <motion.div
              key="greeting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col items-center"
            >
              <div className="mb-5">
                <SpeechVisualization size={120} idlePulse className="gap-0" />
              </div>
              <h1 className="mb-1 text-2xl font-medium text-[#434A57] dark:text-[#f5f9fc]">
                Bom te ver novamente, {firstName}!
              </h1>
              <p className="mb-10 text-sm text-[#727B8E] dark:text-[#8a94a6] text-center">
                {assistantName} — Pergunte qualquer coisa sobre o comercial do seu negócio
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
            >
              <div
                ref={chatContainerRef}
                className="mb-8 flex w-full max-w-[775px] mx-auto flex-col gap-7 overflow-y-auto h-[min(50vh,450px)] sm:h-[450px] scrollbar-hide"
              >
                {messages.map(msg =>
                  msg.loading
                    ? <TypingIndicator key={msg.id} />
                    : <ChatBubble key={msg.id} role={msg.role} content={msg.content} />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="w-full">
          <DashboardChatInput
            onSend={sendMessage}
            showQuickActions={!hasMessages || messages.length < 2}
            disabled={loading}
            quickActionsPairs={brainPairs}
          />
        </div>

        {hasMessages && (
          <div className="mx-auto mt-3 flex w-full max-w-[770px] justify-start">
            <button
              onClick={clear}
              className="text-xs text-[#727B8E] hover:text-[#434A57] dark:text-[#8a94a6] dark:hover:text-[#f5f9fc] transition-colors"
            >
              ↺ Nova conversa
            </button>
          </div>
        )}
      </div>

      {!hasMessages && (
        <div className="mt-auto py-8 flex justify-center w-full">
          <ScrollIndicator />
        </div>
      )}
    </motion.div>
  )
}
