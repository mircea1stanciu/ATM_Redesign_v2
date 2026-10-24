import { useQuery } from '@tanstack/react-query'
import { apiService } from '@/services/api'
import { useAppStore } from '@/store/useAppStore'
import ChangedTestsPanel from '@/components/runs/ChangedTestsPanel'
import { Drawer, ErrorState, Skeleton } from '@/ui'

/** "Run changed tests": the files changed on this branch and a run of only the matching tests. */
export default function RunChangedDrawer({ open, onOpenChange, projectId }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}) {
  const runError = useAppStore(s => s.runError)
  const detection = useQuery({
    queryKey: ['workspace', projectId, 'frameworks'],
    queryFn: () => apiService.getLocalFrameworks(projectId, true),
    enabled: open,
  })
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="Run changed tests" width="max-w-2xl">
      {detection.isPending ? <Skeleton className="h-40" /> : detection.isError ? (
        <ErrorState title="Could not detect the test frameworks">{apiService.errorMessage(detection.error)}</ErrorState>
      ) : (
        <div className="space-y-3">
          {runError && <ErrorState title="The run did not start">{runError}</ErrorState>}
          <ChangedTestsPanel projectId={projectId} detection={detection.data} />
        </div>
      )}
    </Drawer>
  )
}
