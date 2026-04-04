import { useState, KeyboardEvent, useCallback, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Paperclip, Globe, Smile, Headphones, Mic } from 'lucide-react'
import { useFileUpload, type UploadedFile } from '@/hooks/useFileUpload'
import { useTypewriterPlaceholder } from '@/hooks/useTypewriterPlaceholder'
import { ActionDivider, FilePreview, QuickActionsCarousel } from './components'
import {
  EMOJI_LIST,
  QUICK_ACTIONS_PAIRS,
  DEFAULT_PLACEHOLDER,
  TYPEWRITER_SPEED,
  PLACEHOLDER_ROTATION_DELAY,
  MAX_FILES,
} from './constants'

export interface DashboardChatInputProps {
  onSend?: (message: string, files?: UploadedFile[]) => void
  onQuickAction?: (action: string) => void
  showQuickActions?: boolean
  disabled?: boolean
  quickActionsPairs?: [string, string][]
}

export function DashboardChatInput({
  onSend,
  onQuickAction,
  showQuickActions = true,
  disabled = false,
  quickActionsPairs,
}: DashboardChatInputProps) {
  const [message, setMessage] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [showSupport, setShowSupport] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)

  const { files, addFiles, removeFile, clearFiles, openFilePicker, inputRef, getAcceptedTypesString } = useFileUpload({
    maxFiles: MAX_FILES,
    onError: () => {},
  })

  const allPlaceholders = useMemo(
    () => [DEFAULT_PLACEHOLDER, ...QUICK_ACTIONS_PAIRS.flatMap((pair) => pair)],
    []
  )

  const { displayedPlaceholder, isTyping } = useTypewriterPlaceholder({
    placeholders: allPlaceholders,
    disabled: disabled || showSearch || showSupport,
    isFocused,
    typingSpeed: TYPEWRITER_SPEED,
    rotationDelay: PLACEHOLDER_ROTATION_DELAY,
  })

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files)
        e.target.value = ''
      }
    },
    [addFiles]
  )

  const handleToggleSearch = useCallback(() => {
    setShowSearch((prev) => !prev)
    setShowSupport(false)
  }, [])

  const handleToggleSupport = useCallback(() => {
    setShowSupport((prev) => !prev)
    setShowSearch(false)
  }, [])

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      const ta = textareaRef.current
      if (ta) {
        const start = ta.selectionStart
        const end = ta.selectionEnd
        const newValue = message.slice(0, start) + emoji + message.slice(end)
        setMessage(newValue)
        setTimeout(() => ta.focus(), 0)
      } else {
        setMessage((m) => m + emoji)
      }
      setShowEmojiPicker(false)
    },
    [message]
  )

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false)
      }
    }
    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showEmojiPicker])

  const getPlaceholder = () => {
    if (disabled) return 'Aguardando resposta...'
    if (showSearch) return 'Pesquisar na web...'
    if (showSupport) return 'Como posso ajudar?'

    return displayedPlaceholder + (isTyping && !isFocused ? '|' : '')
  }

  const handleSubmit = useCallback(() => {
    if (disabled) return
    const hasMessage = message.trim()
    const hasFiles = files.length > 0

    if ((hasMessage || hasFiles) && onSend) {
      let finalMessage = message.trim()
      if (showSearch) finalMessage = `[Search: ${finalMessage}]`
      else if (showSupport) finalMessage = `[Suporte: ${finalMessage}]`
      onSend(finalMessage, hasFiles ? files : undefined)
      setMessage('')
      clearFiles()
      setShowSearch(false)
      setShowSupport(false)
    }
  }, [disabled, message, files, onSend, showSearch, showSupport, clearFiles])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleQuickAction = useCallback(
    (action: string) => {
      if (disabled) return
      if (onQuickAction) {
        onQuickAction(action)
      } else if (onSend) {
        onSend(action)
      }
    },
    [disabled, onQuickAction, onSend]
  )

  return (
    <div className="mx-auto flex w-full max-w-[770px] flex-col items-center gap-4 px-2 sm:px-0">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={getAcceptedTypesString()}
        onChange={handleFileChange}
        className="hidden"
        aria-label="Upload de arquivos"
      />

      <div className="w-full rounded-2xl border border-[#727B8E1A] bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-4 backdrop-blur-md">
        <AnimatePresence>
          {files.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-3 flex flex-wrap gap-3"
            >
              {files.map((file) => (
                <FilePreview key={file.id} file={file} onRemove={() => removeFile(file.id)} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={disabled}
          placeholder={getPlaceholder()}
          aria-label="Campo de mensagem do chat"
          className="max-h-[120px] w-full resize-none border-none bg-transparent text-base text-[#434A57] dark:text-[#f5f9fc] outline-none placeholder:text-[#727B8E] dark:placeholder:text-[#8a94a6] disabled:cursor-not-allowed disabled:opacity-50 py-1"
          rows={1}
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-0">
            <button
              type="button"
              onClick={openFilePicker}
              disabled={disabled}
              aria-label="Anexar arquivo"
              title="Anexar arquivo"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#8A96A8] transition-colors hover:bg-[#F4F6F9] hover:text-[#727B8E] dark:hover:bg-[#212225] dark:hover:text-[#8a94a6] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <Paperclip className="h-5 w-5" />
            </button>
            <ActionDivider />
            <button
              type="button"
              onClick={handleToggleSearch}
              disabled={disabled}
              aria-label="Pesquisar na web"
              title="Pesquisar na web"
              className={`flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-full border px-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                showSearch
                  ? 'border-[#1E62EC] bg-[#1E62EC]/10 text-[#1E62EC] dark:bg-[#2172e5]/15 dark:border-[#2172e5] dark:text-[#2172e5]'
                  : 'border-transparent text-[#8A96A8] hover:bg-[#F4F6F9] hover:text-[#727B8E] dark:hover:bg-[#212225] dark:hover:text-[#8a94a6]'
              }`}
            >
              <Globe className="h-5 w-5 shrink-0" />
              <AnimatePresence>
                {showSearch && (
                  <motion.span
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 'auto', opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden whitespace-nowrap text-xs"
                  >
                    Search
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
            <ActionDivider />
            <div className="relative" ref={emojiPickerRef}>
              <button
                type="button"
                onClick={() => setShowEmojiPicker((p) => !p)}
                disabled={disabled}
                aria-label="Inserir emoji"
                title="Inserir emoji"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#8A96A8] transition-colors hover:bg-[#F4F6F9] hover:text-[#727B8E] dark:hover:bg-[#212225] dark:hover:text-[#8a94a6] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <Smile className="h-5 w-5" />
              </button>
              <AnimatePresence>
                {showEmojiPicker && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    role="dialog"
                    aria-label="Seletor de emojis"
                    className="absolute bottom-full left-0 mb-1 flex flex-wrap gap-1 rounded-xl border border-[#727B8E1A] bg-white p-2 shadow-lg dark:border-[#40485A] dark:bg-[#1A1B1D]"
                  >
                    {EMOJI_LIST.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => handleEmojiSelect(emoji)}
                        aria-label={`Selecionar emoji ${emoji}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-colors hover:bg-[#F4F6F9] dark:hover:bg-[#212225]"
                      >
                        {emoji}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <ActionDivider />
            <button
              type="button"
              onClick={handleToggleSupport}
              disabled={disabled}
              aria-label="Suporte"
              title="Suporte"
              className={`flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-full border px-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                showSupport
                  ? 'border-[#10B981] bg-[#10B981]/10 text-[#10B981] dark:bg-[#10B981]/15 dark:border-[#10B981] dark:text-[#10B981]'
                  : 'border-transparent text-[#8A96A8] hover:bg-[#F4F6F9] hover:text-[#727B8E] dark:hover:bg-[#212225] dark:hover:text-[#8a94a6]'
              }`}
            >
              <Headphones className="h-5 w-5 shrink-0" />
              <AnimatePresence>
                {showSupport && (
                  <motion.span
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 'auto', opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden whitespace-nowrap text-xs"
                  >
                    Suporte
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={disabled}
            aria-label="Enviar mensagem"
            title="Enviar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#8A96A8] transition-colors hover:bg-[#1E62EC] hover:text-white dark:hover:bg-[#2172e5] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Mic className="h-5 w-5" />
          </button>
        </div>
      </div>

      {showQuickActions && (
        <motion.div
          className="w-full py-1"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <QuickActionsCarousel onQuickAction={handleQuickAction} disabled={disabled} extraPairs={quickActionsPairs} />
        </motion.div>
      )}
    </div>
  )
}
