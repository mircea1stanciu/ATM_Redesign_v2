import { api } from '@/services/api'

export type NotificationKind = 'deployment' | 'deployment_check' | 'run_finished' | 'review_request' | 'review' | 'practice' | 'promotion'

export interface AppNotification {
  id: number
  kind: NotificationKind
  title: string
  body: string | null
  /** An ATM path (/deployments/3) or an external URL (a pull request on GitHub). */
  link: string | null
  project_id: number | null
  deployment_id: number | null
  read: boolean
  created_at: string
}

export interface Subscriptions {
  kinds: { kind: NotificationKind; label: string; on: boolean }[]
  projects: { id: number; name: string; on: boolean }[]
}

/** The notification centre (backend app/modules/notifications/router.py). */
export const notificationsApi = {
  async list(limit = 30): Promise<{ items: AppNotification[]; unread: number }> {
    return (await api.get('/notifications', { params: { limit } })).data
  },
  async markRead(id: number): Promise<{ unread: number }> {
    return (await api.post(`/notifications/${id}/read`)).data
  },
  async markAllRead(): Promise<{ unread: number }> {
    return (await api.post('/notifications/read-all')).data
  },
  async subscriptions(): Promise<Subscriptions> {
    return (await api.get('/notifications/subscriptions')).data
  },
  async updateSubscriptions(mutedKinds: string[], mutedProjectIds: number[]): Promise<Subscriptions> {
    return (await api.put('/notifications/subscriptions', { muted_kinds: mutedKinds, muted_project_ids: mutedProjectIds })).data
  },
}

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (limit: number) => ['notifications', 'list', limit] as const,
  subscriptions: ['notifications', 'subscriptions'] as const,
}

export function isExternal(link: string): boolean {
  return /^https?:\/\//.test(link)
}
