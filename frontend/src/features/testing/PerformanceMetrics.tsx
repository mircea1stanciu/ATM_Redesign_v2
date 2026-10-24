import type { RunPerformance } from '@/types/domain'

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-[18px] font-semibold text-fg">{value}</dd>
    </div>
  )
}

const ms = (value: number | null) => (value === null ? '—' : `${Math.round(value)} ms`)

/** Response times, throughput and errors of a performance (k6) run. */
export default function PerformanceMetrics({ performance }: { performance: RunPerformance }) {
  const errors = performance.error_rate === null ? '—' : `${(performance.error_rate * 100).toFixed(2)} %`
  return (
    <section aria-label="Performance" className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Performance</h3>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="p95 response time" value={ms(performance.p95_ms)} />
        <Metric label="Average" value={ms(performance.avg_ms)} />
        <Metric label="Throughput" value={performance.requests_per_second === null ? '—' : `${performance.requests_per_second} req/s`} />
        <Metric label="Requests" value={String(performance.requests)} />
        <Metric label="Errors" value={errors} />
        <Metric label="Virtual users" value={String(performance.virtual_users)} />
      </dl>
    </section>
  )
}
