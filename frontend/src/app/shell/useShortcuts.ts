import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { AREAS, canOpen } from '@/app/navigation'

const SEQUENCE_TIMEOUT_MS = 1200

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    || Boolean(target.closest('.cm-editor'))
}

/**
 * ⌘K / Ctrl+K opens the palette; `g` then a letter jumps to an area; `/` focuses the list search of the current
 * screen; `?` shows the shortcut list.
 */
export function useShortcuts({ onTogglePalette, onShowShortcuts }: {
  onTogglePalette: () => void
  onShowShortcuts: () => void
}) {
  const navigate = useNavigate()
  const pendingG = useRef<number | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onTogglePalette()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
      if (document.querySelector('[role="dialog"]')) return

      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current)
        pendingG.current = null
        const user = useAppStore.getState().user
        const area = AREAS.find(a => a.shortcut === event.key.toLowerCase())
        if (area && canOpen(user, area.permissions)) {
          event.preventDefault()
          navigate(area.to)
        }
        return
      }
      if (event.key === 'g') {
        pendingG.current = window.setTimeout(() => { pendingG.current = null }, SEQUENCE_TIMEOUT_MS)
      } else if (event.key === '?') {
        event.preventDefault()
        onShowShortcuts()
      } else if (event.key === '/') {
        const search = document.querySelector<HTMLInputElement>('[data-list-search]')
        event.preventDefault()
        if (search) search.focus()
        else onTogglePalette()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (pendingG.current !== null) window.clearTimeout(pendingG.current)
    }
  }, [navigate, onTogglePalette, onShowShortcuts])
}
