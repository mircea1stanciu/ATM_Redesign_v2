import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, ExternalLink, GitBranch, Globe, KeyRound, Pencil, Plus, Server, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import { usePermission } from '@/hooks/usePermission'
import {
  Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, IconButton, Input, Select, Skeleton, Tabs,
  useTabParam, useToast,
} from '@/ui'
import type { ServiceEntry, ServiceProjectEntry } from './api'
import { deploymentKeys, deploymentsApi, utc } from './api'

function exampleScript(url: string, service: string, secret: string): string {
  return [
    `SECRET='${secret}'`,
    `BODY='{"service":"${service}","version":"1.2.3","environment":"UAT","source":"my-pipeline"}'`,
    'TS=$(date +%s)',
    `SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')`,
    `curl -X POST '${url}' -H 'Content-Type: application/json' \\`,
    `  -H "X-ATM-Timestamp: $TS" -H "X-ATM-Signature: sha256=$SIG" -d "$BODY"`,
  ].join('\n')
}

/** The webhook URL and the secret, shown once (ATM keeps the secret encrypted and never shows it again). */
function SecretDialog({ serviceId, service, secret, showGithubWebhook, onClose }: {
  serviceId: number; service: string; secret: string; showGithubWebhook: boolean; onClose: () => void
}) {
  const toast = useToast()
  const url = `${window.location.origin}/api/deployments/webhook`
  const githubUrl = `${window.location.origin}/api/deployments/services/${serviceId}/github-webhook`
  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text).then(() => toast({ title: `${what} copied`, tone: 'success' }))
  }
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }} title={`Webhook for ${service}`} className="max-w-2xl"
      description="Your pipeline posts each deployment to this URL, signed with the secret."
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1"><Input label="Webhook URL" value={url} readOnly /></div>
          <IconButton label="Copy the URL" icon={<Copy size={14} />} onClick={() => copy(url, 'URL')} />
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1"><Input label="Secret" value={secret} readOnly className="font-mono" /></div>
          <IconButton label="Copy the secret" icon={<Copy size={14} />} onClick={() => copy(secret, 'Secret')} />
        </div>
        {showGithubWebhook && (
          <>
            <div className="flex items-end gap-2">
              <div className="flex-1"><Input label="GitHub pull request webhook URL" value={githubUrl} readOnly /></div>
              <IconButton label="Copy the GitHub webhook URL" icon={<Copy size={14} />} onClick={() => copy(githubUrl, 'GitHub webhook URL')} />
            </div>
            <p className="text-xs text-fg-muted">For GitHub, subscribe to Pull requests and use this service secret.</p>
          </>
        )}
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-fg">
          Copy the secret now and keep it in your pipeline's secret store: ATM does not show it again. You can make a new one at any time.
        </p>
        <div>
          <p className="mb-1 text-xs font-medium text-fg-muted">Example (bash)</p>
          <pre className="overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 text-xs text-fg">{exampleScript(url, service, secret)}</pre>
        </div>
      </div>
    </Dialog>
  )
}

function ServicePortalDialog({ service, onClose }: { service: ServiceEntry; onClose: () => void }) {
  const portalUrl = service.check_portal_url
  if (!portalUrl) return null
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }} title={`${service.name} check portal`} className="max-w-6xl"
      footer={(
        <>
          <a href={portalUrl} target="_blank" rel="noreferrer" className="btn-secondary inline-flex items-center gap-2">
            <ExternalLink size={14} />Open in new tab
          </a>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </>
      )}>
      <iframe
        title={`${service.name} service check portal`}
        src={portalUrl}
        sandbox="allow-forms allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        className="h-[70vh] min-h-[420px] w-full rounded-lg border border-line bg-surface"
      />
    </Dialog>
  )
}

function ServiceDialog({ service, mode, onClose, onCreated }: {
  service: ServiceEntry | null
  mode: 'repository' | 'provider'
  onClose: () => void
  onCreated: (id: number, name: string, secret: string, showGithubWebhook: boolean) => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState(service?.name ?? '')
  const [kind, setKind] = useState<string>(service?.kind ?? 'backend')
  const [description, setDescription] = useState(service?.description ?? '')
  const [repositoryUrl, setRepositoryUrl] = useState(service?.repository_url ?? '')
  const [mainBranch, setMainBranch] = useState(service?.main_branch ?? 'main')
  const [checkPortalUrl, setCheckPortalUrl] = useState(service?.check_portal_url ?? '')
  const save = useMutation({
    mutationFn: async () => {
      const common = { name: name.trim(), kind, description: description.trim() }
      const payload = mode === 'repository'
        ? { ...common, repository_url: repositoryUrl.trim() || null, main_branch: mainBranch.trim() || 'main' }
        : { ...common, check_portal_url: checkPortalUrl.trim() || null }
      if (service) return { saved: await deploymentsApi.updateService(service.id, payload), secret: null }
      const created = await deploymentsApi.createService(payload)
      return { saved: created, secret: created.secret }
    },
    onSuccess: ({ saved, secret }) => {
      void queryClient.invalidateQueries({ queryKey: deploymentKeys.services })
      toast({ title: `Saved ${saved.name}`, tone: 'success' })
      onClose()
      if (secret) onCreated(saved.id, saved.name, secret, Boolean(saved.repository_url))
    },
  })
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }} title={service ? `Edit ${service.name}` : 'New service'} className="max-w-lg"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>Save</Button>
        </>
      )}>
      <div className="space-y-4">
        <Input label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="payment-service" autoFocus
          help="Service identifier used by deployment events." />
        <Select label="Kind" value={kind} onChange={e => setKind(e.target.value)}>
          <option value="backend">Backend service</option>
          <option value="frontend">Frontend app</option>
        </Select>
        <Input label="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
        {mode === 'repository' ? (
          <>
            <Input label="Git repository URL" value={repositoryUrl} onChange={e => setRepositoryUrl(e.target.value)}
              placeholder="https://github.com/org/repository" />
            <Input label="Branch to monitor" value={mainBranch} onChange={e => setMainBranch(e.target.value)} placeholder="main" />
          </>
        ) : (
          <Input label="Service check provider portal URL" value={checkPortalUrl}
            onChange={e => setCheckPortalUrl(e.target.value)} placeholder="https://deploy.example.com/service" />
        )}
        {save.isError && <ErrorState title="Not saved">{apiService.errorMessage(save.error)}</ErrorState>}
      </div>
    </Dialog>
  )
}

function ProjectDialog({ service, entry, onClose }: { service: ServiceEntry; entry: ServiceProjectEntry | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const projects = useAppStore(s => s.projects)
  const [projectId, setProjectId] = useState<number | null>(entry?.project_id ?? null)
  const [suiteId, setSuiteId] = useState<number | null>(entry?.smoke_suite?.id ?? null)
  const [userId, setUserId] = useState<number | null>(entry?.check_user?.id ?? null)
  const options = useQuery({
    queryKey: deploymentKeys.checkOptions(projectId ?? 0),
    queryFn: () => deploymentsApi.checkOptions(projectId!),
    enabled: projectId !== null,
  })
  const save = useMutation({
    mutationFn: () => deploymentsApi.mapProject(service.id, projectId!, suiteId, suiteId === null ? null : userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: deploymentKeys.services })
      toast({ title: `Saved ${service.name}`, tone: 'success' })
      onClose()
    },
  })
  const taken = new Set(service.projects.map(p => p.project_id))
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }} className="max-w-lg"
      title={entry ? `${entry.project} tests ${service.name}` : `A project that tests ${service.name}`}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={projectId === null || (suiteId !== null && userId === null)}
            onClick={() => save.mutate()}>Save</Button>
        </>
      )}>
      <div className="space-y-4">
        <Select label="Project" value={projectId ?? ''} disabled={Boolean(entry)}
          onChange={e => { setProjectId(e.target.value ? Number(e.target.value) : null); setSuiteId(null); setUserId(null) }}>
          <option value="">Choose a project</option>
          {projects.filter(p => entry || !taken.has(Number(p.id))).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        {projectId !== null && (
          <>
            <Select label="Smoke suite after each deployment (optional)" value={suiteId ?? ''}
              onChange={e => setSuiteId(e.target.value ? Number(e.target.value) : null)}
              help="It runs on the project's environment with the deployment's name (for example UAT).">
              <option value="">No check, only notify</option>
              {(options.data?.suites ?? []).map(s => <option key={s.id} value={s.id}>{s.name}{s.test_type ? ` (${s.test_type})` : ''}</option>)}
            </Select>
            {suiteId !== null && (
              <Select label="Runs as" value={userId ?? ''} onChange={e => setUserId(e.target.value ? Number(e.target.value) : null)}
                help="The check runs in this person's checkout of the project, like a schedule.">
                <option value="">Choose a tester</option>
                {(options.data?.users ?? []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            )}
          </>
        )}
        {options.isError && <ErrorState title="Could not load the project's suites">{apiService.errorMessage(options.error)}</ErrorState>}
        {save.isError && <ErrorState title="Not saved">{apiService.errorMessage(save.error)}</ErrorState>}
      </div>
    </Dialog>
  )
}

/** Deploys › Services: the service map. Which projects test each service, and the check run after a deployment. */
export default function ServicesPage() {
  const activeTab = useTabParam('check', ['repository', 'provider'] as const)
  const mode = activeTab === 'provider' ? 'provider' : 'repository'
  const canConfigure = usePermission('deployment.configure')
  const queryClient = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState<{ service: ServiceEntry | null; mode: 'repository' | 'provider' } | null>(null)
  const [mapping, setMapping] = useState<{ service: ServiceEntry; entry: ServiceProjectEntry | null } | null>(null)
  const [secret, setSecret] = useState<{
    id: number; service: string; secret: string; showGithubWebhook: boolean
  } | null>(null)
  const [portal, setPortal] = useState<ServiceEntry | null>(null)
  const [deleting, setDeleting] = useState<ServiceEntry | null>(null)
  const [renewing, setRenewing] = useState<ServiceEntry | null>(null)
  const services = useQuery({ queryKey: deploymentKeys.services, queryFn: deploymentsApi.services })
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: deploymentKeys.services })
  const remove = useMutation({
    mutationFn: (service: ServiceEntry) => deploymentsApi.deleteService(service.id),
    onSuccess: (_, service) => { invalidate(); toast({ title: `Deleted ${service.name}`, tone: 'success' }); setDeleting(null) },
    onError: error => toast({ title: 'Not deleted', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  const renew = useMutation({
    mutationFn: (service: ServiceEntry) => deploymentsApi.newSecret(service.id),
    onSuccess: (value, service) => {
      setRenewing(null)
      setSecret({ id: service.id, service: service.name, secret: value, showGithubWebhook: Boolean(service.repository_url) })
    },
    onError: error => toast({ title: 'No new secret', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  const unmap = useMutation({
    mutationFn: ({ service, entry }: { service: ServiceEntry; entry: ServiceProjectEntry }) => deploymentsApi.unmapProject(service.id, entry.project_id),
    onSuccess: invalidate,
    onError: error => toast({ title: 'Not removed', description: apiService.errorMessage(error), tone: 'danger' }),
  })

  return (
    <div className="flex flex-col gap-3">
      <Tabs
        label="Deployment check methods"
        param="check"
        items={[
          { to: 'repository', label: 'Git repositories', icon: GitBranch },
          { to: 'provider', label: 'Service check provider', icon: Globe },
        ]}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-fg-muted">
          {mode === 'repository'
            ? 'Monitor main-branch merges and assign project members to run service checks after deployments.'
            : 'Open each service check provider in an embedded portal.'}
        </p>
        {canConfigure && (
          <Button variant="primary" icon={<Plus size={14} />}
            onClick={() => setEditing({ service: null, mode })}>
            {mode === 'repository' ? 'New repository service' : 'New provider service'}
          </Button>
        )}
      </div>
      {services.isPending ? <Skeleton className="h-32" /> : services.isError ? (
        <ErrorState title="Could not load the services">{apiService.errorMessage(services.error)}</ErrorState>
      ) : services.data.length === 0 ? (
        <Card><EmptyState icon={Server} title="No services yet">
          {canConfigure ? 'Add a service to configure this check method.' : 'Your lead configures services for this check method.'}
        </EmptyState></Card>
      ) : mode === 'repository' ? (
        <ul className="flex flex-col gap-3" aria-label="Services">
          {services.data.map(service => (
            <li key={service.id}>
              <Card>
                <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-semibold text-fg">
                      {service.name}<Badge tone={service.kind === 'frontend' ? 'accent' : 'info'}>{service.kind}</Badge>
                    </p>
                    <p className="text-xs text-fg-muted">
                      {service.description ? `${service.description} · ` : ''}
                      {service.last_deployment
                        ? `Last: ${service.last_deployment.version} on ${service.last_deployment.environment}, ${utc(service.last_deployment.deployed_at).toLocaleString()}`
                        : 'No deployment yet'}
                    </p>
                    {service.repository_url && (
                      <a href={service.repository_url} target="_blank" rel="noreferrer"
                        className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-accent hover:underline">
                        <GitBranch size={12} aria-hidden />{service.main_branch}<span className="truncate">· {service.repository_url}</span>
                        <ExternalLink size={11} aria-hidden />
                      </a>
                    )}
                    {!service.repository_url && <p className="mt-1 text-xs text-fg-muted">No Git repository linked</p>}
                  </div>
                  {canConfigure && (
                    <div className="flex gap-1">
                      <Button size="sm" icon={<Plus size={13} />} onClick={() => setMapping({ service, entry: null })}>Add project</Button>
                      <IconButton size="sm" label={`New webhook secret for ${service.name}`} icon={<KeyRound size={13} />} onClick={() => setRenewing(service)} />
                      <IconButton size="sm" label={`Edit repository settings for ${service.name}`} icon={<Pencil size={13} />}
                        onClick={() => setEditing({ service, mode: 'repository' })} />
                      <IconButton size="sm" label={`Delete ${service.name}`} icon={<Trash2 size={13} />} onClick={() => setDeleting(service)} />
                    </div>
                  )}
                </div>
                {service.projects.length === 0 ? (
                  <p className="px-4 py-3 text-[13px] text-fg-muted">No project tests this service yet, so nobody is notified.</p>
                ) : (
                  <table className="w-full text-left text-[13px]" aria-label={`Projects testing ${service.name}`}>
                    <thead className="text-xs text-fg-muted">
                      <tr>
                        <th className="px-4 py-2 font-medium">Project</th>
                        <th className="px-2 py-2 font-medium">Check after a deployment</th>
                        <th className="px-2 py-2 font-medium">Runs as</th>
                        {canConfigure && <th className="px-4 py-2"><span className="sr-only">Actions</span></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {service.projects.map(entry => (
                        <tr key={entry.project_id}>
                          <td className="px-4 py-2 font-medium text-fg">{entry.project}</td>
                          <td className="px-2 py-2">{entry.smoke_suite?.name ?? <span className="text-fg-muted">Notify only</span>}</td>
                          <td className="px-2 py-2 text-fg-muted">{entry.check_user?.name ?? '—'}</td>
                          {canConfigure && (
                            <td className="px-4 py-2 text-right">
                              <IconButton size="sm" label={`Edit the check of ${entry.project}`} icon={<Pencil size={13} />} onClick={() => setMapping({ service, entry })} />
                              <IconButton size="sm" label={`Remove ${entry.project}`} icon={<Trash2 size={13} />} onClick={() => unmap.mutate({ service, entry })} />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Service check providers">
          {services.data.map(service => (
            <li key={service.id}>
              <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold text-fg">
                    {service.name}<Badge tone={service.kind === 'frontend' ? 'accent' : 'info'}>{service.kind}</Badge>
                  </p>
                  {service.check_portal_url ? (
                    <a href={service.check_portal_url} target="_blank" rel="noreferrer"
                      className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-accent hover:underline">
                      {service.check_portal_url}<ExternalLink size={11} aria-hidden />
                    </a>
                  ) : <p className="mt-1 text-xs text-fg-muted">No service check provider configured</p>}
                </div>
                {service.check_portal_url && (
                  <Button size="sm" variant="secondary" icon={<Globe size={13} />} onClick={() => setPortal(service)}>
                    Open provider
                  </Button>
                )}
                {canConfigure && (
                  <Button size="sm" icon={<Pencil size={13} />}
                    onClick={() => setEditing({ service, mode: 'provider' })}>
                    {service.check_portal_url ? 'Edit provider' : 'Configure provider'}
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editing && <ServiceDialog service={editing.service} mode={editing.mode} onClose={() => setEditing(null)}
        onCreated={(id, name, value, showGithubWebhook) => setSecret({ id, service: name, secret: value, showGithubWebhook })} />}
      {mapping && <ProjectDialog service={mapping.service} entry={mapping.entry} onClose={() => setMapping(null)} />}
      {portal && <ServicePortalDialog service={portal} onClose={() => setPortal(null)} />}
      {secret && <SecretDialog serviceId={secret.id} service={secret.service} secret={secret.secret}
        showGithubWebhook={secret.showGithubWebhook} onClose={() => setSecret(null)} />}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={open => { if (!open) setDeleting(null) }} destructive
        title={`Delete ${deleting?.name ?? ''}?`} confirmLabel="Delete" loading={remove.isPending}
        description="Its deployments and their checks are deleted too, and its pipeline can no longer report deployments."
        onConfirm={() => deleting && remove.mutate(deleting)} />
      <ConfirmDialog open={Boolean(renewing)} onOpenChange={open => { if (!open) setRenewing(null) }}
        title={`New webhook secret for ${renewing?.name ?? ''}?`} confirmLabel="Make a new secret" loading={renew.isPending}
        description="The current secret stops working at once: update the pipeline with the new one."
        onConfirm={() => renewing && renew.mutate(renewing)} />
    </div>
  )
}
