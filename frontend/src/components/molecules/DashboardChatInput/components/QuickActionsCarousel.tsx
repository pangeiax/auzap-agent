import { memo, useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, RotateCw } from 'lucide-react'
import { QUICK_ACTIONS_PAIRS, QUICK_ACTIONS_ROTATION_INTERVAL, REFRESH_ANIMATION_DURATION } from '../constants'

export interface QuickActionsCarouselProps {
  onQuickAction: (action: string) => void
  disabled?: boolean
  extraPairs?: [string, string][]
}

export const QuickActionsCarousel = memo(function QuickActionsCarousel({
  onQuickAction,
  disabled,
  extraPairs,
}: QuickActionsCarouselProps) {
  const pairs = extraPairs && extraPairs.length > 0
    ? [...extraPairs, ...QUICK_ACTIONS_PAIRS]
    : QUICK_ACTIONS_PAIRS

  const [currentIndex, setCurrentIndex] = useState(0)
  const [isRotating, setIsRotating] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % pairs.length)
  }, [pairs.length])

  useEffect(() => {
    intervalRef.current = setInterval(goToNext, QUICK_ACTIONS_ROTATION_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [goToNext])

  const handleRefresh = () => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setIsRotating(true)
    goToNext()
    setTimeout(() => setIsRotating(false), REFRESH_ANIMATION_DURATION)
    intervalRef.current = setInterval(goToNext, QUICK_ACTIONS_ROTATION_INTERVAL)
  }

  const [longQuestion, shortQuestion] = pairs[currentIndex] ?? pairs[0]!

  return (
    <div className="flex w-full items-center justify-center gap-2">
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          className="flex items-center gap-2"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          <motion.button
            type="button"
            onClick={() => onQuickAction(longQuestion)}
            disabled={disabled}
            aria-label={`Ação rápida: ${longQuestion}`}
            className="flex items-center gap-1.5 rounded-full border border-[#727B8E1A] bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] px-3 py-1.5 text-xs sm:text-sm text-[#727B8E] dark:text-[#8a94a6] backdrop-blur-md transition-colors hover:bg-gray-50 dark:hover:bg-[#212225] hover:text-[#434A57] dark:hover:text-[#f5f9fc] hover:border-[#727B8E]/30 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            whileHover={{ scale: 1.02, y: -1 }}
            whileTap={{ scale: 0.98 }}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#8A96A8]" />
            {longQuestion}
          </motion.button>
          <motion.button
            type="button"
            onClick={() => onQuickAction(shortQuestion)}
            disabled={disabled}
            aria-label={`Ação rápida: ${shortQuestion}`}
            className="flex items-center gap-1.5 rounded-full border border-[#727B8E1A] bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] px-3 py-1.5 text-xs sm:text-sm text-[#727B8E] dark:text-[#8a94a6] backdrop-blur-md transition-colors hover:bg-gray-50 dark:hover:bg-[#212225] hover:text-[#434A57] dark:hover:text-[#f5f9fc] hover:border-[#727B8E]/30 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            whileHover={{ scale: 1.02, y: -1 }}
            whileTap={{ scale: 0.98 }}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#8A96A8]" />
            {shortQuestion}
          </motion.button>
        </motion.div>
      </AnimatePresence>
      <motion.button
        type="button"
        onClick={handleRefresh}
        disabled={disabled}
        aria-label="Próximas sugestões"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#727B8E1A] bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] text-[#727B8E] dark:text-[#8a94a6] transition-colors hover:bg-gray-50 dark:hover:bg-[#212225] hover:text-[#434A57] dark:hover:text-[#f5f9fc] disabled:opacity-50 disabled:cursor-not-allowed"
        animate={{ rotate: isRotating ? 360 : 0 }}
        transition={{ duration: 0.3 }}
        title="Próximas sugestões"
      >
        <RotateCw className="h-4 w-4" />
      </motion.button>
    </div>
  )
})
