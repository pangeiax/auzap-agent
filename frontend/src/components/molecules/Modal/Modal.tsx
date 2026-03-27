import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/atoms/Button'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  onSubmit?: () => void
  submitText?: string
  cancelText?: string
  isLoading?: boolean
  className?: string
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  onSubmit,
  submitText = 'Cadastrar',
  cancelText = 'Cancelar',
  isLoading = false,
  className,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) onClose()
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose, isLoading])

  if (!isOpen) return null

  const overlay = (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end justify-center px-0 pb-0 pt-[max(0.5rem,env(safe-area-inset-top,0px))] backdrop-blur-sm sm:items-center sm:p-4 sm:pb-4 sm:pt-4 animate-backdrop"
      onClick={(e) => {
        if (isLoading) return
        if (e.target === overlayRef.current) onClose()
      }}
    >
      <div
        className={cn(
          'flex w-full max-h-[min(calc(100dvh-env(safe-area-inset-bottom,0px)-0.75rem),100vh)] flex-col rounded-t-2xl bg-white shadow-xl dark:bg-[#1A1B1D] sm:max-h-[min(90vh,calc(100dvh-2rem))] sm:rounded-2xl animate-scale-in',
          className
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#727B8E]/10 dark:border-[#40485A] px-4 py-3 sm:px-6 sm:py-4">
          <h2 className="pr-2 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#727B8E] transition-colors hover:bg-[#F4F6F9] hover:text-[#434A57] enabled:cursor-pointer disabled:pointer-events-none disabled:opacity-40 dark:text-[#8a94a6] dark:hover:bg-[#212225] dark:hover:text-[#f5f9fc]"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3 sm:px-6 sm:py-4">
          {children}
        </div>

        {onSubmit && (
          <div className="flex shrink-0 gap-3 border-t border-[#727B8E]/10 dark:border-[#40485A] px-4 py-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:px-6 sm:py-4 sm:pb-4">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1"
              disabled={isLoading}
            >
              {cancelText}
            </Button>
            <Button
              onClick={onSubmit}
              className="flex-1"
              loading={isLoading}
            >
              {submitText}
            </Button>
          </div>
        )}
      </div>
    </div>
  )

  if (typeof document !== 'undefined') {
    return createPortal(overlay, document.body)
  }
  return overlay
}
