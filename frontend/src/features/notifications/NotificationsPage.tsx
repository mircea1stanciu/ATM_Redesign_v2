import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiService } from '@/services/api'
import { Button, Card, Checkbox, ErrorState, Input, PageHeader, Section, Skeleton, Switch, useToast } from '@/ui'
import NotificationList from './NotificationList'
import type { Subscriptions } from './api'
import { notificationKeys, notificationsApi } from './api'

function TeamsWebhook({ set }: { set: boolean }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [url, setUrl] = useState('')
  const saved = (data: Subscriptions) => queryClient.setQueryData(notificationKeys.subscriptions, data)
  const save = useMutation({
    mutationFn: (value: string | null) => notificationsApi.setTeamsWebhook(value),
    onSuccess: (data, value) => { saved(data); setUrl(''); toast({ title: value ? 'Teams webhook saved' : 'Teams webhook removed', tone: 'success' }) },
    onError: error => toast({ title: 'Not saved', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  const test = useMutation({
    mutationFn: notificationsApi.testTeamsWebhook,
    onSuccess: () => toast({ title: 'Test message sent to Teams', tone: 'success' }),
    onError: error => toast({ title: 'Teams did not get it', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  return (
    <div className="space-y-2 border-t border-line pt-4">
      <Input label="My Teams workflow webhook" type="url" value={url} onChange={e => setUrl(e.target.value)}
        placeholder={set ? 'Saved. Paste a new URL to replace it' : 'https://…'}
        help="In Teams: Workflows › “Send webhook alerts to a chat”, pick your chat with Workflows, and paste the URL it gives you." />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" loading={save.isPending && save.variables !== null} disabled={!url.trim()} onClick={() => save.mutate(url.trim())}>Save webhook</Button>
        {set && <Button size="sm" loading={test.isPending} onClick={() => test.mutate()}>Send a test</Button>}
        {set && <Button size="sm" variant="ghost" loading={save.isPending && save.variables === null} onClick={() => save.mutate(null)}>Remove</Button>}
      </div>
    </div>
  )
}

function SubscriptionSettings() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const subscriptions = useQuery({ queryKey: notificationKeys.subscriptions, queryFn: notificationsApi.subscriptions })
  // What was just chosen shows at once; the server's answer replaces it.
  const [shown, setShown] = useState<Subscriptions | null>(null)
  const save = useMutation({
    mutationFn: (next: Subscriptions) => notificationsApi.updateSubscriptions(next),
    onSuccess: saved => { queryClient.setQueryData(notificationKeys.subscriptions, saved); setShown(null) },
    onError: error => { setShown(null); toast({ title: 'Not saved', description: apiService.errorMessage(error), tone: 'danger' }) },
  })
  if (subscriptions.isPending) return <Skeleton className="h-40" />
  if (subscriptions.isError) return <ErrorState title="Could not load your settings">{apiService.errorMessage(subscriptions.error)}</ErrorState>
  const data = shown ?? subscriptions.data
  const change = (next: Subscriptions) => { setShown(next); save.mutate(next) }
  const setKind = (kind: string, field: 'on' | 'email' | 'teams', value: boolean) =>
    change({ ...data, kinds: data.kinds.map(k => k.kind === kind ? { ...k, [field]: value } : k) })
  const { channels } = data
  return (
    <div className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-medium text-fg-muted">Notify me about</legend>
        {data.kinds.map(kind => (
          <div key={kind.kind} className="space-y-1">
            <Switch label={kind.label} checked={kind.on} onChange={on => setKind(kind.kind, 'on', on)} />
            <div className="flex gap-4 pl-1 text-xs">
              <Checkbox label="E-mail" aria-label={`${kind.label}: by e-mail`} checked={kind.email} disabled={!channels.email_available && !kind.email}
                onChange={e => setKind(kind.kind, 'email', e.target.checked)} />
              <Checkbox label="Teams" aria-label={`${kind.label}: in Teams`} checked={kind.teams} disabled={!channels.teams_webhook_set && !kind.teams}
                onChange={e => setKind(kind.kind, 'teams', e.target.checked)} />
            </div>
          </div>
        ))}
      </fieldset>
      {data.projects.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-fg-muted">From these projects</legend>
          {data.projects.map(project => (
            <Switch key={project.id} label={project.name} checked={project.on}
              onChange={on => change({ ...data, projects: data.projects.map(p => p.id === project.id ? { ...p, on } : p) })} />
          ))}
        </fieldset>
      )}
      <p className="text-xs text-fg-muted">
        {channels.email_available ? <>E-mails go to {channels.email}.</> : <>E-mail is off until a Super Admin sets up the mail server (Admin › E-mail).</>}
        {' '}Teams messages go to the chat of your own Teams workflow webhook.
        {' '}A lead can also post a project's deployments and checks to a Teams channel (Admin › Projects).
      </p>
      <TeamsWebhook set={channels.teams_webhook_set} />
    </div>
  )
}

/** /notifications: every notification of the signed-in user, and what they want to be notified about. */
export default function NotificationsPage() {
  const queryClient = useQueryClient()
  const all = useQuery({ queryKey: notificationKeys.list(200), queryFn: () => notificationsApi.list(200) })
  const readAll = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  })
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Notifications" description="Deployments, checks, finished runs, review requests and role changes."
        actions={(all.data?.unread ?? 0) > 0 && <Button loading={readAll.isPending} onClick={() => readAll.mutate()}>Mark all read</Button>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          {all.isPending ? <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
            : all.isError ? <div className="p-4"><ErrorState title="Could not load your notifications">{apiService.errorMessage(all.error)}</ErrorState></div>
              : <NotificationList items={all.data.items} />}
        </Card>
        <Section title="Settings">
          <Card className="p-4"><SubscriptionSettings /></Card>
        </Section>
      </div>
    </div>
  )
}
