import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiService } from '@/services/api'
import { Button, Dialog, ErrorState, Input, Select, Skeleton, useToast } from '@/ui'
import { TEST_TYPES } from '@/types/domain'
import type { TestSuite, TestType } from '@/types/domain'
import { SCHEDULE_PRESETS, testingApi, testingKeys } from './api'

const TYPE_LABELS: Record<TestType, string> = {
  functional: 'Functional', regression: 'Regression', smoke: 'Smoke', api: 'API', ui: 'UI', mobile: 'Mobile',
  performance: 'Performance',
}

/** Create or edit a suite: name, test type, what it runs (a target detected in the checkout), environment, schedule. */
export default function SuiteDialog({ open, onOpenChange, projectId, suite }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  suite: TestSuite | null
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [name, setName] = useState(suite?.name ?? '')
  const [testType, setTestType] = useState<TestType>(suite?.test_type ?? 'functional')
  const [target, setTarget] = useState(suite?.target ?? '')
  const [environmentId, setEnvironmentId] = useState(suite?.environment_id ?? '')
  const presetOf = (cron: string | null | undefined) => !cron ? '' : SCHEDULE_PRESETS.some(p => p.cron === cron) ? cron : 'custom'
  const [schedule, setSchedule] = useState(presetOf(suite?.cron_expression))
  const [customCron, setCustomCron] = useState(presetOf(suite?.cron_expression) === 'custom' ? suite?.cron_expression ?? '' : '')
  const [workflow, setWorkflow] = useState(suite?.ci_workflow ?? '')

  const detection = useQuery({
    queryKey: testingKeys.frameworks(projectId),
    queryFn: () => apiService.getLocalFrameworks(projectId, true),
    enabled: open,
    retry: false,
  })
  const environments = useQuery({
    queryKey: testingKeys.environments(projectId),
    queryFn: () => testingApi.environments(projectId),
    enabled: open,
  })

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        test_type: testType,
        target: target || null,
        environment_id: environmentId ? Number(environmentId) : null,
        cron_expression: schedule === 'custom' ? customCron.trim() || null : schedule || null,
        ci_workflow: workflow.trim() || null,
      }
      return suite ? testingApi.updateSuite(suite.id, payload) : testingApi.createSuite(projectId, payload)
    },
    onSuccess: saved => {
      void queryClient.invalidateQueries({ queryKey: testingKeys.suites(projectId) })
      toast({ title: `Saved ${saved.name}`, tone: 'success' })
      onOpenChange(false)
    },
  })

  const frameworks = (detection.data?.frameworks ?? []).filter(fw => fw.targets.some(t => t.group !== 'Setup'))

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={suite ? `Edit ${suite.name}` : 'New suite'}
      className="max-w-lg"
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
            {suite ? 'Save' : 'Create suite'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Input label="Name" value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="Login smoke tests" />
        <Select label="Test type" value={testType} onChange={e => setTestType(e.target.value as TestType)}>
          {TEST_TYPES.map(type => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
        </Select>
        {detection.isPending ? <Skeleton className="h-16" /> : detection.isError ? (
          <ErrorState title="Could not detect the test frameworks">
            {apiService.errorMessage(detection.error)} Link a local checkout in Work › Workspace first.
          </ErrorState>
        ) : (
          <Select label="What it runs" value={target} onChange={e => setTarget(e.target.value)}
            help="Detected in your checkout. Missing runners are listed in Tests › Project.">
            <option value="">Choose a target…</option>
            {frameworks.map(fw => (
              <optgroup key={fw.id} label={`${fw.name}${fw.root !== '.' ? ` (${fw.root})` : ''}`}>
                {fw.targets.filter(t => t.group !== 'Setup').map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </optgroup>
            ))}
          </Select>
        )}
        <Select label="Environment" value={environmentId} onChange={e => setEnvironmentId(e.target.value)}
          help="Its variables (BASE_URL, …) are handed to the runner.">
          <option value="">None</option>
          {(environments.data ?? []).map(env => <option key={env.id} value={env.id}>{env.name}</option>)}
        </Select>
        <Select label="Schedule" value={schedule} onChange={e => setSchedule(e.target.value)}
          help="Runs on this station, as you, in your checkout.">
          <option value="">Not scheduled</option>
          {SCHEDULE_PRESETS.map(p => <option key={p.cron} value={p.cron}>{p.label}</option>)}
          <option value="custom">Custom (cron)…</option>
        </Select>
        {schedule === 'custom' && (
          <Input label="Cron expression" value={customCron} onChange={e => setCustomCron(e.target.value)} className="font-mono"
            placeholder="*/30 6-18 * * 1-5" help="minute hour day-of-month month day-of-week" />
        )}
        <Input label="GitHub Actions workflow (optional)" value={workflow} onChange={e => setWorkflow(e.target.value)}
          className="font-mono" placeholder="tests.yml" help="Lets the suite run on GitHub Actions too." />
        {save.isError && <ErrorState title="Not saved">{apiService.errorMessage(save.error)}</ErrorState>}
      </div>
    </Dialog>
  )
}
