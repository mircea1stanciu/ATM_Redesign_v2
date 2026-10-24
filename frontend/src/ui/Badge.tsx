import type { ReactNode } from 'react'
import { Ban, CheckCircle2, CircleDashed, Clock, Loader2, MinusCircle, XCircle } from 'lucide-react'
import { cn } from './cn'

type Tone = 'neutral' | 'accent' | 'brand' | 'success' | 'danger' | 'warning' | 'info'

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-muted',
  accent: 'bg-accent/10 text-accent',
  brand: 'bg-brand/15 text-fg',
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-info/10 text-info',
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', TONES[tone], className)}>
      {children}
    </span>
  )
}

const STATUS: Record<string, { tone: Tone; icon: typeof CheckCircle2; label: string }> = {
  passed: { tone: 'success', icon: CheckCircle2, label: 'Passed' },
  success: { tone: 'success', icon: CheckCircle2, label: 'Passed' },
  failed: { tone: 'danger', icon: XCircle, label: 'Failed' },
  failure: { tone: 'danger', icon: XCircle, label: 'Failed' },
  error: { tone: 'danger', icon: XCircle, label: 'Error' },
  running: { tone: 'info', icon: Loader2, label: 'Running' },
  pending: { tone: 'neutral', icon: Clock, label: 'Pending' },
  queued: { tone: 'neutral', icon: Clock, label: 'Queued' },
  skipped: { tone: 'neutral', icon: MinusCircle, label: 'Skipped' },
  cancelled: { tone: 'warning', icon: Ban, label: 'Cancelled' },
}

/** A run or check status: always colour together with an icon and a word. */
export function StatusPill({ status }: { status: string }) {
  const known = STATUS[status.toLowerCase()] ?? { tone: 'neutral' as Tone, icon: CircleDashed, label: status }
  const Icon = known.icon
  return (
    <Badge tone={known.tone}>
      <Icon size={12} className={status === 'running' ? 'animate-spin' : undefined} aria-hidden />
      {known.label}
    </Badge>
  )
}

const TEST_TYPES: Record<string, Tone> = {
  functional: 'accent',
  regression: 'warning',
  smoke: 'brand',
  api: 'info',
  ui: 'success',
  mobile: 'accent',
  performance: 'danger',
}

export function TestTypeChip({ type }: { type: string }) {
  return <Badge tone={TEST_TYPES[type.toLowerCase()] ?? 'neutral'}>{type}</Badge>
}
