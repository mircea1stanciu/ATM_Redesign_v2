import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiService } from '@/services/api'
import { Button, Card, ErrorState, PageHeader, Section, Skeleton, Switch, useToast } from '@/ui'
import NotificationList from './NotificationList'
import type { Subscriptions } from './api'
import { notificationKeys, notificationsApi } from './api'

function SubscriptionSettings() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const subscriptions = useQuery({ queryKey: notificationKeys.subscriptions, queryFn: notificationsApi.subscriptions })
  const save = useMutation({
    mutationFn: (next: Subscriptions) => notificationsApi.updateSubscriptions(
      next.kinds.filter(k => !k.on).map(k => k.kind), next.projects.filter(p => !p.on).map(p => p.id)),
    onSuccess: saved => queryClient.setQueryData(notificationKeys.subscriptions, saved),
    onError: error => toast({ title: 'Not saved', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  if (subscriptions.isPending) return <Skeleton className="h-40" />
  if (subscriptions.isError) return <ErrorState title="Could not load your settings">{apiService.errorMessage(subscriptions.error)}</ErrorState>
  const data = subscriptions.data
  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-medium text-fg-muted">Notify me about</legend>
        {data.kinds.map(kind => (
          <Switch key={kind.kind} label={kind.label} checked={kind.on} disabled={save.isPending}
            onChange={on => save.mutate({ ...data, kinds: data.kinds.map(k => k.kind === kind.kind ? { ...k, on } : k) })} />
        ))}
      </fieldset>
      {data.projects.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-fg-muted">From these projects</legend>
          {data.projects.map(project => (
            <Switch key={project.id} label={project.name} checked={project.on} disabled={save.isPending}
              onChange={on => save.mutate({ ...data, projects: data.projects.map(p => p.id === project.id ? { ...p, on } : p) })} />
          ))}
        </fieldset>
      )}
      <p className="text-xs text-fg-muted">
        Notifications show in ATM. A lead can also post a project's deployments and checks to a Microsoft Teams channel (Admin › Projects).
      </p>
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
