import { useContext } from 'react'
import { SettingsContext } from '@/contexts/SettingsContext'

export function useSettings() {
  const context = useContext(SettingsContext)

  if (!context) {
    throw new Error('useSettings deve ser usado dentro de SettingsProvider')
  }

  return context
}
