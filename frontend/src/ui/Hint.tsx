import { useState } from 'react'
import type { ReactNode } from 'react'
import { Lightbulb, X } from 'lucide-react'

const DISMISSED_KEY = 'atm_dismissed_hints'

function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]') as string[]
  } catch {
    return []
  }
}

/** A trainee hint. Dismissing it hides it for good on this browser. */
export function Hint({ id, children }: { id: string; children: ReactNode }) {
  const [hidden, setHidden] = useState(() => readDismissed().includes(id))
  if (hidden) return null
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...readDismissed(), id]))
    } catch {
      // Storage unavailable: hide for this session only.
    }
    setHidden(true)
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-[13px] text-fg">
      <Lightbulb size={14} className="mt-0.5 shrink-0 text-info" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      <button type="button" aria-label="Dismiss hint" onClick={dismiss} className="rounded p-0.5 text-fg-muted hover:text-fg">
        <X size={14} />
      </button>
    </div>
  )
}
