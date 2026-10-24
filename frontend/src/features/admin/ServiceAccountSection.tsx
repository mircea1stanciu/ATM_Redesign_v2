import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { api, apiService } from '@/services/api'
import { Badge, Button, ErrorState } from '@/ui'

interface ServiceAccount {
  configured: boolean
  checkout_ready: boolean
  synced_at: string | null
  error: string | null
  configured_by: string | null
}

const key = (projectId: string) => ['projects', projectId, 'service-account'] as const

/** Admin › Projects (leads): the ATM account that runs the project's schedules, with its own checkout (phase 18). */
export default function ServiceAccountSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const [token, setToken] = useState('')
  const url = `/projects/${projectId}/service-account`
  const status = useQuery({ queryKey: key(projectId), queryFn: async () => (await api.get<ServiceAccount>(url)).data })
  const onSuccess = (data: ServiceAccount) => { queryClient.setQueryData(key(projectId), data); setToken('') }
  const save = useMutation({ mutationFn: async () => (await api.put<ServiceAccount>(url, { github_token: token.trim() })).data, onSuccess })
  const sync = useMutation({ mutationFn: async () => (await api.post<ServiceAccount>(`${url}/sync`)).data, onSuccess })
  const remove = useMutation({ mutationFn: async () => (await api.delete<ServiceAccount>(url)).data, onSuccess })
  const data = status.data
  const error = save.error ?? sync.error ?? remove.error

  return (
    <section className="space-y-2 rounded-lg border border-line p-3" aria-label="Service account">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-fg">
        <Bot size={14} className="text-fg-muted" aria-hidden />Service account for scheduled runs
        {data?.configured && <Badge tone="success">Set up</Badge>}
      </p>
      <p className="text-xs text-fg-muted">
        With a service account, scheduled runs use a checkout ATM keeps on the latest default branch, whoever set the
        schedule. Without one, a schedule runs as its owner in their own checkout.
      </p>
      {data?.configured && (
        <p className="text-xs text-fg-muted">
          Set up by {data.configured_by ?? 'someone'}{data.synced_at ? ` · last synced ${new Date(`${data.synced_at}Z`).toLocaleString()}` : ''}
          {data.error && <span className="block text-danger">Last sync failed: {data.error}</span>}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-xs text-fg-muted">
          {data?.configured ? 'Replace the GitHub token' : 'GitHub token of the service account'}
          <input type="password" value={token} onChange={e => setToken(e.target.value)} aria-label="Service account GitHub token"
            className="mt-1 h-9 w-full rounded-lg border border-line bg-surface px-2 text-[13px] text-fg" placeholder="ghp_…" />
        </label>
        <Button size="sm" variant="primary" loading={save.isPending} disabled={!token.trim()} onClick={() => save.mutate()}>Set token</Button>
        {data?.configured && (
          <>
            <Button size="sm" loading={sync.isPending} onClick={() => sync.mutate()}>Sync now</Button>
            <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>
          </>
        )}
      </div>
      {error && <ErrorState title="Service account">{apiService.errorMessage(error)}</ErrorState>}
    </section>
  )
}
