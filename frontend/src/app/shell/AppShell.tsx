import { useCallback, useState } from 'react'
import { Outlet } from 'react-router-dom'
import * as RadixDialog from '@radix-ui/react-dialog'
import AppCommandPalette from './AppCommandPalette'
import ShortcutsDialog from './ShortcutsDialog'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { useShortcuts } from './useShortcuts'

const COLLAPSED_KEY = 'atm_sidebar_collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/** Top bar, side bar and the page (docs/redesign/05-design.md, section 5.3). */
export default function AppShell() {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const toggleCollapsed = () => {
    setCollapsed(value => {
      try {
        localStorage.setItem(COLLAPSED_KEY, value ? '0' : '1')
      } catch {
        // Storage unavailable: the state lasts for this page only.
      }
      return !value
    })
  }
  const togglePalette = useCallback(() => setPaletteOpen(open => !open), [])
  const showShortcuts = useCallback(() => setShortcutsOpen(true), [])
  useShortcuts({ onTogglePalette: togglePalette, onShowShortcuts: showShortcuts })

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[90] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <TopBar onOpenPalette={() => setPaletteOpen(true)} onOpenNavigation={() => setMobileNavOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <div className="hidden lg:block">
          <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
        </div>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-auto p-4 outline-none md:p-6">
          <Outlet />
        </main>
      </div>

      <RadixDialog.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/40 lg:hidden" />
          <RadixDialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 shadow-float lg:hidden">
            <RadixDialog.Title className="sr-only">Navigation</RadixDialog.Title>
            <Sidebar collapsed={false} mobile onNavigate={() => setMobileNavOpen(false)} />
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      <AppCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onShowShortcuts={showShortcuts} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  )
}
