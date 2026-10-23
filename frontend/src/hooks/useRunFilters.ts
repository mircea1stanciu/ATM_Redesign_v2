import { useMemo, useState } from 'react'
import type { TestRun } from '@/types/domain'

/** Format a Date as a local yyyy-mm-dd string (avoids UTC-shift bugs from toISOString()). */
function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** yyyy-mm-dd for 12 months before today, used as the default lower bound so
 * the Dashboard/Analytics pages open scoped to the last year of runs. */
function twelveMonthsAgoKey(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 12)
  return toLocalDateKey(d)
}

/** Shared filtering (execution date range + multi-select run metadata) for run
 * lists and charts shown on the Dashboard and Analytics pages, across both
 * Local and GitHub Action runs. Defaults to the last 12 months. */
export function useRunFilters(runs: TestRun[]) {
  const [dateFrom, setDateFrom] = useState(twelveMonthsAgoKey) // yyyy-mm-dd, '' = no lower bound
  const [dateTo, setDateTo] = useState('') // yyyy-mm-dd, '' = no upper bound
  const [collectionFilter, setCollectionFilter] = useState<string[]>([])
  const [sourceFilter, setSourceFilter] = useState<TestRun['source'][]>([])
  const [environmentFilter, setEnvironmentFilter] = useState<string[]>([])
  const [executionTimeFilter, setExecutionTimeFilter] = useState<string[]>([])

  const collectionOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of runs) if (r.collection) set.add(r.collection)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [runs])

  const environmentOptions = useMemo(() => {
    const values = new Set<string>()
    for (const run of runs) if (run.environment) values.add(run.environment)
    return [...values].sort((a, b) => a.localeCompare(b))
  }, [runs])

  const executionTimeOptions = useMemo(() => {
    const values = new Set<string>()
    for (const run of runs) {
      const value = run.execution_time || run.started_at || run.created_at
      if (value) values.add(value)
    }
    return [...values].sort((a, b) => b.localeCompare(a))
  }, [runs])

  const filteredRuns = useMemo(() => runs.filter(r => {
    if (dateFrom || dateTo) {
      const runDate = new Date(r.started_at || r.created_at)
      if (Number.isNaN(runDate.getTime())) return false
      const runKey = toLocalDateKey(runDate)
      if (dateFrom && runKey < dateFrom) return false
      if (dateTo && runKey > dateTo) return false
    }
    if (collectionFilter.length > 0 && !collectionFilter.includes(r.collection || '')) return false
    if (sourceFilter.length > 0 && !sourceFilter.includes(r.source)) return false
    if (environmentFilter.length > 0 && !environmentFilter.includes(r.environment || '')) return false
    if (executionTimeFilter.length > 0 && !executionTimeFilter.includes(r.execution_time || r.started_at || r.created_at)) return false
    return true
  }), [runs, dateFrom, dateTo, collectionFilter, sourceFilter, environmentFilter, executionTimeFilter])

  return {
    filteredRuns,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    collectionFilter,
    setCollectionFilter,
    sourceFilter,
    setSourceFilter,
    environmentFilter,
    setEnvironmentFilter,
    executionTimeFilter,
    setExecutionTimeFilter,
    collectionOptions,
    environmentOptions,
    executionTimeOptions,
    hasActiveFilters: Boolean(dateFrom || dateTo || collectionFilter.length || sourceFilter.length || environmentFilter.length || executionTimeFilter.length),
    clearFilters: () => { setDateFrom(''); setDateTo(''); setCollectionFilter([]); setSourceFilter([]); setEnvironmentFilter([]); setExecutionTimeFilter([]) },
  }
}
