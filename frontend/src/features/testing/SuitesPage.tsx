import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Layers, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import { hasPermission, usePermission } from '@/hooks/usePermission'
import {
  Button, Card, ConfirmDialog, EmptyState, ErrorState, IconButton, Skeleton, StatusPill, TestTypeChip, useToast,
} from '@/ui'
import type { TestSuite } from '@/types/domain'
import { describeSchedule, testingApi, testingKeys } from './api'
import RunDialog from './RunDialog'
import SuiteDialog from './SuiteDialog'

function targetLabel(target: string | null | undefined): string {
  if (!target) return 'No target yet'
  const [framework, ...rest] = target.split('|')
  const label = rest.slice(1).join('|') || rest[0] || target
  return `${framework.split('@')[0]} · ${label}`
}

/** Tests › Suites: what each suite runs, where and when, and its last result. */
export default function SuitesPage() {
  const projectId = useAppStore(s => s.selectedProjectId)
  const user = useAppStore(s => s.user)
  const canCreate = usePermission('suite.manage')
  const canRun = usePermission('run.execute')
  const toast = useToast()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<TestSuite | 'new' | null>(null)
  const [running, setRunning] = useState<TestSuite | null>(null)
  const [deleting, setDeleting] = useState<TestSuite | null>(null)

  const suites = useQuery({
    queryKey: testingKeys.suites(projectId ?? ''),
    queryFn: () => testingApi.suites(projectId!),
    enabled: Boolean(projectId),
    // Scheduled runs start in the background: keep the last results fresh.
    refetchInterval: 5000,
  })
  const environments = useQuery({
    queryKey: testingKeys.environments(projectId ?? ''),
    queryFn: () => testingApi.environments(projectId!),
    enabled: Boolean(projectId),
  })
  const remove = useMutation({
    mutationFn: (suite: TestSuite) => testingApi.deleteSuite(suite.id),
    onSuccess: (_, suite) => {
      void queryClient.invalidateQueries({ queryKey: testingKeys.suites(projectId!) })
      toast({ title: `Deleted ${suite.name}`, tone: 'success' })
      setDeleting(null)
    },
    onError: error => toast({ title: 'Not deleted', description: apiService.errorMessage(error), tone: 'danger' }),
  })

  // Automation users manage only the suites they created (seniors and leads manage all).
  const mayManage = (suite: TestSuite) => hasPermission(user, 'suite.manage')
    && (user?.role !== 'automation_user' || suite.created_by_user_id === user?.id)

  if (!projectId) return <EmptyState icon={Layers} title="Choose a project">Pick a project in the top bar.</EmptyState>

  const envName = (id: string | null | undefined) => environments.data?.find(e => e.id === id)?.name

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-fg-muted">A suite is a test type, a target in the repository, an environment and an optional schedule.</p>
        {canCreate && <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing('new')}>New suite</Button>}
      </div>

      <Card>
        {suites.isPending ? <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          : suites.isError ? <div className="p-4"><ErrorState title="Could not load the suites">{apiService.errorMessage(suites.error)}</ErrorState></div>
            : suites.data.length === 0 ? (
              <EmptyState icon={Layers} title="No suites yet">
                Create a suite for each kind of test you run: smoke, regression, API, UI, mobile or performance.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line" aria-label="Suites">
                {suites.data.map(suite => (
                  <li key={suite.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-fg">{suite.name}</span>
                        <TestTypeChip type={suite.test_type ?? 'functional'} />
                      </div>
                      <p className="mt-0.5 truncate font-mono text-xs text-fg-muted">{targetLabel(suite.target)}</p>
                    </div>
                    <span className="hidden w-28 truncate text-xs text-fg-muted md:inline">{envName(suite.environment_id) ?? 'No environment'}</span>
                    <span className="hidden items-center gap-1 text-xs text-fg-muted lg:flex">
                      <CalendarClock size={12} aria-hidden /> {describeSchedule(suite.cron_expression)}
                    </span>
                    <span className="w-28" aria-label={`Last run of ${suite.name}`}>
                      {suite.last_run ? (
                        <span className="flex items-center gap-1.5">
                          <StatusPill status={suite.last_run.status} />
                          {suite.last_run.trigger === 'schedule' && <CalendarClock size={12} className="text-fg-muted" aria-label="Scheduled" />}
                        </span>
                      ) : <span className="text-xs text-fg-muted">Never run</span>}
                    </span>
                    {canRun && (
                      <Button size="sm" icon={<Play size={13} />} disabled={!suite.target} onClick={() => setRunning(suite)}
                        aria-label={`Run ${suite.name}`}>Run</Button>
                    )}
                    {mayManage(suite) && (
                      <>
                        <IconButton size="sm" label={`Edit ${suite.name}`} icon={<Pencil size={13} />} onClick={() => setEditing(suite)} />
                        <IconButton size="sm" label={`Delete ${suite.name}`} icon={<Trash2 size={13} />} onClick={() => setDeleting(suite)} />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
      </Card>

      {editing && (
        <SuiteDialog open onOpenChange={open => { if (!open) setEditing(null) }} projectId={projectId}
          suite={editing === 'new' ? null : editing} />
      )}
      {running && <RunDialog open onOpenChange={open => { if (!open) setRunning(null) }} initialSuiteId={running.id} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={open => { if (!open) setDeleting(null) }}
        title={`Delete ${deleting?.name ?? 'suite'}?`}
        description="The suite and its runs are removed. The tests in the repository stay."
        confirmLabel="Delete suite"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  )
}
