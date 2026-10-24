import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GitBranch, GitPullRequest, KanbanSquare, MoreHorizontal } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import { DropdownMenu, EmptyState, ErrorState, IconButton, MenuItem, Skeleton, buttonStyles, useToast } from '@/ui'
import { workApi, workKeys } from './api'
import WorkItemPanel, { useMayChange } from './WorkItemPanel'
import { WORK_STATUSES, WORK_STATUS_LABELS } from './types'
import type { WorkItem, WorkStatus } from './types'

function Card({ item, onOpen, onMove }: { item: WorkItem; onOpen: () => void; onMove: (status: WorkStatus) => void }) {
  const mayChange = useMayChange(item)
  const pr = item.links?.find(link => link.target_type === 'pull_request')
  return (
    <li className="rounded-lg border border-line bg-surface p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <code className="text-[11px] text-fg-muted">{item.external_key}</code>
          <p className="mt-0.5 line-clamp-2 text-[13px] font-medium text-fg">{item.title}</p>
        </button>
        {mayChange && (
          <DropdownMenu trigger={<IconButton size="sm" label={`Move ${item.external_key}`} icon={<MoreHorizontal size={14} />} />}>
            {WORK_STATUSES.filter(status => status !== item.status).map(status => (
              <MenuItem key={status} onSelect={() => onMove(status)}>Move to {WORK_STATUS_LABELS[status]}</MenuItem>
            ))}
          </DropdownMenu>
        )}
      </div>
      <div className="mt-2 space-y-1 text-xs text-fg-muted">
        {item.branch && (
          <p className="flex min-w-0 items-center gap-1" title={item.branch}>
            <GitBranch size={12} className="shrink-0" aria-hidden /> <code className="min-w-0 truncate">{item.branch}</code>
          </p>
        )}
        {pr && (
          <a href={pr.target_ref} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-accent hover:underline">
            <GitPullRequest size={12} aria-hidden /> {pr.label || 'Pull request'}
          </a>
        )}
        <p>{item.assignee_name || 'Unassigned'}</p>
      </div>
    </li>
  )
}

/** Work › Board: To do → In progress → In review → Done. */
export default function BoardPage() {
  const projectId = useAppStore(s => s.selectedProjectId)
  const [params, setParams] = useSearchParams()
  const openId = Number(params.get('item')) || null
  const queryClient = useQueryClient()
  const toast = useToast()

  const items = useQuery({
    queryKey: workKeys.items(projectId ?? ''),
    queryFn: () => workApi.items(projectId!),
    enabled: Boolean(projectId),
  })
  const move = useMutation({
    mutationFn: ({ id, status }: { id: number; status: WorkStatus }) => workApi.updateItem(projectId!, id, { status }),
    onSuccess: updated => {
      void queryClient.invalidateQueries({ queryKey: workKeys.all(projectId!) })
      toast({ title: `${updated.external_key} moved to ${WORK_STATUS_LABELS[updated.status]}`, tone: 'success' })
    },
    onError: error => toast({ title: 'Not moved', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  const setOpen = (id: number | null) =>
    setParams(p => { if (id) p.set('item', String(id)); else p.delete('item'); return p }, { replace: true })

  if (!projectId) {
    return <EmptyState icon={KanbanSquare} title="Choose a project">Pick a project in the top bar to see its board.</EmptyState>
  }
  if (items.isPending) {
    return <div className="grid gap-3 md:grid-cols-4">{WORK_STATUSES.map(s => <Skeleton key={s} className="h-48" />)}</div>
  }
  if (items.isError) {
    return <ErrorState title="Could not load the board">{apiService.errorMessage(items.error)}</ErrorState>
  }
  if (items.data.length === 0) {
    return (
      <EmptyState icon={KanbanSquare} title="The board is empty"
        action={<Link to="/work/inbox" className={buttonStyles('primary')}>Open the inbox</Link>}>
        Start work on a story, or add it to the board, from the inbox.
      </EmptyState>
    )
  }

  return (
    <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {WORK_STATUSES.map(status => {
        const column = items.data.filter(item => item.status === status)
        return (
          <section key={status} aria-label={WORK_STATUS_LABELS[status]} className="flex min-h-0 flex-col rounded-xl bg-surface-2 p-2">
            <h2 className="flex items-center justify-between px-1 pb-2 text-[13px] font-semibold text-fg">
              {WORK_STATUS_LABELS[status]} <span className="text-xs font-normal text-fg-muted">{column.length}</span>
            </h2>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {column.map(item => (
                <Card key={item.id} item={item} onOpen={() => setOpen(item.id)}
                  onMove={next => move.mutate({ id: item.id, status: next })} />
              ))}
            </ul>
          </section>
        )
      })}
      <WorkItemPanel projectId={projectId} itemId={openId} onClose={() => setOpen(null)} />
    </div>
  )
}
