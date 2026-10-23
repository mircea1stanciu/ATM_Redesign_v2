import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowLeftRight, CheckCircle2, FileBarChart2, ListChecks, Loader2,
} from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { RunSourceBadge } from '@/components/runs/RunSourceBadge'
import { RunFiltersBar } from '@/components/runs/RunFiltersBar'
import AllureReportsPanel from '@/components/analytics/AllureReportsPanel'
import { useRunFilters } from '@/hooks/useRunFilters'
import { runDisplayName } from '@/utils/runName'

type AnalyticsSection = 'runs' | 'allure' | 'comparison' | 'flaky'

const ANALYTICS_SECTIONS: Array<{ id: AnalyticsSection; label: string; icon: typeof ListChecks }> = [
  { id: 'runs', label: 'Runs', icon: ListChecks },
  { id: 'allure', label: 'Allure Reports', icon: FileBarChart2 },
  { id: 'comparison', label: 'Comparison', icon: ArrowLeftRight },
  { id: 'flaky', label: 'Flaky Tests', icon: AlertTriangle },
]

export default function AnalyticsPage() {
  const runs = useAppStore(s => s.runs)
  const selectedProjectId = useAppStore(s => s.selectedProjectId)
  const loadProjectData = useAppStore(s => s.loadProjectData)
  const compareRunAId = useAppStore(s => s.compareRunAId)
  const setCompareRunAId = useAppStore(s => s.setCompareRunAId)
  const compareRunBId = useAppStore(s => s.compareRunBId)
  const setCompareRunBId = useAppStore(s => s.setCompareRunBId)
  const compareLoading = useAppStore(s => s.compareLoading)
  const runComparisonSummary = useAppStore(s => s.runComparisonSummary)
  const runComparisonItems = useAppStore(s => s.runComparisonItems)
  const flakyLoading = useAppStore(s => s.flakyLoading)
  const flakyTests = useAppStore(s => s.flakyTests)
  const computeFlakyTests = useAppStore(s => s.computeFlakyTests)
  const loadComparison = useAppStore(s => s.loadComparison)
  const [section, setSection] = useState<AnalyticsSection>('runs')

  useEffect(() => {
    if (selectedProjectId) void loadProjectData(selectedProjectId)
  }, [selectedProjectId, loadProjectData])

  useEffect(() => { void computeFlakyTests() }, [runs, computeFlakyTests])
  useEffect(() => { void loadComparison() }, [compareRunAId, compareRunBId, loadComparison])

  const runsByNewest = useMemo(() =>
    [...runs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [runs])

  const {
    filteredRuns, dateFrom, setDateFrom, dateTo, setDateTo, collectionFilter, setCollectionFilter,
    sourceFilter, setSourceFilter, collectionOptions, environmentFilter, setEnvironmentFilter, environmentOptions,
    executionTimeFilter, setExecutionTimeFilter, executionTimeOptions, hasActiveFilters, clearFilters,
  } = useRunFilters(runsByNewest)

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex shrink-0 gap-1 overflow-x-auto rounded-xl border border-gray-200/80 bg-white p-1.5 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        {ANALYTICS_SECTIONS.map(item => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                section === item.id
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100'
              }`}
            >
              <Icon size={13} /> {item.label}
            </button>
          )
        })}
      </div>

      {section === 'runs' && <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200 dark:border-gray-700 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <ListChecks size={14} className="text-blue-600 dark:text-blue-400" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">All Runs</h3>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">{filteredRuns.length} of {runs.length}</span>
          </div>
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
        <div className="flex-1 overflow-y-auto">
          {runs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-gray-400 dark:text-gray-500">No runs yet.</div>
          ) : filteredRuns.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-xs text-gray-400 dark:text-gray-500">
              No runs match the current filters.
              <button onClick={clearFilters} className="text-blue-600 dark:text-blue-400 hover:underline font-medium">Clear filters</button>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {filteredRuns.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 font-mono text-[11px] text-gray-500 dark:text-gray-400">{runDisplayName(r)}</span>
                    <RunSourceBadge source={r.source} />
                    <span className="truncate text-xs text-gray-600 dark:text-gray-300">{r.collection || '—'}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">{new Date(r.created_at).toLocaleString()}</span>
                    <StatusBadge status={r.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>}

      {section === 'allure' && <AllureReportsPanel projectId={selectedProjectId} />}

      {section === 'comparison' && <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft">
        <div className="shrink-0 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <ArrowLeftRight size={14} className="text-blue-600 dark:text-blue-400" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Run Comparison</h3>
          </div>
        </div>

        {/* Selectors */}
        <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-gray-200 dark:border-gray-700 px-4 py-2.5">
          <div>
            <label className="mb-1 block text-[10px] font-medium text-gray-500 dark:text-gray-400">Run A (baseline)</label>
            <select value={compareRunAId || ''} onChange={e => setCompareRunAId(e.target.value || null)} className="form-input !py-1.5 !text-xs">
              {runsByNewest.map(r => <option key={`a-${r.id}`} value={r.id}>{runDisplayName(r)} · {r.status} · {r.branch}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium text-gray-500 dark:text-gray-400">Run B (target)</label>
            <select value={compareRunBId || ''} onChange={e => setCompareRunBId(e.target.value || null)} className="form-input !py-1.5 !text-xs">
              {runsByNewest.map(r => <option key={`b-${r.id}`} value={r.id}>{runDisplayName(r)} · {r.status} · {r.branch}</option>)}
            </select>
          </div>
        </div>

        {compareRunAId === compareRunBId && (
          <p className="shrink-0 px-4 py-1.5 text-[10px] text-amber-600 dark:text-amber-400">Select different runs.</p>
        )}

        {/* Summary cards */}
        {!compareLoading && runComparisonSummary && (
          <div className="flex shrink-0 gap-2 border-b border-gray-200 dark:border-gray-700 px-4 py-2">
            {[
              { label: 'Total', value: runComparisonSummary.totalCompared, cls: 'text-gray-900 dark:text-white' },
              { label: 'Changed', value: runComparisonSummary.changed, cls: 'text-amber-600 dark:text-amber-400' },
              { label: 'Regr', value: runComparisonSummary.regressions, cls: 'text-red-600 dark:text-red-400' },
              { label: 'Fix', value: runComparisonSummary.fixes, cls: 'text-emerald-600 dark:text-emerald-400' },
              { label: 'Add', value: runComparisonSummary.added, cls: 'text-blue-600 dark:text-blue-400' },
              { label: 'Rem', value: runComparisonSummary.removed, cls: 'text-gray-500 dark:text-gray-400' },
            ].map(({ label, value, cls }) => (
              <div key={label} className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 px-2 py-1">
                <span className={`text-sm font-bold ${cls}`}>{value}</span>
                <span className="text-[9px] text-gray-500 dark:text-gray-400">{label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Diff list */}
        <div className="flex-1 overflow-y-auto">
          {compareLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-400 dark:text-gray-500">
              <Loader2 size={14} className="animate-spin" /> Loading...
            </div>
          ) : runComparisonItems.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400 dark:text-gray-500">
              {runComparisonSummary ? 'No differences' : 'Select runs to compare'}
            </div>
          ) : (
            runComparisonItems.map(item => (
              <div key={item.key} className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700/50 px-4 py-2.5">
                <div className="min-w-0 flex-1 pr-3">
                  <p className="truncate text-xs font-medium text-gray-900 dark:text-gray-200">{item.testName}</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">{item.className || 'No class'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <StatusBadge status={item.statusA} />
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">→</span>
                  <StatusBadge status={item.statusB} />
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                    item.kind === 'regression' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                    item.kind === 'fix' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
                    item.kind === 'added' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                    item.kind === 'removed' ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' :
                    'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                  }`}>{item.kind}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>}

      {section === 'flaky' && <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft">
        <div className="shrink-0 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500 dark:text-amber-400" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Flaky Tests</h3>
          </div>
          <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">Unstable tests from the last 20 runs</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {flakyLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-400 dark:text-gray-500">
              <Loader2 size={14} className="animate-spin" /> Analyzing...
            </div>
          ) : flakyTests.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <CheckCircle2 size={28} className="mb-3 text-emerald-500" />
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">No flaky tests detected</p>
              <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">Everything looks stable</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {flakyTests.map(item => (
                <div key={item.key} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-xs font-semibold text-gray-900 dark:text-white">{item.testName}</p>
                    <span className="shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                      {item.instability}%
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-gray-500 dark:text-gray-400">{item.className || 'No class'}</p>
                  <div className="mt-2 flex items-center gap-1.5 text-[10px]">
                    <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-gray-600 dark:text-gray-400">{item.executions} runs</span>
                    <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">✓ {item.passed}</span>
                    <span className="rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-red-700 dark:text-red-300">✗ {item.failed}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      }
    </div>
  )
}
