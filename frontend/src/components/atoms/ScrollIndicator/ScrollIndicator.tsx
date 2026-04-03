import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

interface ScrollIndicatorProps {
  text?: string
  className?: string
}

export function ScrollIndicator({ text = 'Ver Estatísticas', className }: ScrollIndicatorProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5, duration: 0.6 }}
      className={cn('flex flex-col items-center gap-3 pointer-events-none', className)}
    >
      <span className="text-sm font-medium text-white/80 dark:text-white/70">
        {text}
      </span>

      <motion.div
        animate={{ y: [0, 8, 0] }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      >
        <ChevronDown className="h-8 w-8 text-white/80 dark:text-white/70" strokeWidth={2} />
      </motion.div>
    </motion.div>
  )
}
