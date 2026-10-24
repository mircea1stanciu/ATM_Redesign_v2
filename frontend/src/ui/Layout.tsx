import type { ReactNode } from 'react'
import { cn } from './cn'

export function PageHeader({ title, description, actions, children }: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  /** Tabs under the title. */
  children?: ReactNode
}) {
  return (
    <header className="shrink-0">
      <div className="flex flex-wrap items-end justify-between gap-3 pb-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold text-fg">{title}</h1>
          {description && <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border border-line bg-surface', className)}>{children}</div>
}

export function Section({ title, actions, children, className }: {
  title: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        {actions}
      </div>
      {children}
    </Card>
  )
}
