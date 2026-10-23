import { FormEvent, useState, type Dispatch, type SetStateAction } from 'react'
import {
  Activity, BarChart2, Download, GitBranch,
  Loader2, PlayCircle, Plus, Terminal,
} from 'lucide-react'
import type { TestRun, TestRunDetails, TestSuite } from '@/types/domain'

type RunsSubTab = 'suites' | 'executions' | 'results'

type SchedulerDrafts = Record<string, { cronExpression: string; active: boolean }>

interface RunsTabProps {
  runsSubTab: RunsSubTab
  setRunsSubTab: (tab: RunsSubTab) => void
  selectedProjectId: string | null
  suiteForm: { name: string; tags: string }
  setSuiteForm: Dispatch<SetStateAction<{ name: string; tags: string }>>
  handleCreateSuite: (e: FormEvent) => Promise<void>
  suites: TestSuite[]
  selectedSuiteId: string | null
  setSelectedSuiteId: (id: string | null) => void
  schedulerDrafts: SchedulerDrafts
  setSchedulerDrafts: Dispatch<SetStateAction<SchedulerDrafts>>
  handleSaveScheduler: (suiteId: string) => Promise<void>
  savingSchedulerSuiteId: string | null
  runProject: string
  setRunProject: (project: string) => void
  detectedProjects: string[]
  projectCollections: Record<string, string[]>
  runCollection: string
  setRunCollection: (collection: string) => void
  collections: string[]
  handleCreateRun: () => Promise<void>
  runs: TestRun[]
  runsByNewest: TestRun[]
  selectedRunId: string | null
  setSelectedRunId: (id: string | null) => void
  handleExecuteRun: () => Promise<void>
  connected: boolean
  connectionError: string | null
  clearMessages: () => void
  groupedText: string
  selectedRunDetails: TestRunDetails | null
  runDetailsLoading: boolean
  expandedResultId: string | null
  setExpandedResultId: (id: string | null) => void
}

const RUNS_SUB_TABS: { id: RunsSubTab; label: string; icon: typeof Terminal }[] = [
  { id: 'suites', label: 'Projects', icon: Terminal },
  { id: 'executions', label: 'Executions', icon: PlayCircle },
  { id: 'results', label: 'Results', icon: BarChart2 },
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

function formatDuration(durationMs: number | null): string {
  if (durationMs == null || Number.isNaN(durationMs)) return '-'
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  return `${(durationMs / 1000).toFixed(2)} s`
}

function escapeCsvValue(value: unknown): string {
  const text = value == null ? '' : String(value)
  const escaped = text.replace(/"/g, '""')
  if (/[",\n]/.test(escaped)) return `"${escaped}"`
  return escaped
}

function formatCollectionLabel(path: string): string {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 1) return path
  return parts.slice(1).join('/')
}

export default function RunsTab({
  runsSubTab,
  setRunsSubTab,
  selectedProjectId,
  suiteForm,
  setSuiteForm,
  handleCreateSuite,
  suites,
  selectedSuiteId,
  setSelectedSuiteId,
  schedulerDrafts,
  setSchedulerDrafts,
  handleSaveScheduler,
  savingSchedulerSuiteId,
  runProject,
  setRunProject,
  detectedProjects,
  projectCollections,
  runCollection,
  setRunCollection,
  collections,
  handleCreateRun,
  runs,
  runsByNewest,
  selectedRunId,
  setSelectedRunId,
  handleExecuteRun,
  connected,
  connectionError,
  clearMessages,
  groupedText,
  selectedRunDetails,
  runDetailsLoading,
  expandedResultId,
  setExpandedResultId,
}: RunsTabProps) {
  const inputCls = 'form-input'
  const selectCls = 'form-input'
  const [exportingPdf, setExportingPdf] = useState(false)
  const filteredCollections = runProject ? (projectCollections[runProject] || []) : collections

  const handleExportCsv = () => {
    if (!selectedRunDetails) return
    const headers = ['run_id', 'test_id', 'test_name', 'class_name', 'status', 'duration_ms', 'error_message', 'stack_trace']
    const rows = selectedRunDetails.results.map(r => [selectedRunDetails.id, r.id, r.test_name, r.class_name || '', r.status, r.duration_ms ?? '', r.error_message || '', r.stack_trace || ''])
    const csv = [headers, ...rows].map(row => row.map(v => escapeCsvValue(v)).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `run-${selectedRunDetails.id.slice(0, 8)}-results.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const handleExportPdf = async () => {
    if (!selectedRunDetails) return
    setExportingPdf(true)
    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ])

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
    doc.setFontSize(14)
    doc.text('Automation Test Manager - Run Report', 40, 40)
    doc.setFontSize(10)
    doc.text(`Run ID: ${selectedRunDetails.id}`, 40, 60)
    doc.text(`Status: ${selectedRunDetails.status}`, 40, 74)
    doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 88)
    doc.text(
      `Total: ${selectedRunDetails.total_tests} | Passed: ${selectedRunDetails.passed_tests} | Failed: ${selectedRunDetails.failed_tests} | Skipped: ${selectedRunDetails.skipped_tests}`,
      40,
      102,
    )
    autoTable(doc, {
      startY: 120,
      head: [['Test Name', 'Class', 'Status', 'Duration (ms)', 'Error']],
      body: selectedRunDetails.results.map(r => [r.test_name, r.class_name || '-', r.status, r.duration_ms == null ? '-' : String(r.duration_ms), r.error_message || '-']),
      styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: [15, 23, 42] },
      columnStyles: { 0: { cellWidth: 180 }, 1: { cellWidth: 140 }, 2: { cellWidth: 70 }, 3: { cellWidth: 85 }, 4: { cellWidth: 290 } },
    })
    doc.save(`run-${selectedRunDetails.id.slice(0, 8)}-report.pdf`)
    } finally {
      setExportingPdf(false)
    }
  }

  return (
    <div className="space-y-5 animate-fade-in-up">
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {RUNS_SUB_TABS.map(item => {
          const ItemIcon = item.icon
          return (
            <button
              key={item.id}
              onClick={() => setRunsSubTab(item.id)}
              className={runsSubTab === item.id ? 'tab-pill-active whitespace-nowrap' : 'tab-pill whitespace-nowrap'}
            >
              <ItemIcon size={13} />
              {item.label}
            </button>
          )
        })}
      </div>

      {runsSubTab === 'suites' && (
        <div className="space-y-4 content-transition" key="runs-suites">
          <div className="panel-shell max-w-xl">
            <h3 className="mb-3 section-heading"><span className="section-heading-icon"><Terminal size={14} /></span>New Project</h3>
            <form onSubmit={e => { void handleCreateSuite(e as FormEvent) }} className="space-y-3">
              <input className={inputCls} placeholder="Project Name" value={suiteForm.name} onChange={e => setSuiteForm(p => ({ ...p, name: e.target.value }))} required disabled={!selectedProjectId} />
              <input className={inputCls} placeholder="Tags (comma separated)" value={suiteForm.tags} onChange={e => setSuiteForm(p => ({ ...p, tags: e.target.value }))} disabled={!selectedProjectId} />
              <button className="btn-secondary" disabled={!selectedProjectId}>
                <Plus size={15} /> Add Project
              </button>
            </form>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {suites.map(suite => (
              <div key={suite.id} className={`card transition-all duration-200 ${selectedSuiteId === suite.id ? 'ring-1 ring-emerald-500/20' : ''}`} style={selectedSuiteId === suite.id ? { borderColor: 'rgba(52,211,153,0.3)' } : {}}>
                <button onClick={() => setSelectedSuiteId(suite.id)} className="flex w-full items-start gap-3 p-4 text-left">
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${selectedSuiteId === suite.id ? 'bg-emerald-500/15' : 'bg-white/[0.04]'}`}>
                    <Terminal size={13} className={selectedSuiteId === suite.id ? 'text-emerald-400' : 'text-slate-500'} />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-200">{suite.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {suite.active
                        ? <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400">Active</span>
                        : <span className="rounded-full bg-slate-700/50 px-2 py-0.5 text-[11px] text-slate-500">Inactive</span>
                      }
                      {suite.cron_expression && <span className="font-mono text-[11px] text-slate-500">{suite.cron_expression}</span>}
                      {suite.tags?.map(t => <span key={t} className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-slate-500">{t}</span>)}
                    </div>
                  </div>
                </button>
                <div className="border-t border-white/[0.05] px-4 py-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500/70">Scheduler</p>
                  <div className="space-y-2">
                    <input
                      className={inputCls}
                      placeholder="0 */4 * * *"
                      value={schedulerDrafts[suite.id]?.cronExpression ?? suite.cron_expression ?? ''}
                      onChange={e => setSchedulerDrafts(p => ({ ...p, [suite.id]: { cronExpression: e.target.value, active: p[suite.id]?.active ?? suite.active } }))}
                    />
                    <label className="flex cursor-pointer items-center justify-between text-xs text-slate-400">
                      Scheduler activ
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-emerald-400"
                        checked={schedulerDrafts[suite.id]?.active ?? suite.active}
                        onChange={e => setSchedulerDrafts(p => ({ ...p, [suite.id]: { cronExpression: p[suite.id]?.cronExpression ?? suite.cron_expression ?? '', active: e.target.checked } }))}
                      />
                    </label>
                    <button onClick={() => void handleSaveScheduler(suite.id)} disabled={savingSchedulerSuiteId === suite.id} className="btn-ghost w-full py-1.5">
                      {savingSchedulerSuiteId === suite.id ? 'Saving...' : 'Save Scheduler'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {runsSubTab === 'executions' && (
        <div className="grid gap-4 xl:grid-cols-[380px_1fr] content-transition" key="runs-executions">
          <div className="space-y-4">
            <div className="panel-shell">
              <h3 className="mb-3 section-heading"><span className="section-heading-icon"><PlayCircle size={14} /></span>Create Test Run</h3>
              <div className="flex gap-2">
                <select value={runProject} onChange={e => setRunProject(e.target.value)} className={selectCls}>
                  {detectedProjects.length === 0 && <option value="">No projects detected</option>}
                  {detectedProjects.map(project => <option key={project} value={project}>{project}</option>)}
                </select>
                <select value={runCollection} onChange={e => setRunCollection(e.target.value)} className={selectCls}>
                  {filteredCollections.length === 0 && <option value="">No collections</option>}
                  {filteredCollections.map(c => <option key={c} value={c}>{formatCollectionLabel(c)}</option>)}
                </select>
                <button onClick={() => void handleCreateRun()} disabled={!selectedProjectId || !runCollection} className="btn-primary shrink-0">
                  Run
                </button>
              </div>
            </div>

            <div className="panel-shell">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="section-heading"><span className="section-heading-icon"><Activity size={14} /></span>Runs <span className="ml-1 text-slate-500/70">({runs.length})</span></h3>
                <button onClick={() => void handleExecuteRun()} disabled={!selectedRunId} className="btn-primary text-xs px-4 py-2">
                  <PlayCircle size={13} /> Execute
                </button>
              </div>
              <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {runs.length === 0 && <p className="py-4 text-center text-sm text-slate-500/70">Create a run first.</p>}
                {runsByNewest.map(run => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition ${
                      selectedRunId === run.id ? 'border-cyan-500/30 bg-cyan-500/[0.06] ring-1 ring-cyan-500/15' : 'border-white/[0.04] bg-white/[0.02] hover:border-white/[0.08] hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-slate-400">{run.id.slice(0, 8)}</span>
                      <div className="flex items-center gap-1 text-xs text-slate-500/70"><GitBranch size={11} />{run.branch || 'main'}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-500/70">{run.passed_tests}/{run.total_tests}</span>
                      <StatusBadge status={run.status} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="panel-shell">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="section-heading"><span className="section-heading-icon"><Terminal size={14} /></span>Live Logs</h3>
                <span className={`flex items-center gap-1.5 text-xs ${connected ? 'text-emerald-400' : 'text-slate-500/70'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                  {connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <button onClick={clearMessages} className="btn-ghost text-xs px-2">Clear</button>
            </div>
            {connectionError && <p className="mb-2 text-xs text-rose-400">{connectionError}</p>}
            <pre className="h-[420px] overflow-auto rounded-xl p-3 font-mono text-xs leading-relaxed text-emerald-300/90" style={{ background: 'rgba(5,10,24,0.8)', border: '1px solid rgba(255,255,255,0.05)' }}>
              {groupedText || '$ Waiting for logs... Select a run and click Execute.'}
            </pre>
          </div>
        </div>
      )}

      {runsSubTab === 'results' && (
        <div className="panel-shell content-transition" key="runs-results">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="section-heading"><span className="section-heading-icon"><BarChart2 size={14} /></span>Test Results</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleExportPdf()}
                disabled={!selectedRunDetails || selectedRunDetails.results.length === 0 || exportingPdf}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-slate-500 hover:text-slate-200 disabled:opacity-40"
              >
                {exportingPdf ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                {exportingPdf ? 'Generating...' : 'PDF'}
              </button>
              <button
                onClick={handleExportCsv}
                disabled={!selectedRunDetails || selectedRunDetails.results.length === 0}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-slate-500 hover:text-slate-200 disabled:opacity-40"
              >
                <Download size={11} /> CSV
              </button>
            </div>
          </div>

          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-slate-500">Select run</label>
            <select value={selectedRunId || ''} onChange={e => setSelectedRunId(e.target.value || null)} className={selectCls}>
              {runsByNewest.map(run => (
                <option key={run.id} value={run.id}>{run.id.slice(0, 8)} · {run.status} · {run.branch || 'main'}</option>
              ))}
            </select>
          </div>

          {!selectedRunId && <p className="py-4 text-center text-sm text-slate-500/70">Selecteaza un run pentru rezultate.</p>}
          {selectedRunId && runDetailsLoading && (
            <div className="flex items-center gap-2 py-4 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Se incarca...</div>
          )}
          {selectedRunId && !runDetailsLoading && selectedRunDetails && (
            <>
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: 'Total', value: selectedRunDetails.total_tests, cls: 'text-slate-200' },
                  { label: 'Passed', value: selectedRunDetails.passed_tests, cls: 'text-emerald-400' },
                  { label: 'Failed', value: selectedRunDetails.failed_tests, cls: 'text-rose-400' },
                  { label: 'Skipped', value: selectedRunDetails.skipped_tests, cls: 'text-slate-500' },
                ].map(({ label, value, cls }) => (
                  <div key={label} className="rounded-lg border border-white/[0.05] bg-white/[0.03] p-3 text-center">
                    <p className={`text-xl font-bold ${cls}`}>{value}</p>
                    <p className="text-[11px] text-slate-500">{label}</p>
                  </div>
                ))}
              </div>
              <div className="max-h-[480px] space-y-1.5 overflow-y-auto pr-1">
                {selectedRunDetails.results.length === 0 && <p className="text-center text-sm text-slate-500/70">No results yet.</p>}
                {selectedRunDetails.results.map(result => {
                  const isExpanded = expandedResultId === result.id
                  return (
                    <div key={result.id} className="rounded-lg border border-white/[0.04] bg-white/[0.02]">
                      <button onClick={() => setExpandedResultId(isExpanded ? null : result.id)} className="flex w-full items-center justify-between px-3 py-2.5 text-left">
                        <div className="min-w-0 flex-1 pr-3">
                          <p className="truncate text-sm font-medium text-slate-200">{result.test_name}</p>
                          <p className="text-xs text-slate-500">{result.class_name || 'No class'} · {formatDuration(result.duration_ms)}</p>
                        </div>
                        <StatusBadge status={result.status || 'error'} />
                      </button>
                      {isExpanded && (result.error_message || result.stack_trace) && (
                        <div className="space-y-2.5 border-t border-white/[0.05] px-3 py-3">
                          {result.error_message && (
                            <div>
                              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-rose-400">Error</p>
                              <p className="rounded-xl p-2.5 text-xs text-rose-200">{result.error_message}</p>
                            </div>
                          )}
                          {result.stack_trace && (
                            <div>
                              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Stack Trace</p>
                              <pre className="max-h-48 overflow-auto rounded-xl p-2.5 font-mono text-[11px] text-slate-300">{result.stack_trace}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
