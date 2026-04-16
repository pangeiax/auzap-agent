import { cn } from '@/lib/cn'
import { SentimentButton } from '@/components/molecules/SentimentButton'

export interface ChatHeaderProps {
  name: string
  phone?: string
  pets?: string
  isAiActive?: boolean
  onToggleAi?: () => void
  togglingAi?: boolean
  className?: string
  clientId?: string
  conversationId?: string
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function SparklesIcon({ className }: { className?: string }) {
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
        d="M8 1V3M8 13V15M1 8H3M13 8H15M3.05 3.05L4.46 4.46M11.54 11.54L12.95 12.95M12.95 3.05L11.54 4.46M4.46 11.54L3.05 12.95"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  )
}

export function ChatHeader({
  name,
  phone,
  pets,
  isAiActive = true,
  onToggleAi,
  togglingAi = false,
  className,
  clientId,
  conversationId,
}: ChatHeaderProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center justify-between gap-2 border-b border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] px-4 py-3 sm:px-6 sm:py-4',
        className
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1E62EC] dark:bg-[#2172e5]">
          <span className="text-sm font-medium text-white">
            {getInitials(name)}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 max-w-[min(100%,12rem)] truncate text-sm font-medium text-[#434A57] sm:max-w-none dark:text-[#f5f9fc]">
              {name}
            </span>
            {clientId && (
              <SentimentButton clientId={clientId} conversationId={conversationId} />
            )}
          </div>
          <span className="mt-0.5 block truncate text-xs text-[#727B8E] dark:text-[#8a94a6]">
            {[phone, pets].filter(Boolean).join(' • ')}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center">
        <button
          type="button"
          onClick={onToggleAi}
          disabled={togglingAi}
          aria-busy={togglingAi}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-medium transition-colors sm:px-3',
            isAiActive
              ? 'bg-[#1E62EC] dark:bg-[#2172e5] text-white'
              : 'bg-[#F4F6F9] dark:bg-[#212225] text-[#727B8E] dark:text-[#8a94a6]',
            togglingAi && 'cursor-not-allowed opacity-60'
          )}
          title={togglingAi ? 'Atualizando…' : isAiActive ? 'IA Ativa' : 'IA Inativa'}
        >
          {togglingAi ? (
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
          ) : (
            <SparklesIcon className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">
            {togglingAi ? 'Atualizando…' : `IA ${isAiActive ? 'Ativa' : 'Inativa'}`}
          </span>
        </button>
      </div>
    </div>
  )
}
