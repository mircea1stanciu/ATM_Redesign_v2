import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, KanbanSquare, Paperclip, Play, Plus } from 'lucide-react'
import { apiService } from '@/services/api'
import { usePermission } from '@/hooks/usePermission'
import { Badge, Button, buttonStyles, Drawer, ErrorState, SafeHtml, Skeleton, useToast } from '@/ui'
import { workApi, workKeys } from './api'
import StartWorkDialog from './StartWorkDialog'
import { KIND_LABELS, WORK_STATUS_LABELS } from './types'
import type { IssueDetail, PageDetail, WorkItem, WorkSource } from './types'

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{title}</h3>
      {children}
    </section>
  )
}

function WorkItemActions({ item }: { item: WorkItem }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px]">
      <Badge tone="accent">{WORK_STATUS_LABELS[item.status]}</Badge>
      {item.branch && <code className="text-xs text-fg-muted">{item.branch}</code>}
      <span className="flex-1" />
      <Link to={`/work/board?item=${item.id}`} className={buttonStyles('ghost', 'sm')}>
        <KanbanSquare size={14} aria-hidden /> Board
      </Link>
      {item.branch && (
        <Link to={`/work/workspace?tab=assistant&item=${item.id}`} className={buttonStyles('primary', 'sm')}>
          Open workspace
        </Link>
      )}
    </div>
  )
}

/** The detail panel of a Jira story or Confluence page: everything needed to start testing it. */
export default function StoryPanel({ projectId, source, itemKey, onClose }: {
  projectId: string
  source: WorkSource
  itemKey: string | null
  onClose: () => void
}) {
  const open = itemKey !== null
  const key = itemKey ?? ''
  const queryClient = useQueryClient()
  const toast = useToast()
  const canStart = usePermission('work.start')
  const [starting, setStarting] = useState(false)

  const detail = useQuery<IssueDetail | PageDetail>({
    queryKey: source === 'jira' ? workKeys.jiraIssue(projectId, key) : workKeys.confluencePage(projectId, key),
    queryFn: () => source === 'jira' ? workApi.jiraIssue(projectId, key) : workApi.confluencePage(projectId, key),
    enabled: open,
  })

  const addToBoard = useMutation({
    mutationFn: () => workApi.startWork(projectId, { source, external_key: key, start: false }),
    onSuccess: item => {
      void queryClient.invalidateQueries({ queryKey: workKeys.all(projectId) })
      toast({ title: `${item.external_key} is on the board`, tone: 'success' })
    },
    onError: error => toast({ title: 'Could not add to the board', description: apiService.errorMessage(error), tone: 'danger' }),
  })

  const data = detail.data
  const issue = data && 'description_html' in data ? data : null
  const page = data && 'body_html' in data ? data : null

  return (
    <Drawer open={open} onOpenChange={value => { if (!value) onClose() }} title={data ? `${data.key} · ${data.title}` : key}>
      {detail.isPending ? (
        <div className="space-y-3"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-32" /><Skeleton className="h-20" /></div>
      ) : detail.isError ? (
        <ErrorState title={`Could not open ${key}`}>{apiService.errorMessage(detail.error)}</ErrorState>
      ) : data && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{issue?.issue_type || KIND_LABELS[data.kind]}</Badge>
            {issue?.status && <Badge>{issue.status}</Badge>}
            {issue?.priority && <Badge tone="warning">{issue.priority}</Badge>}
            {issue?.labels.map(label => <Badge key={label}>{label}</Badge>)}
            <a href={data.url} target="_blank" rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
              Open in {source === 'jira' ? 'Jira' : 'Confluence'} <ExternalLink size={12} aria-hidden />
            </a>
          </div>
          {issue && (
            <p className="text-xs text-fg-muted">
              Assignee: {issue.assignee || 'Unassigned'} · Reporter: {issue.reporter || '—'}
            </p>
          )}

          {data.work_item ? <WorkItemActions item={data.work_item} /> : canStart && (
            <div className="flex gap-2">
              <Button variant="primary" icon={<Play size={14} />} onClick={() => setStarting(true)}>Start work</Button>
              <Button icon={<Plus size={14} />} loading={addToBoard.isPending} onClick={() => addToBoard.mutate()}>
                Add to board
              </Button>
            </div>
          )}

          {issue && (
            <>
              <Block title="Description">
                {issue.description_html ? <SafeHtml html={issue.description_html} />
                  : <p className="text-[13px] text-fg-muted">No description.</p>}
              </Block>
              {issue.acceptance_criteria_html && (
                <Block title="Acceptance criteria"><SafeHtml html={issue.acceptance_criteria_html} /></Block>
              )}
              {issue.links.length > 0 && (
                <Block title="Linked issues">
                  <ul className="space-y-1 text-[13px]">
                    {issue.links.map(link => (
                      <li key={`${link.relation}-${link.key}`} className="flex gap-2">
                        <span className="text-fg-muted">{link.relation}</span>
                        <code className="text-xs">{link.key}</code>
                        <span className="min-w-0 flex-1 truncate text-fg">{link.title}</span>
                        {link.status && <Badge>{link.status}</Badge>}
                      </li>
                    ))}
                  </ul>
                </Block>
              )}
              {issue.attachments.length > 0 && (
                <Block title="Attachments">
                  <ul className="space-y-1 text-[13px]">
                    {issue.attachments.map(file => (
                      <li key={file.name} className="flex items-center gap-1.5 text-fg">
                        <Paperclip size={12} className="text-fg-muted" aria-hidden /> {file.name}
                      </li>
                    ))}
                  </ul>
                </Block>
              )}
              <Block title={`Comments (${issue.comments.length})`}>
                {issue.comments.length === 0 ? <p className="text-[13px] text-fg-muted">No comments.</p> : (
                  <ul className="space-y-3">
                    {issue.comments.map((comment, index) => (
                      <li key={index} className="rounded-lg border border-line p-3">
                        <p className="mb-1 text-xs text-fg-muted">
                          {comment.author || 'Someone'} · {comment.created ? new Date(comment.created).toLocaleString() : ''}
                        </p>
                        {comment.body_html ? <SafeHtml html={comment.body_html} />
                          : <p className="whitespace-pre-wrap text-[13px] text-fg">{comment.body_text}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </Block>
            </>
          )}
          {page && (
            <Block title="Page">
              <p className="text-xs text-fg-muted">
                {page.author ? `Last edited by ${page.author}` : ''}{page.updated ? ` · ${new Date(page.updated).toLocaleString()}` : ''}
              </p>
              <SafeHtml html={page.body_html} />
            </Block>
          )}
        </div>
      )}
      {data && starting && (
        <StartWorkDialog open={starting} onOpenChange={setStarting} projectId={projectId} source={source}
          itemKey={data.key} title={data.title} />
      )}
    </Drawer>
  )
}
