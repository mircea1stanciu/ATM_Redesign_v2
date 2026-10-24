import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileBarChart2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import { testingApi, testingKeys } from '@/features/testing/api'
import { Badge, Card, EmptyState, ErrorState, Select, Skeleton, StatusPill, TestTypeChip } from '@/ui'
import { reportKeys, reportsApi } from './api'
import type { ReportRow } from './api'

const REPORT_LABEL: Record<ReportRow['report'], string> = {
  ready: 'Open report', unavailable: 'Allure not installed', failed: 'Report failed', none: 'No report',
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  return seconds < 60 ? `${seconds.toFixed(0)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`
}

/** Reports › Reports: every finished run with its Allure report: date, pass rate, duration, environment, branch. */
export default function ReportsListPage() {
  const projectId = useAppStore(s => s.selectedProjectId) ?? ''
  const [params, setParams] = useSearchParams()
  const suiteId = params.get('suite') ?? ''
  const suites = useQuery({ queryKey: testingKeys.suites(projectId), queryFn: () => testingApi.suites(projectId), enabled: Boolean(projectId) })
  const reports = useQuery({
    queryKey: reportKeys.list(projectId, suiteId),
    queryFn: () => reportsApi.list(projectId, suiteId || undefined),
    enabled: Boolean(projectId),
    refetchInterval: 10_000,
  })
  if (!projectId) return <EmptyState icon={FileBarChart2} title="Choose a project">Pick a project in the top bar.</EmptyState>

  return (
    <div className="flex flex-col gap-3">
      <div className="w-64">
        <Select label="Suite" value={suiteId}
          onChange={e => setParams(p => { if (e.target.value) p.set('suite', e.target.value); else p.delete('suite'); return p }, { replace: true })}>
          <option value="">All suites</option>
          {(suites.data ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>
      <Card className="overflow-x-auto">
        {reports.isPending ? <div className="space-y-2 p-4"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
          : reports.isError ? <div className="p-4"><ErrorState title="Could not load the reports">{apiService.errorMessage(reports.error)}</ErrorState></div>
            : reports.data.length === 0 ? (
              <EmptyState icon={FileBarChart2} title="No reports yet">Every finished run gets an Allure report. Run a suite in Tests.</EmptyState>
            ) : (
              <table className="w-full text-left text-[13px]" aria-label="Reports">
                <thead className="border-b border-line text-xs text-fg-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Run</th>
                    <th className="px-2 py-2 font-medium">Suite</th>
                    <th className="px-2 py-2 font-medium">Result</th>
                    <th className="px-2 py-2 font-medium">Pass rate</th>
                    <th className="px-2 py-2 font-medium">Duration</th>
                    <th className="px-2 py-2 font-medium">Environment</th>
                    <th className="px-2 py-2 font-medium">Branch</th>
                    <th className="px-4 py-2 font-medium">Report</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {reports.data.map(row => (
                    <tr key={row.run_id}>
                      <td className="px-4 py-2">
                        <p className="font-medium text-fg">{row.name}</p>
                        <p className="text-xs text-fg-muted">{row.created_at ? new Date(row.created_at).toLocaleString() : ''}{row.trigger === 'schedule' ? ' · scheduled' : ''}</p>
                      </td>
                      <td className="px-2 py-2"><span className="flex items-center gap-1.5">{row.suite}<TestTypeChip type={row.test_type} /></span></td>
                      <td className="px-2 py-2"><StatusPill status={row.status} /></td>
                      <td className="px-2 py-2">{row.pass_rate === null ? '—' : `${row.pass_rate} %`}</td>
                      <td className="px-2 py-2">{formatDuration(row.duration_seconds)}</td>
                      <td className="px-2 py-2">{row.environment ?? '—'}</td>
                      <td className="px-2 py-2"><code className="text-xs">{row.branch ?? '—'}</code></td>
                      <td className="px-4 py-2">
                        {row.report === 'ready'
                          ? <Link to={`/reports/runs/${row.run_id}`} className="font-semibold text-accent hover:underline" aria-label={`Open the report of ${row.name}`}>Open report</Link>
                          : <Badge tone={row.report === 'none' ? 'neutral' : 'warning'}>{REPORT_LABEL[row.report]}</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
      </Card>
    </div>
  )
}
