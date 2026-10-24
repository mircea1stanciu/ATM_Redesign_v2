import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { api, apiService } from '@/services/api'
import { Card, EmptyState, ErrorState, Select, Skeleton } from '@/ui'

interface AuditItem {
  id: number
  action: string
  summary: string
  details: Record<string, unknown>
  actor: string | null
  subject: string | null
  project: string | null
  created_at: string
}

const ACTION_LABELS: Record<string, string> = {
  promotion: 'Promotion', 'readiness.not_yet': 'Readiness: not yet', 'role.change': 'Role change',
  'report.publish': 'Report published', 'deployment.webhook': 'Deployment webhook',
}

/** Admin › Audit: promotions, role changes, report publications and deployment webhooks (backend modules/audit). */
export default function AuditPage() {
  const [params, setParams] = useSearchParams()
  const action = params.get('action') ?? ''
  const audit = useQuery({
    queryKey: ['audit', action],
    queryFn: async () => (await api.get<{ actions: string[]; items: AuditItem[] }>('/audit', { params: action ? { action } : {} })).data,
  })
  return (
    <div className="flex flex-col gap-3">
      <div className="w-64">
        <Select label="What" value={action} onChange={e => setParams(p => { if (e.target.value) p.set('action', e.target.value); else p.delete('action'); return p }, { replace: true })}>
          <option value="">Everything</option>
          {(audit.data?.actions ?? []).map(a => <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>)}
        </Select>
      </div>
      <Card className="overflow-x-auto">
        {audit.isPending ? <Skeleton className="m-4 h-24" /> : audit.isError ? (
          <div className="p-4"><ErrorState title="Could not load the audit log">{apiService.errorMessage(audit.error)}</ErrorState></div>
        ) : audit.data.items.length === 0 ? <EmptyState icon={ScrollText} title="Nothing logged yet" /> : (
          <table className="w-full text-left text-[13px]" aria-label="Audit log">
            <thead className="border-b border-line text-xs text-fg-muted">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-2 py-2 font-medium">What</th>
                <th className="px-2 py-2 font-medium">Summary</th>
                <th className="px-4 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {audit.data.items.map(item => (
                <tr key={item.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-fg-muted">{new Date(`${item.created_at}Z`).toLocaleString()}</td>
                  <td className="px-2 py-2 text-xs font-semibold text-fg">{ACTION_LABELS[item.action] ?? item.action}</td>
                  <td className="px-2 py-2 text-fg">{item.summary}{item.project ? <span className="text-fg-muted"> · {item.project}</span> : null}</td>
                  <td className="px-4 py-2 text-xs text-fg-muted">{typeof item.details.note === 'string' ? item.details.note : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
