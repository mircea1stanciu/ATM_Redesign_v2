import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { Button, IconButton, Popover, Skeleton } from '@/ui'
import NotificationList from '@/features/notifications/NotificationList'
import { notificationKeys, notificationsApi } from '@/features/notifications/api'
import { useNotificationSocket } from '@/features/notifications/useNotificationSocket'

/** The bell: unread count, the latest notifications, live through the notification socket. */
export default function NotificationBell() {
  const signedIn = useAppStore(s => Boolean(s.user))
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  useNotificationSocket(signedIn)
  const latest = useQuery({
    queryKey: notificationKeys.list(15),
    queryFn: () => notificationsApi.list(15),
    enabled: signedIn,
    refetchInterval: 60_000, // the socket is the fast path; this catches up after a dropped connection
  })
  const readAll = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  })
  const unread = latest.data?.unread ?? 0
  return (
    <Popover
      align="end"
      className="w-96"
      open={open}
      onOpenChange={setOpen}
      trigger={(
        <IconButton
          label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          icon={(
            <span className="relative inline-flex">
              <Bell size={18} />
              {unread > 0 && (
                <span aria-hidden className="absolute -right-2 -top-2 min-w-[16px] rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-4 text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </span>
          )}
        />
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-fg">Notifications</h2>
        {unread > 0 && <Button size="sm" variant="ghost" loading={readAll.isPending} onClick={() => readAll.mutate()}>Mark all read</Button>}
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {latest.isPending ? <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          : <NotificationList items={latest.data?.items ?? []} onOpen={() => setOpen(false)} />}
      </div>
      <div className="border-t border-line px-4 py-2 text-right">
        <Link to="/notifications" onClick={() => setOpen(false)} className="text-xs font-semibold text-accent hover:underline">
          All notifications and settings
        </Link>
      </div>
    </Popover>
  )
}
