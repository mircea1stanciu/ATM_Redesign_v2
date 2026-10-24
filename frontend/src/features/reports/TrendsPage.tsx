import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LineChart as LineChartIcon } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import { testingApi, testingKeys } from '@/features/testing/api'
import { EmptyState, ErrorState, Section, Select, Skeleton } from '@/ui'
import { reportKeys, reportsApi } from './api'

const TrendCharts = lazy(() => import('./TrendCharts'))

/** Reports › Trends: a suite's pass rate, duration and (performance suites) response times over its last runs. */
export default function TrendsPage() {
  const projectId = useAppStore(s => s.selectedProjectId) ?? ''
  const [params, setParams] = useSearchParams()
  const suites = useQuery({ queryKey: testingKeys.suites(projectId), queryFn: () => testingApi.suites(projectId), enabled: Boolean(projectId) })
  const suiteId = params.get('suite') ?? suites.data?.[0]?.id ?? ''
  const trends = useQuery({
    queryKey: reportKeys.trends(projectId, suiteId),
    queryFn: () => reportsApi.trends(projectId, suiteId),
    enabled: Boolean(projectId && suiteId),
    refetchInterval: 10_000,
  })
  if (!projectId) return <EmptyState icon={LineChartIcon} title="Choose a project">Pick a project in the top bar.</EmptyState>
  if (suites.data && suites.data.length === 0) {
    return <EmptyState icon={LineChartIcon} title="No suites yet">Trends are drawn per suite. Create one in Tests › Suites.</EmptyState>
  }
  const points = trends.data?.points ?? []
  return (
    <div className="flex flex-col gap-3">
      <div className="w-64">
        <Select label="Suite" value={suiteId} onChange={e => setParams(p => { p.set('suite', e.target.value); return p }, { replace: true })}>
          {(suites.data ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>
      {trends.isPending ? <Skeleton className="h-64" /> : trends.isError ? (
        <ErrorState title="Could not load the trends">{apiService.errorMessage(trends.error)}</ErrorState>
      ) : points.length === 0 ? (
        <EmptyState icon={LineChartIcon} title="No finished runs yet">The trend starts with the suite's first finished run.</EmptyState>
      ) : (
        <>
          <Suspense fallback={<Skeleton className="h-64" />}>
            <TrendCharts points={points} performance={trends.data.test_type === 'performance' || points.some(p => p.p95_ms !== null)} />
          </Suspense>
          <div className="grid gap-3 lg:grid-cols-2">
            <Section title={`Runs (${points.length})`}>
              <table className="w-full text-left text-xs" aria-label="Trend points">
                <thead className="text-fg-muted"><tr><th className="py-1">Run</th><th>Pass rate</th><th>Duration</th><th>Failed</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {points.map(p => (
                    <tr key={p.run_id}>
                      <td className="py-1">{p.created_at ? new Date(p.created_at).toLocaleString() : p.run_id}</td>
                      <td>{p.pass_rate === null ? '—' : `${p.pass_rate} %`}</td>
                      <td>{p.duration_seconds === null ? '—' : `${p.duration_seconds} s`}</td>
                      <td>{p.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
            <Section title="Flaky tests">
              {trends.data.flaky_tests.length === 0
                ? <p className="text-[13px] text-fg-muted">No test passed in some runs and failed in others.</p>
                : <ul className="list-disc space-y-1 pl-4 text-[13px] text-fg" aria-label="Flaky tests">{trends.data.flaky_tests.map(t => <li key={t}>{t}</li>)}</ul>}
            </Section>
          </div>
        </>
      )}
    </div>
  )
}
