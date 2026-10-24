import { Link } from 'react-router-dom'
import { Menu, Moon, Search, Sun, Zap } from 'lucide-react'
import { useTheme } from '@/app/theme'
import { IconButton, Kbd } from '@/ui'
import NotificationBell from './NotificationBell'
import ProjectSwitcher from './ProjectSwitcher'
import UserMenu from './UserMenu'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export default function TopBar({ onOpenPalette, onOpenNavigation }: {
  onOpenPalette: () => void
  onOpenNavigation: () => void
}) {
  const resolved = useTheme(s => s.resolved)
  const toggleTheme = useTheme(s => s.toggle)

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <IconButton label="Open navigation" icon={<Menu size={18} />} onClick={onOpenNavigation} className="lg:hidden" />
      <Link to="/" className="flex items-center gap-2 pr-2" aria-label="ATM home">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-brand-fg">
          <Zap size={15} aria-hidden />
        </span>
        <span className="hidden text-[15px] font-bold text-fg sm:inline">ATM</span>
      </Link>
      <ProjectSwitcher />
      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Open command palette"
        className="mx-auto hidden h-8 w-full max-w-md items-center gap-2 rounded-lg border border-line bg-canvas px-3 text-[13px] text-fg-muted hover:border-fg-muted/40 md:flex"
      >
        <Search size={14} aria-hidden />
        <span className="flex-1 text-left">Search areas, projects, runs…</span>
        <Kbd>{IS_MAC ? '⌘' : 'Ctrl'}</Kbd><Kbd>K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-1 md:ml-0">
        <IconButton label="Open command palette" icon={<Search size={18} />} onClick={onOpenPalette} className="md:hidden" />
        <NotificationBell />
        <IconButton
          label="Toggle theme"
          icon={resolved === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          onClick={toggleTheme}
        />
        <UserMenu />
      </div>
    </header>
  )
}
