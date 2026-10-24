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
  report: 'ready' | 'unavailable' | 'failed' | 'none' | 'deleted'
  /** The latest publication to Confluence. */
  confluence: 'published' | 'failed' | null
}

export interface Publication {
  id: number
  run_id: string
  status: 'published' | 'failed'
  page_url: string | null
  page_version: number | null
  attachment: string | null
  error: string | null
  published_by: string | null
  published_at: string | null
}

export interface ShareLink {
  id: number
  /** A path on ATM (/api/reports/shared/<token>/index.html); it works without signing in until revoked. */
  url: string
  run_id: string
  run: string | null
  created_by: string | null
  created_at: string
  views: number
  last_viewed_at: string | null
}

export interface AllureStatus { installed: boolean; path: string | null; managed: boolean; java: boolean }

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
  async publications(runId: string): Promise<Publication[]> {
    return (await api.get(`/runs/${runId}/publications`)).data
  },
  /** Create or update the suite's Confluence page with this run, and attach the report. */
  async publish(runId: string): Promise<Publication> {
    return (await api.post(`/runs/${runId}/publish`)).data
  },
  async shareLinks(runId: string): Promise<ShareLink[]> {
    return (await api.get(`/runs/${runId}/share-links`)).data
  },
  async createShareLink(runId: string): Promise<ShareLink> {
    return (await api.post(`/runs/${runId}/share-links`)).data
  },
  async projectShareLinks(projectId: string): Promise<ShareLink[]> {
    return (await api.get(`/reports/projects/${projectId}/share-links`)).data
  },
  async revokeShareLink(projectId: string, linkId: number): Promise<void> {
    await api.delete(`/reports/projects/${projectId}/share-links/${linkId}`)
  },
  async deleteReport(runId: string): Promise<void> {
    await api.delete(`/runs/${runId}/report`)
  },
  /** The report as a zip (the archive attached in Confluence), saved by the browser. */
  async downloadZip(runId: string): Promise<void> {
    const response = await api.get(`/runs/${runId}/report.zip`, { responseType: 'blob' })
    const url = URL.createObjectURL(response.data as Blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `allure-report-${runId.replace('manual-', 'run-')}.zip`
    anchor.click()
    URL.revokeObjectURL(url)
  },
  async allureStatus(): Promise<AllureStatus> {
    return (await api.get('/reports/allure')).data
  },
  async installAllure(): Promise<{ path: string; log: string[]; java: boolean }> {
    return (await api.post('/reports/allure/install')).data
  },
  async setAutoPublish(suiteId: string, enabled: boolean): Promise<{ auto_publish: boolean }> {
    return (await api.put(`/suites/${suiteId}/auto-publish`, { enabled })).data
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
  publications: (runId: string) => ['reports', 'publications', runId] as const,
  shareLinks: (runId: string) => ['reports', 'share-links', runId] as const,
  projectShareLinks: (projectId: string) => ['reports', projectId, 'share-links'] as const,
  allure: ['reports', 'allure'] as const,
}
