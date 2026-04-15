import { useState, useRef, useEffect } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const chatBubbleVariants = cva(
  'max-w-[70%] px-4 py-3 text-sm leading-relaxed',
  {
    variants: {
      variant: {
        sent: 'rounded-[23px_0px_23px_23px] bg-[#1E62EC] dark:bg-[#2172e5] text-white self-end',
        received: 'rounded-[0px_23px_23px_23px] bg-white dark:bg-[#1A1B1D] text-[#434A57] dark:text-[#f5f9fc] border border-transparent dark:border-[#40485A] self-start',
      },
    },
    defaultVariants: {
      variant: 'received',
    },
  }
)

export interface ChatBubbleProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof chatBubbleVariants> {
  message: string
  time: string
  isRead?: boolean
  isAudio?: boolean
  audioDuration?: string
  audioUrl?: string
  senderRole?: 'user' | 'assistant' | 'staff'
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="10"
      viewBox="0 0 16 10"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M1 5L4 8L9 1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 5L9 8L14 1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M4 3L13 8L4 13V3Z"
        fill="currentColor"
      />
    </svg>
  )
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="4" height="10" fill="currentColor" />
      <rect x="9" y="3" width="4" height="10" fill="currentColor" />
    </svg>
  )
}

function AudioPlayer({
  duration,
  isSent,
  audioUrl,
}: {
  duration: string
  isSent: boolean
  audioUrl?: string
}) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (audioUrl) {
      audioRef.current = new Audio(audioUrl)
      audioRef.current.onended = () => {
        setIsPlaying(false)
        setProgress(0)
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    }
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [audioUrl])

  const handlePlayPause = () => {
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
      if (intervalRef.current) clearInterval(intervalRef.current)
    } else {
      audioRef.current.play()
      setIsPlaying(true)

      intervalRef.current = setInterval(() => {
        if (audioRef.current) {
          const currentProgress =
            (audioRef.current.currentTime / audioRef.current.duration) * 100
          setProgress(currentProgress)
        }
      }, 100)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handlePlayPause}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
          isSent
            ? 'bg-white/20 text-white hover:bg-white/30'
            : 'bg-[#1E62EC]/10 text-[#1E62EC] hover:bg-[#1E62EC]/20'
        )}
      >
        {isPlaying ? (
          <PauseIcon className="h-4 w-4" />
        ) : (
          <PlayIcon className="h-4 w-4" />
        )}
      </button>

      <div className="flex flex-1 flex-col gap-1">
        <div
          className={cn(
            'h-1 w-32 overflow-hidden rounded-full',
            isSent ? 'bg-white/20' : 'bg-[#727B8E]/20'
          )}
        >
          <div
            className={cn(
              'h-full rounded-full transition-all',
              isSent ? 'bg-white' : 'bg-[#1E62EC]'
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span
          className={cn(
            'text-xs',
            isSent ? 'text-white/70' : 'text-[#727B8E]'
          )}
        >
          {duration}
        </span>
      </div>
    </div>
  )
}

export function ChatBubble({
  message,
  time,
  variant,
  isRead = false,
  isAudio = false,
  audioDuration,
  audioUrl,
  senderRole,
  className,
  ...props
}: ChatBubbleProps) {
  const isSent = variant === 'sent'

  return (
    <div
      className={cn(
        'flex flex-col gap-1',
        isSent ? 'items-end' : 'items-start'
      )}
    >
      {isSent && senderRole && (
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-semibold',
            senderRole === 'assistant'
              ? 'bg-[#1E62EC]/10 text-[#1E62EC] dark:bg-[#1E62EC]/20 dark:text-[#5b9aff]'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
          )}
        >
          {senderRole === 'assistant' ? 'IA' : 'Staff'}
        </span>
      )}
      <div className={cn(chatBubbleVariants({ variant, className }))} {...props}>
        {isAudio && audioDuration ? (
          <AudioPlayer duration={audioDuration} isSent={isSent} audioUrl={audioUrl} />
        ) : (
          message
        )}
      </div>
      <div
        className={cn(
          'flex items-center gap-1 text-[10px] text-[#727B8E] dark:text-[#8a94a6]',
          isSent ? 'flex-row-reverse' : 'flex-row'
        )}
      >
        <span>{time}</span>
        {isSent && (
          <CheckIcon
            className={cn(
              'h-2.5 w-4',
              isRead ? 'text-[#1E62EC] dark:text-[#2172e5]' : 'text-[#727B8E] dark:text-[#8a94a6]'
            )}
          />
        )}
      </div>
    </div>
  )
}
