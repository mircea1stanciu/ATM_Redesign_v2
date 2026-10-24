import type { ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { visibleTabs } from '@/app/navigation'
import { PageHeader, Tabs } from '@/ui'

/** An area: title, URL-driven tabs and the selected tab's screen. */
export default function AreaLayout({ areaId, title, description, actions }: {
  areaId: string
  title: string
  description: string
  actions?: ReactNode
}) {
  const user = useAppStore(s => s.user)
  const tabs = visibleTabs(user, areaId)
  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <PageHeader title={title} description={description} actions={actions}>
        {tabs.length > 1 && <Tabs label={`${title} sections`} items={tabs} />}
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col pt-4">
        <Outlet />
      </div>
    </div>
  )
}
