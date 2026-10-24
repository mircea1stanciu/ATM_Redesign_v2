import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, Rocket } from 'lucide-react'
import { apiService } from '@/services/api'
import { Badge, Card, EmptyState, ErrorState, Section, Skeleton, StatusPill } from '@/ui'
import { deploymentKeys, deploymentsApi, utc } from './api'

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="text-[13px] text-fg">{children}</dd>
    </div>
  )
}

/** Deploys › one deployment: what was deployed, the environment checks, and who was notified. */
export default function DeploymentPage() {
  const { deploymentId = '' } = useParams()
  const deployment = useQuery({
    queryKey: deploymentKeys.one(deploymentId),
    queryFn: () => deploymentsApi.get(deploymentId),
    refetchInterval: query => (query.state.data?.checks.some(c => c.status === 'running') ? 5000 : false),
  })
  if (deployment.isPending) return <Skeleton className="h-48" />
  if (deployment.isError) {
    return <ErrorState title="Could not load the deployment">{apiService.errorMessage(deployment.error)}</ErrorState>
  }
  const d = deployment.data
  return (
    <div className="flex flex-col gap-4">
      <Link to="/deployments/timeline" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
        <ArrowLeft size={13} aria-hidden />All deployments
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-fg">{d.service.name} {d.version} → {d.environment}</h2>
        <Badge tone={d.service.kind === 'frontend' ? 'accent' : 'info'}>{d.service.kind}</Badge>
        {d.check_status && <StatusPill status={d.check_status} />}
      </div>
      <Card className="p-4">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Deployed">{utc(d.deployed_at).toLocaleString()}</Detail>
          <Detail label="Source">{d.source ?? '—'}</Detail>
          <Detail label="Commit">{d.commit ? <code className="text-xs">{d.commit.slice(0, 12)}</code> : '—'}</Detail>
          <Detail label="Pipeline">
            {d.url ? (
              <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                Open<ExternalLink size={12} aria-hidden />
              </a>
            ) : '—'}
          </Detail>
        </dl>
        {d.notes && <p className="mt-3 whitespace-pre-wrap text-[13px] text-fg">{d.notes}</p>}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Environment checks">
          <Card>
            {d.checks.length === 0 ? (
              <EmptyState icon={Rocket} title="No checks">
                No project runs a smoke suite after deployments of {d.service.name}. A lead chooses one in Deploys › Services.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line" aria-label="Checks">
                {d.checks.map(check => (
                  <li key={check.id} className="flex items-start gap-3 px-4 py-3 text-[13px]">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-fg">{check.project}</p>
                      <p className="text-xs text-fg-muted">{check.suite ?? 'Suite deleted'}{check.detail ? ` · ${check.detail}` : ''}</p>
                    </div>
                    <StatusPill status={check.status} />
                    {check.run_id && check.status !== 'running' && (
                      <Link to={`/reports/runs/${check.run_id}`} className="text-xs font-semibold text-accent hover:underline"
                        aria-label={`Open the report of the ${check.project} check`}>Report</Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Section>
        <Section title="Notified">
          <Card>
            {d.notified.length === 0 ? (
              <p className="p-4 text-[13px] text-fg-muted">Nobody in your projects was notified.</p>
            ) : (
              <ul className="divide-y divide-line" aria-label="Notified testers">
                {d.notified.map((person, index) => (
                  <li key={`${person.name}-${index}`} className="flex items-center gap-2 px-4 py-2 text-[13px]">
                    <span className="flex-1 text-fg">{person.name}</span>
                    {person.project && <span className="text-xs text-fg-muted">{person.project}</span>}
                    <Badge tone={person.read ? 'success' : 'neutral'}>{person.read ? 'Seen' : 'Not seen'}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Section>
      </div>
    </div>
  )
}
