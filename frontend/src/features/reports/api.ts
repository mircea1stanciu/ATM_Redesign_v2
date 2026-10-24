import { api } from '@/services/api'

export interface ReportRow {
  run_id: string
  name: string
  suite_id: string
  suite: string
  test_type: string
  status: string
  created_at: string | null
  pass_rate: number | null
  total: number
  failed: number
  duration_seconds: number | null
  environment: string | null
  branch: string | null
  trigger: string
  report: 'ready' | 'unavailable' | 'failed' | 'none'
}

export interface TrendPoint {
  run_id: string
  created_at: string | null
  pass_rate: number | null
  duration_seconds: number | null
  total: number
  failed: number
  p95_ms: number | null
}

export interface SuiteTrends {
  suite_id: string
  suite: string
  test_type: string
  points: TrendPoint[]
  flaky_tests: string[]
}

/** The Reports area (backend app/modules/reporting/reports_router.py). */
export const reportsApi = {
  async list(projectId: string, suiteId?: string): Promise<ReportRow[]> {
    return (await api.get(`/reports/projects/${projectId}/runs`, { params: suiteId ? { suite_id: suiteId } : {} })).data
  },
  async trends(projectId: string, suiteId: string): Promise<SuiteTrends> {
    return (await api.get(`/reports/projects/${projectId}/trends`, { params: { suite_id: suiteId } })).data
  },
  /** A signed, one-hour link to the run's Allure report (works in an iframe and a new tab). */
  async link(runId: string): Promise<string> {
    return (await api.post<{ url: string }>(`/runs/${runId}/report-link`)).data.url
  },
}

export const reportKeys = {
  list: (projectId: string, suiteId: string) => ['reports', projectId, 'list', suiteId] as const,
  trends: (projectId: string, suiteId: string) => ['reports', projectId, 'trends', suiteId] as const,
  link: (runId: string) => ['reports', 'link', runId] as const,
}
