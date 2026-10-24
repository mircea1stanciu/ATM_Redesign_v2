import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from './cn'

type Tone = 'success' | 'danger' | 'warning' | 'info'

interface ToastInput {
  title: string
  description?: string
  tone?: Tone
  action?: { label: string; onClick: () => void }
}

interface ToastItem extends ToastInput {
  id: number
}

const ToastContext = createContext<(toast: ToastInput) => void>(() => {})

const ICONS = { success: CheckCircle2, danger: XCircle, warning: AlertTriangle, info: Info }
const COLORS = { success: 'text-success', danger: 'text-danger', warning: 'text-warning', info: 'text-info' }
const DURATION_MS = 5000

/** One provider for the whole app; toasts stack at the bottom right and close after a few seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts(list => list.filter(t => t.id !== id)), [])
  const show = useCallback((toast: ToastInput) => {
    const id = nextId.current++
    setToasts(list => [...list.slice(-3), { ...toast, id }])
    window.setTimeout(() => dismiss(id), DURATION_MS)
  }, [dismiss])

  const value = useMemo(() => show, [show])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-80 flex-col gap-2">
        {toasts.map(toast => {
          const tone = toast.tone ?? 'info'
          const Icon = ICONS[tone]
          return (
            <div key={toast.id} role="status"
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface p-3 shadow-float animate-slide-up">
              <Icon size={16} className={cn('mt-0.5 shrink-0', COLORS[tone])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-fg">{toast.title}</p>
                {toast.description && <p className="mt-0.5 text-xs text-fg-muted">{toast.description}</p>}
                {toast.action && (
                  <button type="button" onClick={() => { toast.action?.onClick(); dismiss(toast.id) }}
                    className="mt-1 text-xs font-semibold text-accent hover:underline">
                    {toast.action.label}
                  </button>
                )}
              </div>
              <button type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)}
                className="rounded p-0.5 text-fg-muted hover:text-fg">
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
