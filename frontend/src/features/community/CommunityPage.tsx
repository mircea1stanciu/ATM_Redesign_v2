import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, MessageSquare, MessagesSquare, Pin, Plus, ThumbsUp } from 'lucide-react'
import { apiService } from '@/services/api'
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, PageHeader, Skeleton, Textarea } from '@/ui'
import { communityApi, communityKeys, parseTags } from './api'

function AskDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const ask = useMutation({
    mutationFn: () => communityApi.ask({ title: title.trim(), body: body.trim(), tags: parseTags(tags) }),
    onSuccess: question => {
      void queryClient.invalidateQueries({ queryKey: communityKeys.all })
      navigate(`/community/${question.id}`)
    },
  })
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }} title="Ask a question" className="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={ask.isPending} disabled={title.trim().length < 3} onClick={() => ask.mutate()}>Post question</Button></>}>
      <div className="space-y-4">
        <Input label="Question" value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="How do I…?" />
        <Textarea label="Details (Markdown)" value={body} onChange={e => setBody(e.target.value)} rows={6}
          help="What you tried, what happened, and a short snippet if it helps." />
        <Input label="Tags (optional)" value={tags} onChange={e => setTags(e.target.value)} placeholder="playwright, waits" help="Up to five, separated by commas." />
        {ask.isError && <ErrorState title="Not posted">{apiService.errorMessage(ask.error)}</ErrorState>}
      </div>
    </Dialog>
  )
}

/** Community (phase 21): questions and answers between everyone who learns and builds tests. */
export default function CommunityPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const tag = params.get('tag') ?? ''
  const [asking, setAsking] = useState(false)
  const list = useQuery({ queryKey: communityKeys.list(q, tag), queryFn: () => communityApi.list({ q: q || undefined, tag: tag || undefined }) })
  const set = (key: string, value: string) => setParams(p => { if (value) p.set(key, value); else p.delete(key); return p }, { replace: true })
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Community" description="Ask the people who learn and build tests with you; answer what you know."
        actions={<Button variant="primary" icon={<Plus size={14} />} onClick={() => setAsking(true)}>Ask a question</Button>} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm"><Input label="Search questions" type="search" value={q} onChange={e => set('q', e.target.value)} /></div>
        {(list.data?.tags.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tags">
            {list.data!.tags.map(t => (
              <Button key={t} size="sm" variant={t === tag ? 'secondary' : 'ghost'} aria-pressed={t === tag} onClick={() => set('tag', t === tag ? '' : t)}>#{t}</Button>
            ))}
          </div>
        )}
      </div>
      <Card className="overflow-hidden">
        {list.isPending ? <div className="space-y-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
          : list.isError ? <div className="p-4"><ErrorState title="Could not load the questions">{apiService.errorMessage(list.error)}</ErrorState></div>
            : list.data.items.length === 0 ? (
              <EmptyState icon={MessagesSquare} title={q || tag ? 'No question matches' : 'No questions yet'}>
                {q || tag ? 'Try other words, or ask it yourself.' : 'Be the first: ask what you are stuck on.'}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line" aria-label="Questions">
                {list.data.items.map(item => (
                  <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5">
                        {item.pinned && <Pin size={13} className="text-accent" aria-label="Pinned" />}
                        {item.locked && <Lock size={13} className="text-fg-muted" aria-label="Locked" />}
                        <Link to={`/community/${item.id}`} className="text-[14px] font-semibold text-fg hover:text-accent hover:underline">{item.title}</Link>
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                        {item.author ?? 'Someone'} · {new Date(`${item.created_at}Z`).toLocaleDateString()}
                        {item.tags.map(t => <Badge key={t}>#{t}</Badge>)}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-3 text-xs text-fg-muted">
                      <span className="inline-flex items-center gap-1" aria-label={`${item.answers} answers`}><MessageSquare size={13} aria-hidden />{item.answers}</span>
                      <span className="inline-flex items-center gap-1" aria-label={`${item.likes} likes`}><ThumbsUp size={13} aria-hidden />{item.likes}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
      </Card>
      {asking && <AskDialog onClose={() => setAsking(false)} />}
    </div>
  )
}
