import { Suspense, lazy, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, CheckCircle2, Loader2, Timer, XCircle, GitBranch } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { StatCard } from '@/components/ui/StatCard'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { RunSourceBadge } from '@/components/runs/RunSourceBadge'
import { RunFiltersBar } from '@/components/runs/RunFiltersBar'
import { useRunFilters } from '@/hooks/useRunFilters'
import { runDisplayName } from '@/utils/runName'

const DashboardCharts = lazy(() => import('@/components/charts/DashboardCharts'))

function getRunDurationSeconds(run: { started_at: string | null; finished_at: string | null }): number | null {
  if (!run.started_at || !run.finished_at) return null
  const started = new Date(run.started_at).getTime()
  const finished = new Date(run.finished_at).getTime()
  if (Number.isNaN(started) || Number.isNaN(finished) || finished <= started) return null
  return Number(((finished - started) / 1000).toFixed(2))
}

export default function DashboardPage() {
  const runs = useAppStore(s => s.runs)
  const suites = useAppStore(s => s.suites)
  const selectedProjectId = useAppStore(s => s.selectedProjectId)
  const loadProjectData = useAppStore(s => s.loadProjectData)
  const navigate = useNavigate()

  useEffect(() => {
    if (selectedProjectId) void loadProjectData(selectedProjectId)
  }, [selectedProjectId, loadProjectData])

  const runsByNewest = useMemo(() =>
    [...runs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [runs])

  const {
    filteredRuns, dateFrom, setDateFrom, dateTo, setDateTo, collectionFilter, setCollectionFilter,
    sourceFilter, setSourceFilter, collectionOptions, environmentFilter, setEnvironmentFilter, environmentOptions,
    executionTimeFilter, setExecutionTimeFilter, executionTimeOptions, hasActiveFilters, clearFilters,
  } = useRunFilters(runsByNewest)

  const runTrendData = useMemo(() =>
    [...filteredRuns]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((run, i) => {
        const total = run.total_tests || 0
        // Runs with parsed test counts use the real ratio. Runs without counts
        // (e.g. GitHub Actions runs) fall back to their status: passed = 100%,
        // failed/error = 0%; still-running/other runs are left out of the trend.
        let passRate: number | null
        if (total > 0) {
          passRate = Number(((run.passed_tests / total) * 100).toFixed(2))
        } else if (run.status === 'passed') {
          passRate = 100
        } else if (run.status === 'failed' || run.status === 'error') {
          passRate = 0
        } else {
          passRate = null
        }
        return {
          runLabel: `R${i + 1}`,
          runShortId: runDisplayName(run),
          source: run.source,
          passRate,
          durationSeconds: getRunDurationSeconds(run),
        }
      }),
    [filteredRuns])

  const avgPassRate = useMemo(() => {
    const rated = runTrendData.filter(d => d.passRate != null)
    if (rated.length === 0) return 0
    return Math.round(rated.reduce((s, d) => s + (d.passRate ?? 0), 0) / rated.length)
  }, [runTrendData])

  const totalFailures = useMemo(() => filteredRuns.reduce((s, r) => s + r.failed_tests, 0), [filteredRuns])
  const activeSuites = useMemo(() => suites.filter(s => s.active).length, [suites])

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Stats row */}
      <div className="grid shrink-0 gap-4 grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total Runs" value={filteredRuns.length} icon={Activity} accent="indigo"
          sub={hasActiveFilters ? `of ${runs.length} total` : (runsByNewest[0]?.status ? `Last: ${runsByNewest[0].status}` : 'no runs yet')} />
        <StatCard title="Pass Rate" value={`${avgPassRate}%`} icon={CheckCircle2} accent="emerald"
          sub={`across ${filteredRuns.length} runs`} />
        <StatCard title="Failures" value={totalFailures} icon={XCircle} accent="rose"
          sub="total failed" />
        <StatCard title="Active Suites" value={activeSuites} icon={Timer} accent="yellow"
          sub={`${suites.length} total`} />
      </div>

      {/* Charts + Recent Runs */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_380px]">
        {/* Charts panel */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft p-4">
          <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
            <h3 className="section-title">Trends {hasActiveFilters && <span className="text-[11px] font-normal text-gray-400">({filteredRuns.length} of {runs.length} runs)</span>}</h3>
            <RunFiltersBar
              dateFrom={dateFrom}
              setDateFrom={setDateFrom}
              dateTo={dateTo}
              setDateTo={setDateTo}
              collectionFilter={collectionFilter}
              setCollectionFilter={setCollectionFilter}
              sourceFilter={sourceFilter}
              setSourceFilter={setSourceFilter}
              collectionOptions={collectionOptions}
              environmentFilter={environmentFilter}
              setEnvironmentFilter={setEnvironmentFilter}
              environmentOptions={environmentOptions}
              executionTimeFilter={executionTimeFilter}
              setExecutionTimeFilter={setExecutionTimeFilter}
              executionTimeOptions={executionTimeOptions}
              hasActiveFilters={hasActiveFilters}
              clearFilters={clearFilters}
            />
          </div>
          <Suspense fallback={
            <div className="flex h-full items-center justify-center">
              <Loader2 size={20} className="animate-spin text-gray-400" />
            </div>
          }>
            <DashboardCharts runTrendData={runTrendData} runs={filteredRuns} />
          </Suspense>
        </div>

        {/* Recent runs panel */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft">
          <div className="shrink-0 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
            <h3 className="section-title">Recent Runs {hasActiveFilters && <span className="text-[11px] font-normal text-gray-400">({filteredRuns.length})</span>}</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {runsByNewest.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center px-4 py-8">
                <Activity size={28} className="mb-3 text-gray-300 dark:text-gray-600" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No runs yet.</p>
                <button onClick={() => navigate('/runs')}
                  className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium">
                  Create your first run →
                </button>
              </div>
            ) : filteredRuns.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center px-4 py-8">
                <Activity size={28} className="mb-3 text-gray-300 dark:text-gray-600" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No runs match the current filters.</p>
                <button onClick={clearFilters}
                  className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium">
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {filteredRuns.slice(0, 20).map(run => (
                  <button
                    key={run.id}
                    onClick={() => { useAppStore.getState().setSelectedRunId(run.id); navigate('/runs') }}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-gray-50 dark:hover:bg-gray-700/30"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{runDisplayName(run)}</span>
                      <RunSourceBadge source={run.source} />
                      {run.collection && (
                        <span className="truncate text-[11px] text-gray-500 dark:text-gray-400">{run.collection}</span>
                      )}
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
                        <GitBranch size={10} />{run.branch || 'main'}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">{run.passed_tests}/{run.total_tests}</span>
                      <StatusBadge status={run.status} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
