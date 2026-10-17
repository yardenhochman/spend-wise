import { createContext, useContext, useState } from 'react'
import type { ViewExclusion, ViewMode } from './types'

const ViewModeContext = createContext<{
  mode: ViewMode
  setMode: (m: ViewMode) => void
  excludedKinds: ViewExclusion[]
  setExcludedKinds: (kinds: ViewExclusion[]) => void
  toggleExcludedKind: (kind: ViewExclusion) => void
}>({
  mode: 'cashflow',
  setMode: () => {},
  excludedKinds: [],
  setExcludedKinds: () => {},
  toggleExcludedKind: () => {},
})

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ViewMode>('cashflow')
  const [excludedKinds, setExcludedKinds] = useState<ViewExclusion[]>([])
  const toggleExcludedKind = (kind: ViewExclusion) => {
    setExcludedKinds((current) =>
      current.includes(kind)
        ? current.filter((item) => item !== kind)
        : [...current, kind],
    )
  }

  return (
    <ViewModeContext.Provider
      value={{
        mode,
        setMode,
        excludedKinds,
        setExcludedKinds,
        toggleExcludedKind,
      }}
    >
      {children}
    </ViewModeContext.Provider>
  )
}

export function useViewMode() {
  return useContext(ViewModeContext)
}
