import { NavLink } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { AREAS, SECONDARY_AREAS, visibleAreas } from '@/app/navigation'
import type { Area } from '@/app/navigation'
import { Tooltip, cn } from '@/ui'

function AreaLink({ area, collapsed, badge, onNavigate }: {
  area: Area
  collapsed: boolean
  badge?: string
  onNavigate?: () => void
}) {
  const Icon = area.icon
  const link = (
    <NavLink
      to={area.to}
      end={area.to === '/'}
      onClick={onNavigate}
      aria-label={collapsed ? area.label : undefined}
      className={({ isActive }) => cn(
        'relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13px] font-medium transition-colors',
        isActive ? 'bg-accent/10 text-accent' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
        collapsed && 'justify-center px-0',
      )}
    >
      <Icon size={18} className="shrink-0" aria-hidden />
      {!collapsed && <span className="flex-1 truncate">{area.label}</span>}
      {badge && (
        <span className={cn('h-2 w-2 rounded-full bg-info', collapsed && 'absolute right-1.5 top-1.5')}>
          <span className="sr-only">{badge}</span>
        </span>
      )}
    </NavLink>
  )
  return collapsed ? <Tooltip content={area.label} side="right">{link}</Tooltip> : link
}

/** The side bar: the areas the role can use. Collapses to icons; the state is remembered. */
export default function Sidebar({ collapsed, onToggle, onNavigate, mobile = false }: {
  collapsed: boolean
  onToggle?: () => void
  onNavigate?: () => void
  mobile?: boolean
}) {
  const user = useAppStore(s => s.user)
  const hasRunning = useAppStore(s => s.runs.some(run => run.status === 'running'))
  const badges: Record<string, string | undefined> = { tests: hasRunning ? 'A run is in progress' : undefined }

  return (
    <div className={cn('flex h-full flex-col bg-surface', !mobile && 'border-r border-line', collapsed ? 'w-16' : 'w-56')}>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {visibleAreas(user, AREAS).map(area => (
          <AreaLink key={area.id} area={area} collapsed={collapsed} badge={badges[area.id]} onNavigate={onNavigate} />
        ))}
        <div className="my-2 h-px bg-line" />
        {visibleAreas(user, SECONDARY_AREAS).map(area => (
          <AreaLink key={area.id} area={area} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </nav>
      {onToggle && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex h-10 items-center gap-2 border-t border-line px-4 text-xs text-fg-muted hover:text-fg',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? <ChevronsRight size={16} aria-hidden /> : <><ChevronsLeft size={16} aria-hidden /> Collapse</>}
        </button>
      )}
    </div>
  )
}
