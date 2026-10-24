import { Fragment, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { cn } from './cn'

export interface Pane {
  id: string
  /** Read by screen readers on the separator next to the pane. */
  label: string
  content: ReactNode
  /** Width in px for a fixed pane; omit for the one pane that takes the remaining space. */
  initial?: number
  min?: number
  collapsed?: boolean
}

const KEY_STEP = 24
const MIN_FLEX = 240

function readSizes(key: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') as Record<string, number>
  } catch {
    return {}
  }
}

/**
 * Side-by-side panes with draggable (and keyboard-movable) separators. Fixed panes keep their width in px and remember
 * it; the pane without `initial` takes the rest. Collapsed panes are hidden. Below the `lg` breakpoint the panes stack.
 */
export function SplitPane({ panes, storageKey, className }: { panes: Pane[]; storageKey: string; className?: string }) {
  const [sizes, setSizes] = useState<Record<string, number>>(() => readSizes(storageKey))
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(sizes))
    } catch {
      // Storage unavailable: sizes last for this page.
    }
  }, [sizes, storageKey])

  const visible = panes.filter(pane => !pane.collapsed)
  const width = (pane: Pane) => sizes[pane.id] ?? pane.initial ?? 0

  const resize = (pane: Pane, next: number) => {
    const total = box.current?.getBoundingClientRect().width ?? 0
    const others = visible.filter(p => p.id !== pane.id && p.initial !== undefined).reduce((sum, p) => sum + width(p), 0)
    const max = total ? total - others - MIN_FLEX : next
    setSizes(current => ({ ...current, [pane.id]: Math.round(Math.max(pane.min ?? 120, Math.min(max, next))) }))
  }

  // The separator between two panes resizes whichever of them has a fixed width.
  const fixedNeighbour = (index: number): { pane: Pane; side: 'left' | 'right' } | null => {
    const left = visible[index]
    const right = visible[index + 1]
    if (left.initial !== undefined) return { pane: left, side: 'left' }
    if (right?.initial !== undefined) return { pane: right, side: 'right' }
    return null
  }

  const drag = (index: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = fixedNeighbour(index)
    const rect = box.current?.getBoundingClientRect()
    if (!target || !rect) return
    event.preventDefault()
    const start = event.clientX
    const startWidth = width(target.pane)
    const move = (e: PointerEvent) => {
      const delta = e.clientX - start
      resize(target.pane, target.side === 'left' ? startWidth + delta : startWidth - delta)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const keyResize = (index: number) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = fixedNeighbour(index)
    if (!target || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    event.preventDefault()
    const grow = (event.key === 'ArrowRight') === (target.side === 'left')
    resize(target.pane, width(target.pane) + (grow ? KEY_STEP : -KEY_STEP))
  }

  return (
    <div ref={box} className={cn('flex h-full min-h-0 flex-col gap-3 lg:flex-row lg:gap-0', className)}>
      {visible.map((pane, index) => {
        const target = index < visible.length - 1 ? fixedNeighbour(index) : null
        return (
          <Fragment key={pane.id}>
            <div
              data-pane={pane.id}
              className={cn('min-h-[16rem] min-w-0 lg:min-h-0', pane.initial === undefined ? 'flex-1' : 'shrink-0')}
              style={pane.initial === undefined ? undefined : { flexBasis: width(pane) }}
            >
              {pane.content}
            </div>
            {target && (
              <div
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label={`Resize ${target.pane.label}`}
                aria-valuenow={width(target.pane)}
                onPointerDown={drag(index)}
                onKeyDown={keyResize(index)}
                className="group hidden w-2 shrink-0 cursor-col-resize items-center justify-center outline-none lg:flex"
              >
                <div className="h-10 w-0.5 rounded bg-line group-hover:bg-accent group-focus-visible:bg-accent" />
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}
