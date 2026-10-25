import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Columns2, ExternalLink, FileCode2, Rows2, Sparkles, UserPlus } from 'lucide-react'
import { apiService } from '@/services/api'
import { usePermission } from '@/hooks/usePermission'
import { Badge, Button, Card, Checkbox, cn, Dialog, ErrorState, Section, Skeleton, StatusPill, Tabs, useTabParam, useToast } from '@/ui'
import PatchView from './PatchView'
import type { Layout } from './PatchView'
import ReviewerPicker, { NO_REVIEWERS } from './ReviewerPicker'
import type { ReviewerChoice } from './ReviewerPicker'
import type { NewLineComment, PullDetail, ReviewEvent, Side, Suggestion } from './api'
import { reviewKeys, reviewsApi } from './api'

const STATE_TONE: Record<string, 'success' | 'neutral' | 'info'> = { open: 'success', closed: 'neutral', merged: 'info' }
const REVIEW_WORDS: Record<string, string> = {
  APPROVED: 'approved', CHANGES_REQUESTED: 'requested changes', COMMENTED: 'reviewed', DISMISSED: 'review dismissed',
}
function Conversation({ pr, onComment, busy }: { pr: PullDetail; onComment: (body: string) => void; busy: boolean }) {
  const [body, setBody] = useState('')
  return (
    <div className="space-y-3">
      {pr.body && <Card className="p-4"><p className="text-xs font-semibold text-fg">{pr.author}</p><p className="whitespace-pre-wrap text-[13px] text-fg">{pr.body}</p></Card>}
      <ul className="space-y-2" aria-label="Conversation">
        {pr.conversation.map(item => (
          <li key={`${item.kind}-${item.id}`}>
            <Card className="p-3">
              <p className="flex items-center gap-2 text-xs text-fg-muted">
                <span className="font-semibold text-fg">{item.author}</span>
                {item.kind === 'review' && item.state && <Badge tone={item.state === 'APPROVED' ? 'success' : item.state === 'CHANGES_REQUESTED' ? 'danger' : 'neutral'}>{REVIEW_WORDS[item.state] ?? item.state}</Badge>}
                {item.created_at && new Date(item.created_at).toLocaleString()}
              </p>
              {item.body && <p className="mt-1 whitespace-pre-wrap text-[13px] text-fg">{item.body}</p>}
            </Card>
          </li>
        ))}
      </ul>
      {pr.me.can_comment && (
        <div className="space-y-2">
          <textarea aria-label="New comment" value={body} onChange={e => setBody(e.target.value)} rows={3} placeholder="Write a comment"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-fg" />
          <div className="flex justify-end">
            <Button loading={busy} disabled={!body.trim()} onClick={() => { onComment(body.trim()); setBody('') }}>Comment</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function Suggestions({ suggestions, onPost, busy }: { suggestions: Suggestion[]; onPost: (chosen: Suggestion[]) => void; busy: boolean }) {
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(suggestions.map((_, i) => i)))
  if (suggestions.length === 0) return <p className="text-[13px] text-fg-muted">The AI found nothing to comment on.</p>
  return (
    <div className="space-y-2">
      <ul className="space-y-2" aria-label="AI suggestions">
        {suggestions.map((s, index) => (
          <li key={index} className="rounded-lg border border-line p-2 text-[13px]">
            <Checkbox label={<span><code className="text-xs">{s.path}:{s.line}</code> {s.body}</span>} checked={chosen.has(index)}
              onChange={e => setChosen(set => { const next = new Set(set); if (e.target.checked) next.add(index); else next.delete(index); return next })} />
          </li>
        ))}
      </ul>
      <Button size="sm" loading={busy} disabled={chosen.size === 0} onClick={() => onPost(suggestions.filter((_, i) => chosen.has(i)))}>
        Post {chosen.size} comment{chosen.size === 1 ? '' : 's'}
      </Button>
    </div>
  )
}

function Reviewers({ pr }: { pr: PullDetail }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<ReviewerChoice>(NO_REVIEWERS)
  const projectId = String(pr.project_id)
  const request = useMutation({
    mutationFn: () => reviewsApi.requestReviewers(projectId, String(pr.number), choice.people, choice.teams),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reviewKeys.pull(projectId, String(pr.number)) })
      toast({ title: 'Reviewers asked on GitHub', tone: 'success' })
      setOpen(false)
      setChoice(NO_REVIEWERS)
    },
    onError: error => toast({ title: 'Reviewers not asked', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  const requested = [...pr.requested_reviewers, ...pr.requested_teams.map(team => `${team} (team)`)]
  return (
    <Section title="Reviewers" actions={pr.me.can_request_reviewers && pr.state === 'open' && (
      <Button size="sm" variant="ghost" icon={<UserPlus size={13} />} onClick={() => setOpen(true)}>Request reviewers</Button>
    )}>
      <Card className="p-3 text-[13px]">
        {requested.length === 0 ? <span className="text-fg-muted">Nobody is asked on GitHub.</span> : (
          <ul aria-label="Requested reviewers" className="flex flex-wrap gap-1.5">
            {requested.map(name => <li key={name}><Badge>{name}</Badge></li>)}
          </ul>
        )}
      </Card>
      <Dialog open={open} onOpenChange={setOpen} title="Request reviewers" description="They are asked on GitHub, and see the pull request waiting for them in ATM."
        footer={(
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={request.isPending} disabled={!choice.people.length && !choice.teams.length} onClick={() => request.mutate()}>Request</Button>
          </>
        )}>
        <ReviewerPicker projectId={projectId} value={choice} onChange={setChoice} exclude={[...pr.requested_reviewers, ...pr.requested_teams, pr.author]} />
      </Dialog>
    </Section>
  )
}

/**
 * Reviews › one pull request: files changed with line comments (posted to GitHub at once), the conversation, the
 * reviewers, checks, ATM runs, the story.
 */
export default function PullRequestPage() {
  const { projectId = '', number = '' } = useParams()
  const toast = useToast()
  const queryClient = useQueryClient()
  const canUseAi = usePermission('ai.use')
  const view = useTabParam('view', ['files', 'conversation'] as const)
  const [layout, setLayout] = useState<Layout>(() => (localStorage.getItem('atm.diffLayout') as Layout) || 'split')
  const [summary, setSummary] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const pull = useQuery({ queryKey: reviewKeys.pull(projectId, number), queryFn: () => reviewsApi.pull(projectId, number) })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['reviews'] })

  const submit = useMutation({
    mutationFn: (event: ReviewEvent) => reviewsApi.review(projectId, number, event, summary.trim()),
    onSuccess: (_, event) => {
      setSummary('')
      setSuggestions(null)
      refresh()
      toast({ title: event === 'APPROVE' ? 'Approved' : event === 'REQUEST_CHANGES' ? 'Changes requested' : 'Review sent', tone: 'success' })
    },
    onError: error => toast({ title: 'Review not sent', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  const comment = useMutation({
    mutationFn: (body: string) => reviewsApi.comment(projectId, number, body),
    onSuccess: refresh,
    onError: error => toast({ title: 'Comment not sent', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  const lineComment = useMutation({
    mutationFn: (comment: NewLineComment) => reviewsApi.lineComment(projectId, number, comment),
    onSuccess: refresh,
    onError: error => toast({ title: 'Comment not posted', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  const postSuggestions = useMutation({
    mutationFn: async (chosen: Suggestion[]) => {
      for (const [index, s] of chosen.entries()) {
        try {
          await reviewsApi.lineComment(projectId, number, { ...s, suggested_by_ai: true })
        } catch (error) {
          throw new Error(`${index} of ${chosen.length} posted. ${apiService.errorMessage(error)}`)
        }
      }
      return chosen.length
    },
    onSuccess: count => { setSuggestions(null); refresh(); toast({ title: `Posted ${count} comment${count === 1 ? '' : 's'}`, tone: 'success' }) },
    onError: error => { refresh(); toast({ title: 'Not every comment was posted', description: error.message, tone: 'danger' }) },
  })
  const askAi = useMutation({
    mutationFn: () => reviewsApi.aiReview(projectId, number),
    onSuccess: result => setSuggestions(result.suggestions),
    onError: error => toast({ title: 'No AI review', description: apiService.errorMessage(error), tone: 'danger' }),
  })

  if (pull.isPending) return <Skeleton className="h-64" />
  if (pull.isError) return <ErrorState title="Could not load the pull request">{apiService.errorMessage(pull.error)}</ErrorState>
  const pr = pull.data
  const add = async (path: string, target: { line: number; side: Side }, body: string) => {
    await lineComment.mutateAsync({ path, ...target, body })
  }
  const chooseLayout = (value: Layout) => { setLayout(value); localStorage.setItem('atm.diffLayout', value) }
  const open = pr.state === 'open'

  return (
    <div className="flex flex-col gap-4">
      <Link to="/reviews" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
        <ArrowLeft size={13} aria-hidden />All pull requests
      </Link>
      <div>
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-fg">
          {pr.title} <span className="font-normal text-fg-muted">#{pr.number}</span>
          <Badge tone={STATE_TONE[pr.state] ?? 'neutral'}>{pr.state}</Badge>{pr.draft && <Badge>Draft</Badge>}
        </h2>
        <p className="text-xs text-fg-muted">
          {pr.author} wants to merge <code>{pr.head}</code> into <code>{pr.base}</code> · {pr.project}
          {pr.url && <> · <a href={pr.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">GitHub<ExternalLink size={11} aria-hidden /></a></>}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-3">
          <Tabs param="view" label="Pull request" items={[
            { to: 'files', label: `Files changed (${pr.files.length})` }, { to: 'conversation', label: `Conversation (${pr.conversation.length})` },
          ]} />
          {view === 'conversation' ? <Conversation pr={pr} busy={comment.isPending} onComment={body => comment.mutate(body)} /> : (
            <>
              <div className="flex justify-end gap-1" role="group" aria-label="Diff layout">
                <Button size="sm" variant={layout === 'split' ? 'secondary' : 'ghost'} icon={<Columns2 size={13} />} aria-pressed={layout === 'split'} onClick={() => chooseLayout('split')}>Side by side</Button>
                <Button size="sm" variant={layout === 'inline' ? 'secondary' : 'ghost'} icon={<Rows2 size={13} />} aria-pressed={layout === 'inline'} onClick={() => chooseLayout('inline')}>Inline</Button>
              </div>
              {pr.files.map(file => (
                <Card key={file.filename} className="overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-[13px]">
                    <FileCode2 size={14} className="text-fg-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono font-semibold text-fg">{file.filename}</span>
                    <span className="text-xs text-success">+{file.additions}</span><span className="text-xs text-danger">−{file.deletions}</span>
                  </div>
                  <PatchView path={file.filename} patch={file.patch} layout={layout} canComment={pr.me.can_comment && open}
                    comments={pr.comments.filter(c => c.path === file.filename)} onAdd={(target, body) => add(file.filename, target, body)} />
                </Card>
              ))}
            </>
          )}
        </div>
        <aside className="flex flex-col gap-4">
          {pr.me.can_comment && open && (
            <Section title="Your review">
              <Card className="space-y-3 p-3">
                <p className="text-xs text-fg-muted">Line comments are posted on GitHub as you write them. Finish with a summary.</p>
                <textarea aria-label="Review summary" value={summary} onChange={e => setSummary(e.target.value)} rows={3}
                  placeholder="Summary (optional to approve)" className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] text-fg" />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" loading={submit.isPending && submit.variables === 'COMMENT'} disabled={submit.isPending || !summary.trim()}
                    onClick={() => submit.mutate('COMMENT')}>Comment</Button>
                  {pr.me.can_review && (
                    <>
                      <Button size="sm" variant="primary" disabled={submit.isPending || pr.me.is_author} loading={submit.isPending && submit.variables === 'APPROVE'}
                        onClick={() => submit.mutate('APPROVE')}>Approve</Button>
                      <Button size="sm" variant="danger" disabled={submit.isPending || pr.me.is_author || !summary.trim()}
                        loading={submit.isPending && submit.variables === 'REQUEST_CHANGES'} onClick={() => submit.mutate('REQUEST_CHANGES')}>Request changes</Button>
                    </>
                  )}
                </div>
                {pr.me.is_author && pr.me.can_review && <p className="text-xs text-fg-muted">You opened this pull request: GitHub does not let you approve it.</p>}
                {pr.me.can_review && canUseAi && (
                  <div className="space-y-2 border-t border-line pt-3">
                    <Button size="sm" variant="ghost" icon={<Sparkles size={13} />} loading={askAi.isPending} onClick={() => askAi.mutate()}>Ask AI to review</Button>
                    {suggestions && (
                      <Suggestions key={suggestions.length} suggestions={suggestions} busy={postSuggestions.isPending}
                        onPost={chosen => postSuggestions.mutate(chosen)} />
                    )}
                  </div>
                )}
              </Card>
            </Section>
          )}
          <Reviewers pr={pr} />
          <Section title="Story">
            <Card className="p-3 text-[13px]">
              {pr.work_item ? (
                <p><span className="font-semibold text-fg">{pr.work_item.key}</span> {pr.work_item.title}
                  {pr.work_item.url && <a href={pr.work_item.url} target="_blank" rel="noreferrer" className="ml-1 text-accent hover:underline">Open</a>}</p>
              ) : <span className="text-fg-muted">No work item uses this branch.</span>}
            </Card>
          </Section>
          <Section title="Checks">
            <Card>
              {pr.checks.length === 0 ? <p className="p-3 text-[13px] text-fg-muted">No checks on the latest commit.</p> : (
                <ul className="divide-y divide-line" aria-label="Checks">
                  {pr.checks.map(check => (
                    <li key={check.name} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate">{check.name}</span>
                      <StatusPill status={check.conclusion === 'success' ? 'passed' : check.conclusion === 'failure' ? 'failed' : check.conclusion ?? (check.status === 'completed' ? 'skipped' : 'running')} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Section>
          <Section title="ATM runs of this branch">
            <Card>
              {pr.runs.length === 0 ? <p className="p-3 text-[13px] text-fg-muted">No runs in ATM on <code>{pr.head}</code> yet.</p> : (
                <ul className="divide-y divide-line" aria-label="ATM runs">
                  {pr.runs.map(run => (
                    <li key={run.id} className={cn('flex items-center gap-2 px-3 py-2 text-[13px]')}>
                      <span className="min-w-0 flex-1 truncate">{run.name}</span>
                      <StatusPill status={run.status} />
                      {run.report && <Link to={`/reports/runs/${run.id}`} className="text-xs font-semibold text-accent hover:underline">Report</Link>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Section>
        </aside>
      </div>
    </div>
  )
}
