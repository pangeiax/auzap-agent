import { useRef, useEffect, Fragment } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { DashboardChatInput } from '@/components/molecules/DashboardChatInput'
import { Markdown } from '@/components/atoms/Markdown'
import { SpeechVisualization } from '@/components/molecules/SpeechVisualization'
import { ScrollIndicator } from '@/components/atoms/ScrollIndicator'
import { getImage } from '@/assets/images'
import { useBrain } from './useBrain'
import type { BrainMessage } from './brain.types'
import type { BrainStructuredUi } from './parseAssistantStructured'
import { AppointmentSchedulingDraft } from './AppointmentSchedulingDraft'
import { BrainAgendaConfirmPanels } from './BrainAgendaConfirmPanels'
import { CampaignDraft } from './CampaignDraft'

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

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex min-w-0 items-end gap-2 sm:gap-4 flex-row-reverse">
      <div
        className="rounded-[23px_0px_23px_23px] bg-[#0F172A] px-6 py-3.5 text-sm leading-6 text-white"
        style={{ maxWidth: 'min(100%, 586px)' }}
      >
        <Markdown className="prose-invert [&_*]:text-white [&_code]:bg-white/10 [&_pre]:bg-white/10">
          {content}
        </Markdown>
      </div>
    </div>
  )
}

function assistantStructuredList(msg: BrainMessage): BrainStructuredUi[] {
  const s = msg.structured
  if (!s) return []
  return Array.isArray(s) ? s : [s]
}

function AssistantBubble({ msg }: { msg: BrainMessage }) {
  const structs = assistantStructuredList(msg)
  return (
    <div className="flex min-w-0 items-end gap-2 sm:gap-4 flex-row">
      <img
        src={getImage('logo_main').src}
        alt="AuZap.IA logo"
        width={55}
        height={60}
        className="hidden shrink-0 sm:block"
      />
      <div
        className="rounded-[0px_23px_23px_23px] border border-[#727B8E1A] bg-white px-6 py-3.5 text-sm leading-6 text-[#434A57] dark:border-[#40485A] dark:bg-[#1A1B1D] dark:text-[#f5f9fc]"
        style={{ maxWidth: 'min(100%, 586px)' }}
      >
        {msg.content.trim().length > 0 && (
          <Markdown className="[&_*]:text-[#434A57] dark:[&_*]:text-[#f5f9fc] [&_code]:bg-gray-100 dark:[&_code]:bg-gray-800 [&_pre]:bg-gray-100 dark:[&_pre]:bg-gray-800">
            {msg.content}
          </Markdown>
        )}
        {structs.map((st, idx) => (
          <Fragment key={idx}>
            {st.type === 'campaign_draft' && (
              <CampaignDraft
                clients={st.clients}
                message={st.message}
                maxRecipientsPerSend={st.max_recipients_per_send}
                onClose={() => {}}
              />
            )}
            {st.type === 'appointment_draft' && <AppointmentSchedulingDraft draft={st} />}
            <BrainAgendaConfirmPanels structured={st} />
            {st.type === 'appointment_created' && (
              <div className="mt-3 rounded-xl border border-[#727B8E1A] bg-gray-50 px-4 py-3 text-xs dark:border-[#40485A] dark:bg-[#141518]">
                <p className="font-medium text-[#434A57] dark:text-[#f5f9fc]">Agendamento criado</p>
                <p className="mt-1 text-[#727B8E] dark:text-[#8a94a6]">
                  ID: {st.appointment_id} · Data: {st.scheduled_date}
                </p>
              </div>
            )}
          </Fragment>
        ))}
        {msg.sqlExecuted && (
          <details className="mt-3 text-xs text-[#727B8E] dark:text-[#8a94a6]">
            <summary className="cursor-pointer select-none font-medium text-[#434A57] dark:text-[#f5f9fc]">
              SQL executada (somente leitura)
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-[#727B8E1A] bg-gray-50 p-3 font-mono text-[11px] leading-relaxed text-[#434A57] dark:border-[#40485A] dark:bg-[#141518] dark:text-[#d1d5db]">
              {msg.sqlExecuted}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}

export function BrainChat({ userName, assistantName = 'AuZap' }: Props) {
  const { messages, suggestions, loading, sendMessage, clear, dailyUsage } = useBrain()
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
              <h1 className="mb-1 text-2xl font-medium text-[#f5f9fc]">
                Bom te ver novamente, {firstName}!
              </h1>
              <p className="mb-10 text-sm text-[#8a94a6] text-center">
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
                {messages.map((msg) =>
                  msg.loading ? (
                    <TypingIndicator key={msg.id} />
                  ) : msg.role === 'user' ? (
                    <UserBubble key={msg.id} content={msg.content} />
                  ) : (
                    <AssistantBubble key={msg.id} msg={msg} />
                  ),
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
          {dailyUsage?.enabled && dailyUsage.limit > 0 && dailyUsage.used >= 0 && (
            <p className="mx-auto mt-2 w-full max-w-[770px] text-center text-[11px] leading-tight text-[#727B8E] dark:text-[#6b7280]">
              {Math.max(0, dailyUsage.limit - dailyUsage.used)} mensagens restantes hoje
            </p>
          )}
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
