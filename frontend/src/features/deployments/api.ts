import { api } from '@/services/api'

export interface DeploymentCheck {
  id: number
  project_id: number
  project: string
  suite: string | null
  status: 'running' | 'passed' | 'failed' | 'error' | 'skipped'
  detail: string | null
  run_id: string | null
}

export interface Deployment {
  id: number
  service: { id: number; name: string; kind: 'backend' | 'frontend' }
  version: string
  environment: string
  source: string | null
  commit: string | null
  url: string | null
  notes: string | null
  deployed_at: string
  checks: DeploymentCheck[]
  check_status: DeploymentCheck['status'] | null
}

export interface DeploymentDetail extends Deployment {
  received_at: string
  delivery_id: string | null
  service_description: string | null
  notified: { name: string; project: string | null; read: boolean }[]
}

export interface ServiceProjectEntry {
  project_id: number
  project: string
  smoke_suite: { id: number; name: string } | null
  check_user: { id: number; name: string } | null
}

export interface ServiceEntry {
  id: number
  name: string
  kind: 'backend' | 'frontend'
  description: string | null
  repository_url: string | null
  main_branch: string
  check_portal_url: string | null
  projects: ServiceProjectEntry[]
  last_deployment: { id: number; version: string; environment: string; deployed_at: string } | null
}

export interface CheckOptions {
  suites: { id: number; name: string; test_type: string | null }[]
  users: { id: number; name: string }[]
}

/** The Deploys area (backend app/modules/deployments/router.py). */
export const deploymentsApi = {
  async list(environment?: string): Promise<{ items: Deployment[]; environments: string[] }> {
    return (await api.get('/deployments', { params: environment ? { environment } : {} })).data
  },
  async get(id: string): Promise<DeploymentDetail> {
    return (await api.get(`/deployments/${id}`)).data
  },
  async services(): Promise<ServiceEntry[]> {
    return (await api.get('/deployments/services')).data
  },
  /** The answer carries the webhook secret, shown once. */
  async createService(payload: {
    name: string; kind: string; description: string; repository_url?: string | null; main_branch?: string;
    check_portal_url?: string | null
  }): Promise<ServiceEntry & { secret: string }> {
    return (await api.post('/deployments/services', payload)).data
  },
  async updateService(id: number, payload: {
    name?: string; kind?: string; description?: string; repository_url?: string | null; main_branch?: string;
    check_portal_url?: string | null
  }): Promise<ServiceEntry> {
    return (await api.patch(`/deployments/services/${id}`, payload)).data
  },
  async deleteService(id: number): Promise<void> {
    await api.delete(`/deployments/services/${id}`)
  },
  async newSecret(id: number): Promise<string> {
    return (await api.post<{ secret: string }>(`/deployments/services/${id}/secret`)).data.secret
  },
  async checkOptions(projectId: number): Promise<CheckOptions> {
    return (await api.get(`/deployments/projects/${projectId}/check-options`)).data
  },
  async mapProject(serviceId: number, projectId: number, smokeSuiteId: number | null, checkUserId: number | null): Promise<ServiceEntry> {
    return (await api.put(`/deployments/services/${serviceId}/projects/${projectId}`, {
      smoke_suite_id: smokeSuiteId, check_user_id: checkUserId,
    })).data
  },
  async unmapProject(serviceId: number, projectId: number): Promise<ServiceEntry> {
    return (await api.delete(`/deployments/services/${serviceId}/projects/${projectId}`)).data
  },
}

export const deploymentKeys = {
  list: (environment: string) => ['deployments', 'list', environment] as const,
  one: (id: string) => ['deployments', 'one', id] as const,
  services: ['deployments', 'services'] as const,
  checkOptions: (projectId: number) => ['deployments', 'check-options', projectId] as const,
}

/** The backend sends naive UTC timestamps. */
export function utc(iso: string): Date {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`)
}
