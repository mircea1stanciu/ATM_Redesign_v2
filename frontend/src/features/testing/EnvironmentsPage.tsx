import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import { usePermission } from '@/hooks/usePermission'
import {
  Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, IconButton, Input, Skeleton, useToast,
} from '@/ui'
import type { TestEnvironment } from '@/types/domain'
import { testingApi, testingKeys } from './api'

type Row = { key: string; value: string }

function EnvironmentDialog({ open, onOpenChange, projectId, environment }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  environment: TestEnvironment | null
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [name, setName] = useState(environment?.name ?? '')
  const [bruno, setBruno] = useState(environment?.bruno_environment ?? '')
  const [rows, setRows] = useState<Row[]>(() => {
    const entries = Object.entries(environment?.variables ?? { BASE_URL: '' })
    return entries.map(([key, value]) => ({ key, value }))
  })
  // Secrets (phase 17): saved values are never sent back; '' marks one to remove, a value replaces it.
  const [secretChanges, setSecretChanges] = useState<Record<string, string>>({})
  const [newSecrets, setNewSecrets] = useState<Row[]>([])
  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        variables: Object.fromEntries(rows.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value])),
        secrets: { ...secretChanges, ...Object.fromEntries(newSecrets.filter(r => r.key.trim() && r.value).map(r => [r.key.trim(), r.value])) },
        bruno_environment: bruno.trim() || null,
      }
      return environment
        ? testingApi.updateEnvironment(projectId, environment.id, payload)
        : testingApi.createEnvironment(projectId, payload)
    },
    onSuccess: saved => {
      void queryClient.invalidateQueries({ queryKey: testingKeys.environments(projectId) })
      toast({ title: `Saved ${saved.name}`, tone: 'success' })
      onOpenChange(false)
    },
  })
  const setRow = (index: number, patch: Partial<Row>) => setRows(list => list.map((r, i) => i === index ? { ...r, ...patch } : r))
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={environment ? `Edit ${environment.name}` : 'New environment'} className="max-w-lg"
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>Save</Button>
        </>
      )}>
      <div className="space-y-4">
        <Input label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="UAT" autoFocus />
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-fg-muted">Variables (handed to the runner)</legend>
          {rows.map((row, index) => (
            <div key={index} className="flex gap-2">
              <input aria-label={`Variable ${index + 1} name`} value={row.key} onChange={e => setRow(index, { key: e.target.value })}
                placeholder="BASE_URL" className="h-9 w-40 rounded-lg border border-line bg-surface px-2 font-mono text-xs text-fg" />
              <input aria-label={`Variable ${index + 1} value`} value={row.value} onChange={e => setRow(index, { value: e.target.value })}
                placeholder="https://uat.example.com" className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[13px] text-fg" />
              <IconButton size="sm" label={`Remove ${row.key || 'variable'}`} icon={<X size={13} />}
                onClick={() => setRows(list => list.filter((_, i) => i !== index))} />
            </div>
          ))}
          <Button size="sm" icon={<Plus size={13} />} onClick={() => setRows(list => [...list, { key: '', value: '' }])}>Add variable</Button>
        </fieldset>
        <p className="text-xs text-fg-muted">Everyone in the project sees the variables above. Put passwords and tokens in secret variables.</p>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-fg-muted">Secret variables (encrypted, never shown again, hidden in run logs)</legend>
          {(environment?.secret_names ?? []).map(secret => {
            const removed = secretChanges[secret] === ''
            return (
              <div key={secret} className="flex items-center gap-2">
                <span className={`w-40 font-mono text-xs ${removed ? 'text-fg-muted line-through' : 'text-fg'}`}>{secret}</span>
                <input type="password" aria-label={`New value for ${secret}`} disabled={removed} value={removed ? '' : secretChanges[secret] ?? ''}
                  onChange={e => setSecretChanges(c => ({ ...c, [secret]: e.target.value }))} placeholder="•••••• (unchanged)"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[13px] text-fg disabled:opacity-50" />
                <IconButton size="sm" label={removed ? `Keep ${secret}` : `Remove ${secret}`} icon={<X size={13} />}
                  onClick={() => setSecretChanges(c => { const next = { ...c }; if (removed) delete next[secret]; else next[secret] = ''; return next })} />
              </div>
            )
          })}
          {newSecrets.map((row, index) => (
            <div key={index} className="flex gap-2">
              <input aria-label={`Secret ${index + 1} name`} value={row.key} placeholder="API_TOKEN"
                onChange={e => setNewSecrets(list => list.map((r, i) => i === index ? { ...r, key: e.target.value } : r))}
                className="h-9 w-40 rounded-lg border border-line bg-surface px-2 font-mono text-xs text-fg" />
              <input type="password" aria-label={`Secret ${index + 1} value`} value={row.value}
                onChange={e => setNewSecrets(list => list.map((r, i) => i === index ? { ...r, value: e.target.value } : r))}
                className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[13px] text-fg" />
              <IconButton size="sm" label={`Remove new secret ${index + 1}`} icon={<X size={13} />}
                onClick={() => setNewSecrets(list => list.filter((_, i) => i !== index))} />
            </div>
          ))}
          <Button size="sm" icon={<Plus size={13} />} onClick={() => setNewSecrets(list => [...list, { key: '', value: '' }])}>Add secret</Button>
        </fieldset>
        <Input label="Bruno environment (optional)" value={bruno} onChange={e => setBruno(e.target.value)} placeholder="uat"
          help="For Bruno collections: the name of the environment file to use." />
        {save.isError && <ErrorState title="Not saved">{apiService.errorMessage(save.error)}</ErrorState>}
      </div>
    </Dialog>
  )
}

/** Tests › Environments: where the tests run (test, UAT, …) and the variables each environment sets. */
export default function EnvironmentsPage() {
  const projectId = useAppStore(s => s.selectedProjectId)
  const canManage = usePermission('environment.manage')
  const toast = useToast()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<TestEnvironment | 'new' | null>(null)
  const [deleting, setDeleting] = useState<TestEnvironment | null>(null)
  const environments = useQuery({
    queryKey: testingKeys.environments(projectId ?? ''),
    queryFn: () => testingApi.environments(projectId!),
    enabled: Boolean(projectId),
  })
  const remove = useMutation({
    mutationFn: (environment: TestEnvironment) => testingApi.deleteEnvironment(projectId!, environment.id),
    onSuccess: (_, environment) => {
      void queryClient.invalidateQueries({ queryKey: ['testing', projectId] })
      toast({ title: `Deleted ${environment.name}`, tone: 'success' })
      setDeleting(null)
    },
  })
  if (!projectId) return <EmptyState icon={Globe} title="Choose a project">Pick a project in the top bar.</EmptyState>
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-fg-muted">Suites and runs use an environment's variables, for example BASE_URL.</p>
        {canManage && <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing('new')}>New environment</Button>}
      </div>
      <Card>
        {environments.isPending ? <Skeleton className="m-4 h-16" /> : environments.isError ? (
          <div className="p-4"><ErrorState title="Could not load the environments">{apiService.errorMessage(environments.error)}</ErrorState></div>
        ) : environments.data.length === 0 ? (
          <EmptyState icon={Globe} title="No environments yet">Add the environments you test against, such as Test and UAT.</EmptyState>
        ) : (
          <ul className="divide-y divide-line" aria-label="Environments">
            {environments.data.map(environment => (
              <li key={environment.id} className="flex items-start gap-3 px-4 py-3 text-[13px]">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-fg">{environment.name}</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-fg-muted">
                    {[...Object.entries(environment.variables).map(([k, v]) => `${k}=${v}`), ...(environment.secret_names ?? []).map(k => `${k}=••••`)].join('  ') || 'No variables'}
                  </p>
                </div>
                {canManage && (
                  <>
                    <IconButton size="sm" label={`Edit ${environment.name}`} icon={<Pencil size={13} />} onClick={() => setEditing(environment)} />
                    <IconButton size="sm" label={`Delete ${environment.name}`} icon={<Trash2 size={13} />} onClick={() => setDeleting(environment)} />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && (
        <EnvironmentDialog open onOpenChange={open => { if (!open) setEditing(null) }} projectId={projectId}
          environment={editing === 'new' ? null : editing} />
      )}
      <ConfirmDialog open={deleting !== null} onOpenChange={open => { if (!open) setDeleting(null) }}
        title={`Delete ${deleting?.name ?? 'environment'}?`}
        description="Suites that used it run without an environment until you choose another one."
        confirmLabel="Delete environment" destructive loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)} />
    </div>
  )
}
