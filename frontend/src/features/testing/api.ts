import { api } from '@/services/api'
import type { TestEnvironment, TestRun, TestSuite, TestType } from '@/types/domain'

export interface SuitePayload {
  name?: string
  test_type?: TestType
  target?: string | null
  environment_id?: number | null
  cron_expression?: string | null
  ci_workflow?: string | null
  active?: boolean
}

export interface EnvironmentPayload {
  name: string
  variables: Record<string, string>
  bruno_environment?: string | null
}

/** Suites, environments and suite runs (backend app/modules/testing/suites_router.py). */
export const testingApi = {
  async suites(projectId: string): Promise<TestSuite[]> {
    const suites = (await api.get<TestSuite[]>(`/suites/projects/${projectId}`)).data
    return suites.filter(suite => !suite.id.startsWith('allure-suite-'))
  },
  async createSuite(projectId: string, payload: SuitePayload & { name: string }): Promise<TestSuite> {
    return (await api.post(`/suites/projects/${projectId}/suites`, payload)).data
  },
  async updateSuite(suiteId: string, payload: SuitePayload): Promise<TestSuite> {
    return (await api.patch(`/suites/${suiteId}`, payload)).data
  },
  async deleteSuite(suiteId: string): Promise<{ deleted_runs: number }> {
    return (await api.delete(`/suites/${suiteId}`)).data
  },
  async runSuite(suiteId: string, payload: { environment_id?: number | null; where: 'local' | 'actions'; branch?: string }):
    Promise<{ where: 'local'; run: TestRun } | { where: 'actions'; actions_url: string }> {
    return (await api.post(`/suites/${suiteId}/runs`, payload)).data
  },
  async environments(projectId: string): Promise<TestEnvironment[]> {
    return (await api.get(`/projects/${projectId}/environments`)).data
  },
  async createEnvironment(projectId: string, payload: EnvironmentPayload): Promise<TestEnvironment> {
    return (await api.post(`/projects/${projectId}/environments`, payload)).data
  },
  async updateEnvironment(projectId: string, environmentId: string, payload: EnvironmentPayload): Promise<TestEnvironment> {
    return (await api.put(`/projects/${projectId}/environments/${environmentId}`, payload)).data
  },
  async deleteEnvironment(projectId: string, environmentId: string): Promise<void> {
    await api.delete(`/projects/${projectId}/environments/${environmentId}`)
  },
}

export const testingKeys = {
  suites: (projectId: string) => ['testing', projectId, 'suites'] as const,
  environments: (projectId: string) => ['testing', projectId, 'environments'] as const,
  frameworks: (projectId: string) => ['workspace', projectId, 'frameworks'] as const,
}

/** "0 6 * * 1-5" → "Weekdays at 06:00"; other expressions are shown as they are. */
export function describeSchedule(expression: string | null | undefined): string {
  if (!expression) return 'Not scheduled'
  const preset = SCHEDULE_PRESETS.find(p => p.cron === expression)
  return preset ? preset.label : expression
}

export const SCHEDULE_PRESETS = [
  { cron: '0 * * * *', label: 'Every hour' },
  { cron: '0 2 * * *', label: 'Every night at 02:00' },
  { cron: '0 6 * * 1-5', label: 'Weekdays at 06:00' },
  { cron: '0 6 * * 1', label: 'Mondays at 06:00' },
]
