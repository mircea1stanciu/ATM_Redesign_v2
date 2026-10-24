import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Rocket } from 'lucide-react'
import { apiService } from '@/services/api'
import { Badge, Card, cn, EmptyState, ErrorState, Skeleton, StatusPill } from '@/ui'
import { deploymentKeys, deploymentsApi, utc } from './api'

/** Deploys › Timeline: what was deployed where, newest first, with the result of the environment check. */
export default function TimelinePage() {
  const [params, setParams] = useSearchParams()
  const environment = params.get('environment') ?? ''
  const deployments = useQuery({
    queryKey: deploymentKeys.list(environment),
    queryFn: () => deploymentsApi.list(environment || undefined),
    refetchInterval: 30_000,
  })
  const choose = (value: string) => setParams(p => { if (value) p.set('environment', value); else p.delete('environment'); return p }, { replace: true })
  const environments = deployments.data?.environments ?? []

  return (
    <div className="flex flex-col gap-3">
      {environments.length > 0 && (
        <div role="group" aria-label="Environment" className="flex flex-wrap gap-1.5">
          {['', ...environments].map(name => (
            <button key={name || 'all'} type="button" onClick={() => choose(name)} aria-pressed={environment === name}
              className={cn('rounded-full border px-3 py-1 text-xs font-semibold',
                environment === name ? 'border-accent bg-accent/10 text-accent' : 'border-line text-fg-muted hover:text-fg')}>
              {name || 'All environments'}
            </button>
          ))}
        </div>
      )}
      <Card className="overflow-x-auto">
        {deployments.isPending ? <div className="space-y-2 p-4"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
          : deployments.isError ? <div className="p-4"><ErrorState title="Could not load the deployments">{apiService.errorMessage(deployments.error)}</ErrorState></div>
            : deployments.data.items.length === 0 ? (
              <EmptyState icon={Rocket} title="No deployments yet">
                Deployments show here when a pipeline reports one for a service your projects test. A lead sets that up in Deploys › Services.
              </EmptyState>
            ) : (
              <table className="w-full text-left text-[13px]" aria-label="Deployments">
                <thead className="border-b border-line text-xs text-fg-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Deployed</th>
                    <th className="px-2 py-2 font-medium">Component</th>
                    <th className="px-2 py-2 font-medium">Version</th>
                    <th className="px-2 py-2 font-medium">Environment</th>
                    <th className="px-2 py-2 font-medium">Source</th>
                    <th className="px-4 py-2 font-medium">Check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {deployments.data.items.map(d => (
                    <tr key={d.id}>
                      <td className="px-4 py-2 text-fg-muted">{utc(d.deployed_at).toLocaleString()}</td>
                      <td className="px-2 py-2">
                        <span className="flex items-center gap-1.5 font-medium text-fg">
                          {d.service.name}<Badge tone={d.service.kind === 'frontend' ? 'accent' : 'info'}>{d.service.kind}</Badge>
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <Link to={`/deployments/${d.id}`} className="font-mono font-semibold text-accent hover:underline"
                          aria-label={`Open ${d.service.name} ${d.version} on ${d.environment}`}>{d.version}</Link>
                      </td>
                      <td className="px-2 py-2">{d.environment}</td>
                      <td className="px-2 py-2 text-fg-muted">{d.source ?? '—'}</td>
                      <td className="px-4 py-2">{d.check_status ? <StatusPill status={d.check_status} /> : <span className="text-xs text-fg-muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
      </Card>
    </div>
  )
}
