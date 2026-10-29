import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Award, Bell, CheckCircle2, GitPullRequest, GraduationCap, MessageSquare, MessagesSquare, Play, Rocket, UserCheck, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn, EmptyState } from '@/ui'
import type { AppNotification, NotificationKind } from './api'
import { isExternal, notificationKeys, notificationsApi } from './api'

const ICONS: Record<NotificationKind, LucideIcon> = {
  deployment: Rocket,
  deployment_check: CheckCircle2,
  repository_merge: GitPullRequest,
  run_finished: Play,
  review_request: GitPullRequest,
  review: MessageSquare,
  practice: GraduationCap,
  readiness: Award,
  promotion: UserCheck,
  mentoring: Users,
  community: MessagesSquare,
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(`${iso}Z`).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
  return new Date(`${iso}Z`).toLocaleDateString()
}

/** Notifications, newest first. Opening one marks it read and goes to its link. */
export default function NotificationList({ items, onOpen }: { items: AppNotification[]; onOpen?: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const markRead = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  })
  if (items.length === 0) {
    return (
      <EmptyState icon={Bell} title="No notifications yet">
        Finished runs, review requests, deployments and promotions will show here.
      </EmptyState>
    )
  }
  const open = (notification: AppNotification) => {
    if (!notification.read) markRead.mutate(notification.id)
    onOpen?.()
    if (!notification.link) return
    if (isExternal(notification.link)) window.open(notification.link, '_blank', 'noopener,noreferrer')
    else navigate(notification.link)
  }
  return (
    <ul className="divide-y divide-line" aria-label="Notifications">
      {items.map(notification => {
        const Icon = ICONS[notification.kind] ?? Bell
        return (
          <li key={notification.id}>
            <button type="button" onClick={() => open(notification)}
              className={cn('flex w-full gap-3 px-4 py-2.5 text-left hover:bg-surface-2', !notification.read && 'bg-accent/5')}>
              <Icon size={16} className={cn('mt-0.5 shrink-0', notification.read ? 'text-fg-muted' : 'text-accent')} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className={cn('block text-[13px] text-fg', !notification.read && 'font-semibold')}>{notification.title}</span>
                {notification.body && <span className="block truncate text-xs text-fg-muted">{notification.body}</span>}
                <span className="block text-[11px] text-fg-muted">
                  {timeAgo(notification.created_at)}{notification.read ? '' : ' · unread'}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
