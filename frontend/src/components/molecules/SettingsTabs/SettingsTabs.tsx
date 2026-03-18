import { cn } from '@/lib/cn'

export type SettingsTabId =
  | 'servicos'
  | 'empresa'
  | 'whatsapp'
  | 'pagamento'
  | 'ia-playground'
  | 'horarios'
  | 'hospedagem'

const TABS: { id: SettingsTabId; label: string, disabled?: boolean}[] = [
  { id: 'servicos', label: 'Serviços' },
  { id: 'empresa', label: 'Empresa' },
  { id: 'horarios', label: 'Horários' },
  { id: 'hospedagem', label: 'Hospedagem' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'pagamento', label: 'Pagamento', disabled: true },
  { id: 'ia-playground', label: 'IA Playground', disabled: true },
]

interface SettingsTabsProps {
  activeTab: SettingsTabId
  onTabChange: (tabId: SettingsTabId) => void
  className?: string
}

export function SettingsTabs({
  activeTab,
  onTabChange,
  className,
}: SettingsTabsProps) {
  return (
    <div
      className={cn(
        'flex flex-row items-center p-0',
        'h-[41px] w-max min-w-0 max-w-full sm:max-w-[513px]',
        className
      )}
    >
      {TABS.map((tab, index) => {
        const isActive = activeTab === tab.id
        const isFirst = index === 0
        const isLast = index === TABS.length - 1
        return (
          <button
            key={tab.id}
            type="button"
            disabled={tab.disabled}
            onClick={(e) => {
              if (tab.id === 'ia-playground') {
                e.preventDefault()
                ;(e.currentTarget as HTMLButtonElement).blur()
              }
              onTabChange(tab.id)
            }}
            className={cn(
              'box-border flex shrink-0 flex-row items-center justify-center gap-2.5 px-4 py-3 transition-all duration-200 ease-out',
              'h-[41px] text-sm font-normal leading-[17px] text-[#727B8E] dark:text-[#8a94a6]',
              isActive ? 'bg-[#EEF2F4] dark:bg-[#212225]' : 'bg-white dark:bg-[#1A1B1D]',
              'border border-[rgba(114,123,142,0.1)] dark:border-[#40485A]',
              tab.disabled && 'cursor-not-allowed!',
              !isFirst && 'border-l-0',
              isFirst && 'rounded-tl-lg',
              isLast && 'rounded-tr-lg'
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
