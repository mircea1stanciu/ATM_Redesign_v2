import { api } from '@/services/api'

export type NotificationKind = 'deployment' | 'deployment_check' | 'run_finished' | 'review_request' | 'review' | 'practice' | 'readiness' | 'promotion'

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
  /** on: in ATM; email and teams: also sent there (phase 20). */
  kinds: { kind: NotificationKind; label: string; on: boolean; email: boolean; teams: boolean }[]
  projects: { id: number; name: string; on: boolean }[]
  channels: { email_available: boolean; email: string; teams_webhook_set: boolean }
}

export type MailSecurity = 'starttls' | 'ssl' | 'none'

export type MailServer = { configured: false } | {
  configured: true
  host: string
  port: number
  security: MailSecurity
  username: string | null
  password_set: boolean
  sender: string
  updated_at: string
}

export interface MailServerUpdate {
  host: string
  port: number
  security: MailSecurity
  username: string | null
  /** null keeps the saved password; '' removes it. */
  password: string | null
  sender: string
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
  async updateSubscriptions(next: Subscriptions): Promise<Subscriptions> {
    return (await api.put('/notifications/subscriptions', {
      muted_kinds: next.kinds.filter(k => !k.on).map(k => k.kind),
      muted_project_ids: next.projects.filter(p => !p.on).map(p => p.id),
      email_kinds: next.kinds.filter(k => k.email).map(k => k.kind),
      teams_kinds: next.kinds.filter(k => k.teams).map(k => k.kind),
    })).data
  },
  async setTeamsWebhook(url: string | null): Promise<Subscriptions> {
    return (await api.put('/notifications/teams-webhook', { url })).data
  },
  async testTeamsWebhook(): Promise<void> {
    await api.post('/notifications/teams-webhook/test')
  },
  async mailServer(): Promise<MailServer> {
    return (await api.get('/admin/mail-server')).data
  },
  async saveMailServer(server: MailServerUpdate): Promise<MailServer> {
    return (await api.put('/admin/mail-server', server)).data
  },
  async removeMailServer(): Promise<MailServer> {
    return (await api.delete('/admin/mail-server')).data
  },
  async testMailServer(): Promise<{ sent_to: string }> {
    return (await api.post('/admin/mail-server/test')).data
  },
}

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (limit: number) => ['notifications', 'list', limit] as const,
  subscriptions: ['notifications', 'subscriptions'] as const,
  mailServer: ['notifications', 'mail-server'] as const,
}

export function isExternal(link: string): boolean {
  return /^https?:\/\//.test(link)
}
