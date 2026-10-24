import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import { usePermission } from '@/hooks/usePermission'
import ChangedTestsPanel from '@/components/runs/ChangedTestsPanel'
import { Button, Dialog, ErrorState, Select, Skeleton, useToast } from '@/ui'
import { testingApi, testingKeys } from './api'

type What = 'suite' | 'changed' | 'file'

/**
 * The run dialog: what to run (a suite, the changed tests, or one file), where (an environment; here or on GitHub
 * Actions), then start. The run opens in Tests › Runs.
 */
export default function RunDialog({ open, onOpenChange, initialSuiteId }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSuiteId?: string
}) {
  const projectId = useAppStore(s => s.selectedProjectId) ?? ''
  const refreshProjectData = useAppStore(s => s.refreshProjectData)
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const canRunCi = usePermission('run.execute.ci')
  const [what, setWhat] = useState<What>('suite')
  const [suiteId, setSuiteId] = useState(initialSuiteId ?? '')
  const [target, setTarget] = useState('')
  const [environmentId, setEnvironmentId] = useState<string | null>(null)
  const [where, setWhere] = useState<'local' | 'actions'>('local')

  const suites = useQuery({ queryKey: testingKeys.suites(projectId), queryFn: () => testingApi.suites(projectId), enabled: open })
  const environments = useQuery({
    queryKey: testingKeys.environments(projectId), queryFn: () => testingApi.environments(projectId), enabled: open,
  })
  const detection = useQuery({
    queryKey: testingKeys.frameworks(projectId),
    queryFn: () => apiService.getLocalFrameworks(projectId, true),
    enabled: open && what !== 'suite',
    retry: false,
  })

  const suite = suites.data?.find(s => s.id === suiteId)
  // The suite's own environment unless another one is chosen here.
  const chosenEnvironment = environmentId ?? suite?.environment_id ?? ''

  const openRun = async (runId: string) => {
    await refreshProjectData(projectId)
    useAppStore.getState().setSelectedRunId(runId)
    void queryClient.invalidateQueries({ queryKey: testingKeys.suites(projectId) })
    onOpenChange(false)
    navigate('/tests/runs')
  }

  const start = useMutation({
    mutationFn: async () => {
      const environment = chosenEnvironment ? Number(chosenEnvironment) : null
      if (what === 'suite') {
        return testingApi.runSuite(suiteId, { environment_id: environment, where })
      }
      const fileSuite = await apiService.defaultSuite(projectId)
      const label = detection.data?.frameworks.flatMap(fw => fw.targets).find(t => t.id === target)?.label ?? target
      const run = await apiService.createRun({ suite_id: fileSuite.id, collection: label })
      await apiService.executeRun(run.id, {
        run_type: 'framework', framework_target: target, ...(environment ? { environment_id: environment } : {}),
      })
      return { where: 'local' as const, run }
    },
    onSuccess: async result => {
      if (result.where === 'actions') {
        toast({
          title: `Started ${suite?.name} on GitHub Actions`, tone: 'success',
          action: { label: 'Open on GitHub', onClick: () => window.open(result.actions_url, '_blank', 'noopener') },
        })
        onOpenChange(false)
        return
      }
      toast({ title: `Started ${what === 'suite' ? suite?.name : 'the run'}`, tone: 'success' })
      await openRun(result.run.id)
    },
  })

  const ready = what === 'suite' ? Boolean(suite?.target) && (where === 'local' || Boolean(suite?.ci_workflow)) : what === 'file' && Boolean(target)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Run tests"
      className="max-w-xl"
      footer={what === 'changed' ? <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button> : (
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" icon={<Play size={14} />} loading={start.isPending} disabled={!ready} onClick={() => start.mutate()}>
            Start
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <WhatTabs what={what} onChange={setWhat} />
        {what === 'suite' && (
          suites.isPending ? <Skeleton className="h-10" /> : (
            <Select label="Suite" value={suiteId} onChange={e => { setSuiteId(e.target.value); setEnvironmentId(null) }}>
              <option value="">Choose a suite…</option>
              {(suites.data ?? []).map(s => <option key={s.id} value={s.id} disabled={!s.target}>{s.name}{s.target ? '' : ' (no target)'}</option>)}
            </Select>
          )
        )}
        {what === 'file' && (
          detection.isPending ? <Skeleton className="h-10" /> : detection.isError ? (
            <ErrorState title="Could not detect the test frameworks">{apiService.errorMessage(detection.error)}</ErrorState>
          ) : (
            <Select label="Test file or target" value={target} onChange={e => setTarget(e.target.value)}>
              <option value="">Choose…</option>
              {(detection.data?.frameworks ?? []).map(fw => (
                <optgroup key={fw.id} label={fw.name}>
                  {fw.targets.filter(t => t.group !== 'Setup').map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </optgroup>
              ))}
            </Select>
          )
        )}
        <Select label="Environment" value={chosenEnvironment} onChange={e => setEnvironmentId(e.target.value)}>
          <option value="">None</option>
          {(environments.data ?? []).map(env => <option key={env.id} value={env.id}>{env.name}</option>)}
        </Select>
        {what === 'changed' ? (
          detection.isPending ? <Skeleton className="h-24" /> : detection.data
            ? <ChangedTestsPanel projectId={projectId} detection={detection.data} environmentId={chosenEnvironment ? Number(chosenEnvironment) : null} />
            : <ErrorState title="Could not detect the test frameworks">{apiService.errorMessage(detection.error)}</ErrorState>
        ) : (
          <>
            {what === 'suite' && (
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-xs font-medium text-fg-muted">Where</legend>
                <label className="flex items-center gap-2 text-[13px] text-fg">
                  <input type="radio" name="where" checked={where === 'local'} onChange={() => setWhere('local')} /> On this station (your checkout)
                </label>
                <label className={`flex items-center gap-2 text-[13px] ${suite?.ci_workflow && canRunCi ? 'text-fg' : 'text-fg-muted'}`}>
                  <input type="radio" name="where" checked={where === 'actions'} disabled={!suite?.ci_workflow || !canRunCi}
                    onChange={() => setWhere('actions')} />
                  On GitHub Actions{suite?.ci_workflow ? ` (${suite.ci_workflow})` : ' (the suite has no workflow)'}
                </label>
              </fieldset>
            )}
          </>
        )}
        {start.isError && <ErrorState title="The run did not start">{apiService.errorMessage(start.error)}</ErrorState>}
      </div>
    </Dialog>
  )
}

function WhatTabs({ what, onChange }: { what: What; onChange: (what: What) => void }) {
  // Local state, not the URL: the dialog sits on top of other screens.
  const items: Array<{ id: What; label: string }> = [
    { id: 'suite', label: 'A suite' }, { id: 'changed', label: 'Changed tests' }, { id: 'file', label: 'One file' },
  ]
  return (
    <div role="tablist" aria-label="What to run" className="flex gap-1 border-b border-line">
      {items.map(item => (
        <button key={item.id} type="button" role="tab" aria-selected={what === item.id} onClick={() => onChange(item.id)}
          className={`border-b-2 px-3 py-2 text-[13px] font-medium ${what === item.id ? 'border-accent text-accent' : 'border-transparent text-fg-muted hover:text-fg'}`}>
          {item.label}
        </button>
      ))}
    </div>
  )
}
