import { cn } from '@/lib/cn'
import { StatusIndicator } from '@/components/atoms/StatusIndicator'

export interface ConversationItemProps {
  name: string
  pets?: string
  lastMessage: string
  time: string
  date?: string
  unreadCount?: number
  isOnline?: boolean
  isSelected?: boolean
  isAiPaused?: boolean
  onClick?: () => void
  className?: string
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function ConversationItem({
  name,
  pets,
  lastMessage,
  time,
  date,
  unreadCount = 0,
  isOnline = false,
  isSelected = false,
  isAiPaused,
  onClick,
  className,
}: ConversationItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-3 transition-colors',
        'hover:bg-[#F4F6F9] dark:hover:bg-[#212225]',
        isSelected && 'bg-[#F4F6F9] dark:bg-[#212225]',
        className
      )}
    >
      <div className="relative shrink-0">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1E62EC] dark:bg-[#2172e5]">
          <span className="text-sm font-medium text-white">
            {getInitials(name)}
          </span>
        </div>
        <div className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white">
          <StatusIndicator status={isOnline ? 'online' : 'offline'} size="sm" />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
              {name}
            </span>
            {isAiPaused !== undefined && (
              <span
                className={cn(
                  'flex-shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold',
                  isAiPaused
                    ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'
                    : 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                )}
              >
                IA
              </span>
            )}
          </div>
          <span className="flex-shrink-0 text-xs text-[#727B8E] dark:text-[#8a94a6] text-right whitespace-pre-line">{time}</span>
        </div>

        {pets && (
          <span className="text-xs text-[#727B8E] dark:text-[#8a94a6]">{pets}</span>
        )}

        <div className="flex w-full items-center justify-between gap-2">
          <p className="truncate text-xs text-[#727B8E] dark:text-[#8a94a6]">{lastMessage}</p>
          {unreadCount > 0 && (
            <span className="flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#0F172A] dark:bg-[#2172e5] px-1.5 text-[10px] font-medium text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
