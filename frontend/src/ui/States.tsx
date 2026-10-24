import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle } from 'lucide-react'
import { cn } from './cn'

/** Explains what the area is for and offers the next step. */
export function EmptyState({ icon: Icon, title, children, action }: {
  icon?: LucideIcon
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {Icon && <Icon size={28} className="text-fg-muted" />}
      <p className="text-[15px] font-semibold text-fg">{title}</p>
      {children && <div className="max-w-md text-[13px] text-fg-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-lg bg-surface-2', className)} />
}

/** An error where it happened, in plain words, with a way to fix it. */
export function ErrorState({ title = 'Something went wrong', children, action }: {
  title?: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-fg">{title}</p>
        {children && <div className="mt-0.5 text-[13px] text-fg-muted">{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  )
}
