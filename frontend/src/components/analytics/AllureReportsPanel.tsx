import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Download, ExternalLink, FileBarChart2, FolderSync, Github, Loader2 } from 'lucide-react'
import { apiService } from '@/services/api'
import type { AllureReport } from '@/types/domain'

interface AllureReportsPanelProps {
  projectId: string | null
}

function durationLabel(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`
  return `${(durationMs / 1000).toFixed(1)} s`
}

export default function AllureReportsPanel({ projectId }: AllureReportsPanelProps) {
  const [reports, setReports] = useState<AllureReport[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState<'local' | 'github' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [openingReportId, setOpeningReportId] = useState<number | null>(null)

  const load = async () => {
    if (!projectId) {
      setReports([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      setReports(await apiService.listAllureReports(projectId))
    } catch (requestError: unknown) {
      setError(apiService.errorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // Reload only when the project changes; `load` is recreated on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const totals = useMemo(() => reports.reduce(
    (value, report) => ({
      total: value.total + report.total_tests,
      passed: value.passed + report.passed_tests,
      failed: value.failed + report.failed_tests + report.broken_tests,
    }),
    { total: 0, passed: 0, failed: 0 },
  ), [reports])

  const importReports = async (source: 'local' | 'github') => {
    if (!projectId) return
    setImporting(source)
    setError(null)
    try {
      if (source === 'local') await apiService.importLocalAllureReports(projectId)
      else await apiService.syncGitHubAllureReports(projectId)
      await load()
    } catch (requestError: unknown) {
      setError(apiService.errorMessage(requestError))
    } finally {
      setImporting(null)
    }
  }

  const openAllureHtml = async (report: AllureReport) => {
    if (!projectId) return
    setOpeningReportId(report.id)
    try {
      const htmlReport = await apiService.getImportedAllureReport(projectId, report.id)
      const url = URL.createObjectURL(htmlReport)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } finally {
      setOpeningReportId(null)
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2.5 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <FileBarChart2 size={14} className="text-rose-600 dark:text-rose-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Allure Reports</h3>
          <span className="text-[10px] text-gray-400">{reports.length} reports</span>
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button
            onClick={() => void importReports('local')}
            disabled={!projectId || importing != null}
            title="Import allure-results from the linked local checkout"
            className="flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-[10px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {importing === 'local' ? <Loader2 size={11} className="animate-spin" /> : <FolderSync size={11} />}
            Local results
          </button>
          <button
            onClick={() => void importReports('github')}
            disabled={!projectId || importing != null}
            title="Import Allure artifacts from recent GitHub Actions runs"
            className="flex items-center gap-1 rounded bg-gray-900 px-2 py-1 text-[10px] font-medium text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            {importing === 'github' ? <Loader2 size={11} className="animate-spin" /> : <Github size={11} />}
            Sync Git artifacts
          </button>
        </div>
      </header>

      <div className="flex shrink-0 gap-2 border-b border-gray-100 px-4 py-2 dark:border-gray-700/50">
        <span className="text-[10px] text-gray-500 dark:text-gray-400">{totals.total} tests</span>
        <span className="text-[10px] text-emerald-600 dark:text-emerald-400">{totals.passed} passed</span>
        <span className="text-[10px] text-red-600 dark:text-red-400">{totals.failed} failed/broken</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-gray-400"><Loader2 size={14} className="animate-spin" /> Loading reports...</div>
        ) : error ? (
          <p className="p-4 text-xs text-red-500 dark:text-red-400">{error}</p>
        ) : reports.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center text-xs text-gray-400">
            <FileBarChart2 size={22} className="text-gray-300 dark:text-gray-600" />
            <p>No Allure results imported yet.</p>
            <p className="text-[10px]">Use Local results for a linked checkout or Sync Git artifacts for Actions artifacts named with “allure”.</p>
          </div>
        ) : reports.map(report => {
          const expanded = expandedId === report.id
          return (
            <div key={report.id} className="border-b border-gray-100 dark:border-gray-700/50">
              <button
                onClick={() => setExpandedId(expanded ? null : report.id)}
                className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
              >
                {expanded ? <ChevronDown size={13} className="shrink-0 text-gray-400" /> : <ChevronRight size={13} className="shrink-0 text-gray-400" />}
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${report.source === 'local' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' : 'bg-gray-200 text-gray-700 dark:bg-gray-600/50 dark:text-gray-200'}`}>
                  {report.source === 'local' ? 'LOCAL' : 'GIT'}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-700 dark:text-gray-200">{report.name}</span>
                <span className="shrink-0 text-[10px] text-emerald-600 dark:text-emerald-400">{report.passed_tests} pass</span>
                <span className="shrink-0 text-[10px] text-red-600 dark:text-red-400">{report.failed_tests + report.broken_tests} fail</span>
              </button>
              {expanded && (
                <div className="bg-gray-50 px-4 py-2 dark:bg-gray-900/30">
                  <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-500 dark:text-gray-400">
                    {report.branch && <span>Branch: {report.branch}</span>}
                    <span>{report.total_tests} tests</span>
                    <span>{report.skipped_tests} skipped</span>
                    <span>{durationLabel(report.duration_ms)}</span>
                    <button
                      type="button"
                      onClick={() => void openAllureHtml(report)}
                      disabled={openingReportId === report.id}
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
                    >
                      {openingReportId === report.id ? <Loader2 size={10} className="animate-spin" /> : <ExternalLink size={10} />}
                      Allure HTML
                    </button>
                    {report.report_url && <a href={report.report_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"><Download size={10} /> Workflow</a>}
                  </div>
                  <div className="max-h-36 overflow-y-auto rounded border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                    {report.results.map((result, index) => (
                      <div key={`${result.name}-${index}`} className="flex items-center gap-2 border-b border-gray-100 px-2 py-1 last:border-0 dark:border-gray-700/50">
                        <span className={`w-14 shrink-0 text-[9px] font-semibold uppercase ${result.status === 'passed' ? 'text-emerald-600 dark:text-emerald-400' : result.status === 'skipped' ? 'text-gray-500' : 'text-red-600 dark:text-red-400'}`}>{result.status}</span>
                        <span className="min-w-0 flex-1 truncate text-[10px] text-gray-700 dark:text-gray-200" title={result.name}>{result.name}</span>
                        <span className="shrink-0 text-[9px] text-gray-400">{durationLabel(result.duration_ms)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
