import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, CalendarClock, Layers, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import { hasPermission, usePermission } from '@/hooks/usePermission'
import {
  Button, Card, ConfirmDialog, EmptyState, ErrorState, IconButton, Skeleton, StatusPill, Tabs, TestTypeChip, useTabParam, useToast,
} from '@/ui'
import type { TestSuite } from '@/types/domain'
import { describeSchedule, testingApi, testingKeys } from './api'
import { reportsApi } from '@/features/reports/api'
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
  const [archiving, setArchiving] = useState<TestSuite | null>(null)
  const [deleting, setDeleting] = useState<TestSuite | null>(null)
  const show = useTabParam('show', ['active', 'archived'] as const)
  const canDelete = usePermission('suite.delete')
  const canPublish = usePermission('report.publish')

  const suites = useQuery({
    queryKey: show === 'archived' ? testingKeys.archivedSuites(projectId ?? '') : testingKeys.suites(projectId ?? ''),
    queryFn: () => testingApi.suites(projectId!, show === 'archived'),
    enabled: Boolean(projectId),
    // Scheduled runs start in the background: keep the last results fresh.
    refetchInterval: show === 'archived' ? false : 5000,
  })
  const environments = useQuery({
    queryKey: testingKeys.environments(projectId ?? ''),
    queryFn: () => testingApi.environments(projectId!),
    enabled: Boolean(projectId),
  })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: testingKeys.suites(projectId!) })
  const archive = useMutation({
    mutationFn: (suite: TestSuite) => testingApi.archiveSuite(suite.id),
    onSuccess: (_, suite) => { refresh(); toast({ title: `Archived ${suite.name}`, tone: 'success' }); setArchiving(null) },
    onError: error => toast({ title: 'Not archived', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  const restore = useMutation({
    mutationFn: (suite: TestSuite) => testingApi.restoreSuite(suite.id),
    onSuccess: (_, suite) => { refresh(); toast({ title: `Restored ${suite.name}`, tone: 'success' }) },
    onError: error => toast({ title: 'Not restored', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  const autoPublish = useMutation({
    mutationFn: ({ suite, enabled }: { suite: TestSuite; enabled: boolean }) => reportsApi.setAutoPublish(suite.id, enabled),
    onSuccess: (_, { suite, enabled }) => {
      refresh()
      toast({ title: enabled ? `${suite.name}: every run is published to Confluence` : `${suite.name}: automatic publishing off`, tone: 'success' })
    },
    onError: (error, { suite }) => {
      setAutoPublishShown(shown => { const next = { ...shown }; delete next[suite.id]; return next })
      toast({ title: 'Not changed', description: apiService.errorMessage(error), tone: 'danger' })
    },
  })
  // The switch moves at once (before the server answers); it moves back if the server refuses.
  const [autoPublishShown, setAutoPublishShown] = useState<Record<string, boolean>>({})
  const remove = useMutation({
    mutationFn: (suite: TestSuite) => testingApi.deleteSuite(suite.id),
    onSuccess: (_, suite) => { refresh(); toast({ title: `Deleted ${suite.name} permanently`, tone: 'success' }); setDeleting(null) },
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
      <Tabs param="show" label="Suites shown" items={[{ to: 'active', label: 'Active' }, { to: 'archived', label: 'Archived' }]} />

      <Card>
        {suites.isPending ? <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          : suites.isError ? <div className="p-4"><ErrorState title="Could not load the suites">{apiService.errorMessage(suites.error)}</ErrorState></div>
            : suites.data.length === 0 ? (show === 'archived'
              ? <EmptyState icon={Archive} title="No archived suites">Archived suites keep their runs and reports and can be restored.</EmptyState>
              : (
                <EmptyState icon={Layers} title="No suites yet">
                  Create a suite for each kind of test you run: smoke, regression, API, UI, mobile or performance.
                </EmptyState>
              )
            ) : show === 'archived' ? (
              <ul className="divide-y divide-line" aria-label="Archived suites">
                {suites.data.map(suite => (
                  <li key={suite.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold text-fg">{suite.name}</span>
                      <p className="text-xs text-fg-muted">Archived {suite.archived_at ? new Date(`${suite.archived_at}Z`).toLocaleString() : ''}</p>
                    </div>
                    {mayManage(suite) && (
                      <Button size="sm" icon={<ArchiveRestore size={13} />} loading={restore.isPending && restore.variables?.id === suite.id}
                        onClick={() => restore.mutate(suite)} aria-label={`Restore ${suite.name}`}>Restore</Button>
                    )}
                    {canDelete && (
                      <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={() => setDeleting(suite)}
                        aria-label={`Delete ${suite.name} permanently`}>Delete permanently</Button>
                    )}
                  </li>
                ))}
              </ul>
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
                    {canPublish && (
                      <label className="hidden items-center gap-1.5 text-xs text-fg-muted xl:flex" title={suite.auto_publish_by ? `Switched on by ${suite.auto_publish_by}` : undefined}>
                        <input type="checkbox" checked={autoPublishShown[suite.id] ?? Boolean(suite.auto_publish)}
                          aria-label={`Publish ${suite.name} to Confluence automatically`}
                          onChange={e => {
                            const enabled = e.target.checked
                            setAutoPublishShown(shown => ({ ...shown, [suite.id]: enabled }))
                            autoPublish.mutate({ suite, enabled })
                          }} />
                        Auto-publish
                      </label>
                    )}
                    {canRun && (
                      <Button size="sm" icon={<Play size={13} />} disabled={!suite.target} onClick={() => setRunning(suite)}
                        aria-label={`Run ${suite.name}`}>Run</Button>
                    )}
                    {mayManage(suite) && (
                      <>
                        <IconButton size="sm" label={`Edit ${suite.name}`} icon={<Pencil size={13} />} onClick={() => setEditing(suite)} />
                        <IconButton size="sm" label={`Archive ${suite.name}`} icon={<Archive size={13} />} onClick={() => setArchiving(suite)} />
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
        open={archiving !== null}
        onOpenChange={open => { if (!open) setArchiving(null) }}
        title={`Archive ${archiving?.name ?? 'suite'}?`}
        description="Its runs and reports stay. It leaves this list and its schedule stops; you can restore it from Archived."
        confirmLabel="Archive suite"
        loading={archive.isPending}
        onConfirm={() => archiving && archive.mutate(archiving)}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={open => { if (!open) setDeleting(null) }}
        title={`Delete ${deleting?.name ?? 'suite'} permanently?`}
        description="The suite and all its runs and reports are removed for good. The tests in the repository stay."
        confirmLabel="Delete permanently"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  )
}
