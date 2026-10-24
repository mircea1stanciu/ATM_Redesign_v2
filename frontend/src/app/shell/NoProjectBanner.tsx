import { Info } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { hasPermission } from '@/hooks/usePermission'

/** Phase 15: someone without any project (a new self-registered Viewer, for example) learns how to get access. */
export default function NoProjectBanner() {
  const user = useAppStore(s => s.user)
  const projects = useAppStore(s => s.projects)
  if (!user || projects.length > 0 || hasPermission(user, 'project.create')) return null
  return (
    <div role="status" className="flex items-start gap-2 border-b border-info/30 bg-info/10 px-4 py-2 text-[13px] text-fg">
      <Info size={16} className="mt-0.5 shrink-0 text-info" aria-hidden />
      <p>
        <span className="font-semibold">You don't have access to any project yet.</span>{' '}
        Ask your Automation Lead or a Super Admin to add you to the projects you work on.
      </p>
    </div>
  )
}
