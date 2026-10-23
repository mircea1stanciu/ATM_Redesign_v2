import {
  AlertTriangle, ArrowLeftRight, CheckCircle2, Loader2,
} from 'lucide-react'
import type { TestRun } from '@/types/domain'
import { runDisplayName } from '@/utils/runName'

type AnalyticsSubTab = 'comparison' | 'flaky'
type CompareStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error' | 'skipped' | 'cancelled' | 'missing'

interface RunComparisonItem {
  key: string
  testName: string
  className: string | null
  statusA: CompareStatus
  statusB: CompareStatus
  kind: 'regression' | 'fix' | 'changed' | 'added' | 'removed' | 'unchanged'
}

interface RunComparisonSummary {
  totalCompared: number
  changed: number
  regressions: number
  fixes: number
  added: number
  removed: number
}

interface FlakyTestInsight {
  key: string
  testName: string
  className: string | null
  executions: number
  passed: number
  failed: number
  instability: number
}

interface AnalyticsTabProps {
  analyticsSubTab: AnalyticsSubTab
  setAnalyticsSubTab: (tab: AnalyticsSubTab) => void
  runsByNewest: TestRun[]
  compareRunAId: string | null
  setCompareRunAId: (id: string | null) => void
  compareRunBId: string | null
  setCompareRunBId: (id: string | null) => void
  compareLoading: boolean
  runComparisonSummary: RunComparisonSummary | null
  runComparisonItems: RunComparisonItem[]
  flakyLoading: boolean
  flakyTests: FlakyTestInsight[]
}

const ANALYTICS_SUB_TABS: { id: AnalyticsSubTab; label: string; icon: typeof ArrowLeftRight }[] = [
  { id: 'comparison', label: 'Run Comparison', icon: ArrowLeftRight },
  { id: 'flaky', label: 'Flaky Tests', icon: AlertTriangle },
]

const STATUS_STYLES: Record<string, { dot: string; bg: string; text: string }> = {
  pending: { dot: 'bg-amber-400', bg: 'bg-amber-400/10', text: 'text-amber-300' },
  running: { dot: 'bg-sky-400 animate-pulse', bg: 'bg-sky-400/10', text: 'text-sky-300' },
  passed: { dot: 'bg-emerald-400', bg: 'bg-emerald-400/10', text: 'text-emerald-300' },
  failed: { dot: 'bg-rose-400', bg: 'bg-rose-400/10', text: 'text-rose-300' },
  error: { dot: 'bg-orange-400', bg: 'bg-orange-400/10', text: 'text-orange-300' },
  skipped: { dot: 'bg-zinc-500', bg: 'bg-zinc-500/10', text: 'text-zinc-400' },
  cancelled: { dot: 'bg-slate-500', bg: 'bg-slate-500/10', text: 'text-slate-400' },
  missing: { dot: 'bg-slate-600', bg: 'bg-slate-600/10', text: 'text-slate-500' },
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.error
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${style.bg} ${style.text}`}
      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' }}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
      {status}
    </span>
  )
}

export default function AnalyticsTab({
  analyticsSubTab,
  setAnalyticsSubTab,
  runsByNewest,
  compareRunAId,
  setCompareRunAId,
  compareRunBId,
  setCompareRunBId,
  compareLoading,
  runComparisonSummary,
  runComparisonItems,
  flakyLoading,
  flakyTests,
}: AnalyticsTabProps) {
  const selectCls = 'form-input'

  return (
    <div className="space-y-5 animate-fade-in-up">
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {ANALYTICS_SUB_TABS.map(item => {
          const ItemIcon = item.icon
          return (
            <button
              key={item.id}
              onClick={() => setAnalyticsSubTab(item.id)}
              className={analyticsSubTab === item.id ? 'tab-pill-active whitespace-nowrap' : 'tab-pill whitespace-nowrap'}
            >
              <ItemIcon size={13} />
              {item.label}
            </button>
          )
        })}
      </div>

      {analyticsSubTab === 'comparison' && (
        <div className="panel-shell content-transition" key="analytics-comparison">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="section-heading"><span className="section-heading-icon"><ArrowLeftRight size={14} /></span>Run Comparison</h3>
              <p className="mt-0.5 text-xs text-slate-500">Diff rezultate test-case intre doua runs</p>
            </div>
            <ArrowLeftRight size={16} className="text-slate-500/70" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Run A (baseline)</label>
              <select value={compareRunAId || ''} onChange={e => setCompareRunAId(e.target.value || null)} className={selectCls}>
                {runsByNewest.map(r => <option key={`a-${r.id}`} value={r.id}>{runDisplayName(r)} · {r.status} · {r.branch}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Run B (target)</label>
              <select value={compareRunBId || ''} onChange={e => setCompareRunBId(e.target.value || null)} className={selectCls}>
                {runsByNewest.map(r => <option key={`b-${r.id}`} value={r.id}>{runDisplayName(r)} · {r.status} · {r.branch}</option>)}
              </select>
            </div>
          </div>
          {compareRunAId === compareRunBId && <p className="mt-3 text-xs text-amber-400">Selecteaza doua runs diferite.</p>}
          {compareLoading && <div className="mt-4 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Se incarca comparatia...</div>}
          {!compareLoading && runComparisonSummary && (
            <>
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {[
                  { label: 'Total', value: runComparisonSummary.totalCompared, cls: 'text-slate-200' },
                  { label: 'Changed', value: runComparisonSummary.changed, cls: 'text-amber-300' },
                  { label: 'Regressions', value: runComparisonSummary.regressions, cls: 'text-rose-400' },
                  { label: 'Fixes', value: runComparisonSummary.fixes, cls: 'text-emerald-400' },
                  { label: 'Added', value: runComparisonSummary.added, cls: 'text-sky-400' },
                  { label: 'Removed', value: runComparisonSummary.removed, cls: 'text-slate-500' },
                ].map(({ label, value, cls }) => (
                  <div key={label} className="rounded-lg border border-white/[0.05] bg-white/[0.03] p-3 text-center">
                    <p className={`text-xl font-bold ${cls}`}>{value}</p>
                    <p className="text-[11px] text-slate-500">{label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 max-h-80 space-y-1.5 overflow-y-auto pr-1">
                {runComparisonItems.length === 0
                  ? <p className="py-4 text-center text-sm text-slate-500/70">Nicio diferenta intre cele doua runs.</p>
                  : runComparisonItems.map(item => (
                    <div key={item.key} className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2.5">
                      <div className="min-w-0 flex-1 pr-4">
                        <p className="truncate text-sm font-medium text-slate-200">{item.testName}</p>
                        <p className="text-xs text-slate-500">{item.className || 'No class'}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={item.statusA} />
                        <span className="text-slate-700">→</span>
                        <StatusBadge status={item.statusB} />
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          item.kind === 'regression' ? 'bg-rose-500/20 text-rose-300' :
                          item.kind === 'fix' ? 'bg-emerald-500/20 text-emerald-300' :
                          item.kind === 'added' ? 'bg-sky-500/20 text-sky-300' :
                          item.kind === 'removed' ? 'bg-slate-700 text-slate-400' :
                          'bg-amber-500/20 text-amber-300'
                        }`}>{item.kind}</span>
                      </div>
                    </div>
                  ))
                }
              </div>
            </>
          )}
        </div>
      )}

      {analyticsSubTab === 'flaky' && (
        <div className="panel-shell content-transition" key="analytics-flaky">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="section-heading"><span className="section-heading-icon"><AlertTriangle size={14} /></span>Flaky Tests</h3>
              <p className="mt-0.5 text-xs text-slate-500">Teste cu status mixt in ultimele 20 runs</p>
            </div>
            <AlertTriangle size={16} className="text-amber-500" />
          </div>
          {flakyLoading && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Analizand runs...</div>}
          {!flakyLoading && flakyTests.length === 0 && (
            <div className="flex flex-col items-center py-10 text-center">
              <CheckCircle2 size={28} className="mb-3 text-emerald-600" />
              <p className="text-sm text-slate-500/70">Nu s-au detectat teste flaky. Totul arata stabil.</p>
            </div>
          )}
          {!flakyLoading && flakyTests.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {flakyTests.map(item => (
                <div key={item.key} className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-sm font-semibold text-slate-200">{item.testName}</p>
                    <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300">{item.instability}%</span>
                  </div>
                  <p className="mt-1.5 truncate text-xs text-slate-500">{item.className || 'No class'}</p>
                  <div className="mt-3 flex items-center gap-1.5 text-xs">
                    <span className="rounded-md bg-white/[0.04] px-2 py-1 text-slate-400">{item.executions} runs</span>
                    <span className="rounded-md bg-emerald-900/40 px-2 py-1 text-emerald-300">✓ {item.passed}</span>
                    <span className="rounded-md bg-rose-900/40 px-2 py-1 text-rose-300">✗ {item.failed}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
