import type { LucideIcon } from 'lucide-react'
import { NavLink, useSearchParams } from 'react-router-dom'
import { cn } from './cn'

export interface TabItem {
  /** A route path, or a value of the search parameter when `param` is set. */
  to: string
  label: string
  icon?: LucideIcon
  end?: boolean
}

const TAB = 'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors'
const ACTIVE = 'border-accent text-accent'
const IDLE = 'border-transparent text-fg-muted hover:text-fg'

/**
 * URL-driven tabs. Without `param` each tab is a route; with `param` the selected tab is a search parameter
 * (`?view=…`), so refresh and shared links keep the place.
 */
export function Tabs({ items, param, label }: { items: TabItem[]; param?: string; label: string }) {
  const [params, setParams] = useSearchParams()
  if (param) {
    const current = params.get(param) || items[0]?.to
    return (
      <div role="tablist" aria-label={label} className="flex items-center gap-1 overflow-x-auto border-b border-line">
        {items.map(({ to, label: text, icon: Icon }) => (
          <button
            key={to}
            role="tab"
            type="button"
            aria-selected={current === to}
            onClick={() => setParams(p => { p.set(param, to); return p }, { replace: true })}
            className={cn(TAB, current === to ? ACTIVE : IDLE)}
          >
            {Icon && <Icon size={14} />}
            {text}
          </button>
        ))}
      </div>
    )
  }
  return (
    <nav aria-label={label} className="flex items-center gap-1 overflow-x-auto border-b border-line">
      {items.map(({ to, label: text, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => cn(TAB, isActive ? ACTIVE : IDLE)}>
          {Icon && <Icon size={14} />}
          {text}
        </NavLink>
      ))}
    </nav>
  )
}

/** The selected value of a search-parameter tab set. */
export function useTabParam<T extends string>(param: string, values: readonly T[]): T {
  const [params] = useSearchParams()
  const value = params.get(param) as T | null
  return value && values.includes(value) ? value : values[0]
}
