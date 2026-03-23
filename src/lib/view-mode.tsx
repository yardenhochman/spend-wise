import { createContext, useContext, useState } from 'react'
import type { ViewMode } from './types'

const ViewModeContext = createContext<{
  mode: ViewMode
  setMode: (m: ViewMode) => void
}>({ mode: 'routine', setMode: () => {} })

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ViewMode>('routine')
  return (
    <ViewModeContext.Provider value={{ mode, setMode }}>
      {children}
    </ViewModeContext.Provider>
  )
}

export function useViewMode() {
  return useContext(ViewModeContext)
}
