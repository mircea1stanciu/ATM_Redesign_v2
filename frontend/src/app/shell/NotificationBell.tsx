import { Bell } from 'lucide-react'
import { EmptyState, IconButton, Popover } from '@/ui'

/** The notification panel. UI only for now: phase 11 sends notifications. */
export default function NotificationBell() {
  return (
    <Popover
      align="end"
      className="w-80"
      trigger={<IconButton label="Notifications" icon={<Bell size={18} />} />}
    >
      <div className="border-b border-line px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-fg">Notifications</h2>
      </div>
      <EmptyState icon={Bell} title="No notifications yet">
        Finished runs, review requests, deployments and promotions will show here.
      </EmptyState>
    </Popover>
  )
}
