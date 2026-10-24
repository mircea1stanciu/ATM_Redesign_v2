import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FileCode2, GitPullRequest, Layers, Link2, PlayCircle, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import { hasPermission } from '@/hooks/usePermission'
import {
  Badge, Button, ConfirmDialog, Drawer, ErrorState, IconButton, Skeleton, Textarea, buttonStyles, useToast,
} from '@/ui'
import { workApi, workKeys } from './api'
import { KIND_LABELS, WORK_STATUS_LABELS } from './types'
import type { TraceLink, TraceTarget, WorkItem } from './types'

const TARGET_LABELS: Record<TraceTarget, string> = {
  test_file: 'Test file',
  suite: 'Suite',
  run: 'Run',
  pull_request: 'Pull request',
}
const TARGET_ICONS = { test_file: FileCode2, suite: Layers, run: PlayCircle, pull_request: GitPullRequest }

/** Whether the user may move or edit an item: its assignee, or a senior/lead (work.assign). */
export function useMayChange(item: WorkItem | undefined): boolean {
  const user = useAppStore(s => s.user)
  if (!item || !hasPermission(user, 'work.start')) return false
  return item.assignee_id === user?.id || hasPermission(user, 'work.assign')
}

function JiraActions({ projectId, item }: { projectId: string; item: WorkItem }) {
  const toast = useToast()
  const [comment, setComment] = useState('')
  const [transitionId, setTransitionId] = useState('')
  const transitions = useQuery({
    queryKey: [...workKeys.item(projectId, item.id), 'transitions'],
    queryFn: () => workApi.transitions(projectId, item.id),
    retry: false,
  })
  const fail = (title: string) => (error: unknown) =>
    toast({ title, description: apiService.errorMessage(error), tone: 'danger' })
  const move = useMutation({
    mutationFn: () => workApi.transition(projectId, item.id, transitionId),
    onSuccess: () => {
      const name = transitions.data?.find(t => t.id === transitionId)?.to
      toast({ title: `${item.external_key} moved${name ? ` to ${name}` : ''} in Jira`, tone: 'success' })
      setTransitionId('')
      void transitions.refetch()
    },
    onError: fail('Jira did not change the status'),
  })
  const post = useMutation({
    mutationFn: () => workApi.comment(projectId, item.id, comment.trim()),
    onSuccess: () => { toast({ title: `Commented on ${item.external_key}`, tone: 'success' }); setComment('') },
    onError: fail('The comment was not posted'),
  })
  const linkPr = useMutation({
    mutationFn: (pr: TraceLink) => workApi.remoteLink(projectId, item.id, pr.target_ref, pr.label || 'Pull request'),
    onSuccess: () => toast({ title: `Pull request linked on ${item.external_key}`, tone: 'success' }),
    onError: fail('The link was not added'),
  })
  const pullRequests = (item.links ?? []).filter(link => link.target_type === 'pull_request')

  const submitComment = (event: FormEvent) => {
    event.preventDefault()
    if (comment.trim()) post.mutate()
  }

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Jira</h3>
      <div className="flex items-end gap-2">
        <label className="flex-1 space-y-1.5">
          <span className="block text-xs font-medium text-fg-muted">Change the status in Jira</span>
          <select value={transitionId} onChange={e => setTransitionId(e.target.value)} disabled={!transitions.data?.length}
            className="h-9 w-full rounded-lg border border-line bg-surface px-2 text-[13px] text-fg">
            <option value="">{transitions.isError ? 'Not available' : 'Choose…'}</option>
            {transitions.data?.map(t => <option key={t.id} value={t.id}>{t.name}{t.to ? ` → ${t.to}` : ''}</option>)}
          </select>
        </label>
        <Button disabled={!transitionId} loading={move.isPending} onClick={() => move.mutate()}>Apply</Button>
      </div>
      <form onSubmit={submitComment} className="space-y-2">
        <Textarea label="Comment on the issue" rows={3} value={comment} onChange={e => setComment(e.target.value)}
          placeholder="For example: API tests added for the acceptance criteria." />
        <div className="flex justify-end">
          <Button type="submit" disabled={!comment.trim()} loading={post.isPending}>Post comment</Button>
        </div>
      </form>
      {pullRequests.map(pr => (
        <Button key={pr.id} size="sm" icon={<Link2 size={14} />} loading={linkPr.isPending} onClick={() => linkPr.mutate(pr)}>
          Link {pr.label || 'pull request'} in Jira
        </Button>
      ))}
    </section>
  )
}

/** A work item on the board: status, branch, trace links and Jira write-back. */
export default function WorkItemPanel({ projectId, itemId, onClose }: {
  projectId: string
  itemId: number | null
  onClose: () => void
}) {
  const open = itemId !== null
  const user = useAppStore(s => s.user)
  const queryClient = useQueryClient()
  const toast = useToast()
  const [linkType, setLinkType] = useState<TraceTarget>('test_file')
  const [linkRef, setLinkRef] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const query = useQuery({
    queryKey: workKeys.item(projectId, itemId ?? 0),
    queryFn: () => workApi.item(projectId, itemId!),
    enabled: open,
  })
  const item = query.data
  const mayChange = useMayChange(item)
  const refresh = (updated: WorkItem) => {
    queryClient.setQueryData(workKeys.item(projectId, updated.id), updated)
    void queryClient.invalidateQueries({ queryKey: workKeys.items(projectId) })
  }
  const fail = (title: string) => (error: unknown) =>
    toast({ title, description: apiService.errorMessage(error), tone: 'danger' })

  const addLink = useMutation({
    mutationFn: () => workApi.addLink(projectId, itemId!, { target_type: linkType, target_ref: linkRef.trim() }),
    onSuccess: updated => { refresh(updated); setLinkRef('') },
    onError: fail('The link was not added'),
  })
  const removeLink = useMutation({
    mutationFn: (linkId: number) => workApi.removeLink(projectId, itemId!, linkId),
    onSuccess: refresh,
    onError: fail('The link was not removed'),
  })
  const remove = useMutation({
    mutationFn: () => workApi.deleteItem(projectId, itemId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workKeys.all(projectId) })
      toast({ title: `${item?.external_key} removed from the board`, tone: 'success' })
      setConfirmDelete(false)
      onClose()
    },
    onError: fail('The item was not removed'),
  })

  return (
    <Drawer open={open} onOpenChange={value => { if (!value) onClose() }} title={item ? `${item.external_key} · ${item.title}` : 'Work item'}>
      {query.isPending ? <Skeleton className="h-40" /> : query.isError ? (
        <ErrorState title="Could not open the work item">{apiService.errorMessage(query.error)}</ErrorState>
      ) : item && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">{WORK_STATUS_LABELS[item.status]}</Badge>
            <Badge tone="info">{item.context?.type || KIND_LABELS[item.kind]}</Badge>
            <span className="text-xs text-fg-muted">{item.assignee_name ? `Assigned to ${item.assignee_name}` : 'Unassigned'}</span>
            {item.url && (
              <a href={item.url} target="_blank" rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                Open in {item.source === 'jira' ? 'Jira' : 'Confluence'} <ExternalLink size={12} aria-hidden />
              </a>
            )}
          </div>
          {item.branch && (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
              <code className="min-w-0 flex-1 truncate text-xs text-fg">{item.branch}</code>
              <Link to={`/work/workspace?tab=assistant&item=${item.id}`} className={buttonStyles('primary', 'sm')}>Open workspace</Link>
            </div>
          )}

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Traceability</h3>
            {(item.links ?? []).length === 0 ? (
              <p className="text-[13px] text-fg-muted">No test files, suites, runs or pull requests linked yet.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Trace links">
                {(item.links ?? []).map(link => {
                  const Icon = TARGET_ICONS[link.target_type]
                  const isUrl = /^https?:\/\//.test(link.target_ref)
                  return (
                    <li key={link.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                      <Icon size={14} className="shrink-0 text-fg-muted" aria-label={TARGET_LABELS[link.target_type]} />
                      {isUrl ? (
                        <a href={link.target_ref} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-accent hover:underline">
                          {link.label || link.target_ref}
                        </a>
                      ) : (
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{link.label || link.target_ref}</span>
                      )}
                      {mayChange && (
                        <IconButton size="sm" label={`Remove ${link.label || link.target_ref}`} icon={<Trash2 size={13} />}
                          onClick={() => removeLink.mutate(link.id)} />
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {mayChange && (
              <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (linkRef.trim()) addLink.mutate() }}>
                <select aria-label="Link type" value={linkType} onChange={e => setLinkType(e.target.value as TraceTarget)}
                  className="h-9 rounded-lg border border-line bg-surface px-2 text-[13px] text-fg">
                  {(Object.keys(TARGET_LABELS) as TraceTarget[]).map(t => <option key={t} value={t}>{TARGET_LABELS[t]}</option>)}
                </select>
                <input aria-label="Link target" value={linkRef} onChange={e => setLinkRef(e.target.value)}
                  placeholder="Path, suite id, run id or URL"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-[13px] text-fg focus:border-brand focus:outline-none" />
                <Button type="submit" disabled={!linkRef.trim()} loading={addLink.isPending}>Add</Button>
              </form>
            )}
          </section>

          {item.source === 'jira' && hasPermission(user, 'jira.write') && <JiraActions projectId={projectId} item={item} />}

          {mayChange && (
            <div className="border-t border-line pt-4">
              <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => setConfirmDelete(true)}>Remove from the board</Button>
            </div>
          )}
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title={`Remove ${item.external_key} from the board?`}
            description="The work item and its trace links are removed from ATM. The Jira issue and the branch stay."
            confirmLabel="Remove"
            destructive
            loading={remove.isPending}
            onConfirm={() => remove.mutate()}
          />
        </div>
      )}
    </Drawer>
  )
}
