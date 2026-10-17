import { useState, useEffect, useCallback } from 'react'
import {
  HeadContent,
  Scripts,
  createRootRoute,
  useRouterState,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import Header from '../components/app/Header'
import CommandPalette from '../components/app/CommandPalette'
import { ViewModeProvider } from '../lib/view-mode'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      {
        title: 'SpendWise',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),

  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const isHome = useRouterState({
    select: (state) => state.location.pathname === '/',
  })
  const [searchOpen, setSearchOpen] = useState(false)
  const [showDevtools, setShowDevtools] = useState(false)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isHome && (e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen((prev) => !prev)
      }
    },
    [isHome],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)')
    const sync = () => setShowDevtools(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ViewModeProvider>
          {!isHome && <Header onOpenSearch={() => setSearchOpen(true)} />}
          {children}
          {!isHome && (
            <CommandPalette
              open={searchOpen}
              onClose={() => setSearchOpen(false)}
            />
          )}
          {showDevtools && !isHome && (
            <TanStackDevtools
              config={{
                position: 'bottom-right',
              }}
              plugins={[
                {
                  name: 'Tanstack Router',
                  render: <TanStackRouterDevtoolsPanel />,
                },
              ]}
            />
          )}
          <Scripts />
        </ViewModeProvider>
      </body>
    </html>
  )
}
