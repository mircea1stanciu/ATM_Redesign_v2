import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookUp, CheckCircle2, ExternalLink, XCircle } from 'lucide-react'
import { apiService } from '@/services/api'
import { usePermission } from '@/hooks/usePermission'
import { Button, Popover, useToast } from '@/ui'
import { reportKeys, reportsApi } from './api'

/** "Publish to Confluence" with the status of the last publication and the history of all of them. */
export default function PublishPanel({ runId }: { runId: string }) {
  const canPublish = usePermission('report.publish')
  const toast = useToast()
  const queryClient = useQueryClient()
  const history = useQuery({ queryKey: reportKeys.publications(runId), queryFn: () => reportsApi.publications(runId),
    enabled: runId.startsWith('manual-') })
  const publish = useMutation({
    mutationFn: () => reportsApi.publish(runId),
    onSuccess: publication => {
      toast({
        title: `Published to Confluence (version ${publication.page_version})`, tone: 'success',
        action: publication.page_url ? { label: 'Open the page', onClick: () => window.open(publication.page_url!, '_blank', 'noopener') } : undefined,
      })
    },
    onError: error => toast({ title: 'Not published', description: apiService.errorMessage(error), tone: 'danger' }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: reportKeys.publications(runId) })
      void queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
  })
  if (!runId.startsWith('manual-')) return null // imported reports are not published from ATM
  const last = history.data?.[0]
  return (
    <div className="flex items-center gap-2">
      {last && (
        <Popover align="end" className="w-96 p-3" trigger={(
          <button type="button" aria-label="Confluence publications"
            className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium ${last.status === 'published' ? 'text-success' : 'text-danger'} hover:bg-surface-2`}>
            {last.status === 'published' ? <CheckCircle2 size={13} aria-hidden /> : <XCircle size={13} aria-hidden />}
            {last.status === 'published' ? `Published · v${last.page_version}` : 'Publication failed'}
          </button>
        )}>
          <h3 className="mb-2 text-[13px] font-semibold text-fg">Publications to Confluence</h3>
          <ul className="max-h-64 space-y-2 overflow-y-auto text-xs" aria-label="Publications">
            {(history.data ?? []).map(p => (
              <li key={p.id} className="rounded-lg border border-line p-2">
                <p className="flex items-center gap-1.5 font-medium text-fg">
                  {p.status === 'published' ? <CheckCircle2 size={12} className="text-success" aria-hidden /> : <XCircle size={12} className="text-danger" aria-hidden />}
                  {p.status === 'published' ? `Version ${p.page_version}` : 'Failed'}
                  <span className="ml-auto font-normal text-fg-muted">{p.published_at ? new Date(p.published_at).toLocaleString() : ''}</span>
                </p>
                <p className="mt-0.5 text-fg-muted">{p.published_by ?? 'Someone'}{p.attachment ? ` · ${p.attachment}` : ''}</p>
                {p.error && <p className="mt-0.5 text-danger">{p.error}</p>}
                {p.page_url && (
                  <a href={p.page_url} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-accent hover:underline">
                    Open the page <ExternalLink size={11} aria-hidden />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Popover>
      )}
      {canPublish && (
        <Button size="sm" variant="primary" icon={<BookUp size={13} />} loading={publish.isPending} onClick={() => publish.mutate()}>
          Publish to Confluence
        </Button>
      )}
    </div>
  )
}
