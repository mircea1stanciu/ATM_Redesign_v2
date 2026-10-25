import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Lock, Pin, ThumbsUp, Trash2 } from 'lucide-react'
import { Markdown } from '@/components/Markdown'
import { apiService } from '@/services/api'
import { Badge, Button, Card, ConfirmDialog, ErrorState, IconButton, Skeleton, Textarea, useToast } from '@/ui'
import type { Question } from './api'
import { communityApi, communityKeys } from './api'

function LikeButton({ liked, likes, label, onClick }: { liked: boolean; likes: number; label: string; onClick: () => void }) {
  return (
    <Button size="sm" variant={liked ? 'secondary' : 'ghost'} icon={<ThumbsUp size={13} />} aria-pressed={liked} aria-label={`${label} (${likes})`} onClick={onClick}>
      {likes}
    </Button>
  )
}

/** Community › one question with its answers; answer it, like what helped. */
export default function QuestionPage() {
  const { postId = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [answer, setAnswer] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const key = communityKeys.question(postId)
  const question = useQuery({ queryKey: key, queryFn: () => communityApi.get(postId) })
  const saved = (data: Question) => { queryClient.setQueryData(key, data); void queryClient.invalidateQueries({ queryKey: ['community', 'list'] }) }
  const failed = (title: string) => (error: unknown) => toast({ title, description: apiService.errorMessage(error), tone: 'danger' })
  const post = useMutation({
    mutationFn: () => communityApi.answer(Number(postId), answer.trim()),
    onSuccess: data => { saved(data); setAnswer('') },
    onError: failed('Answer not posted'),
  })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: communityKeys.all })
  const like = useMutation({
    mutationFn: (target: { answerId?: number }) => target.answerId ? communityApi.likeAnswer(target.answerId) : communityApi.likeQuestion(Number(postId)),
    onSuccess: refresh,
    onError: failed('Not saved'),
  })
  const removeAnswer = useMutation({ mutationFn: communityApi.removeAnswer, onSuccess: refresh, onError: failed('Not removed') })
  const moderate = useMutation({
    mutationFn: (changes: { pinned?: boolean; locked?: boolean }) => communityApi.moderate(Number(postId), changes),
    onSuccess: saved,
    onError: failed('Not saved'),
  })
  const remove = useMutation({
    mutationFn: () => communityApi.remove(Number(postId)),
    onSuccess: () => { refresh(); navigate('/community') },
    onError: failed('Not removed'),
  })

  const back = <Link to="/community" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"><ArrowLeft size={13} aria-hidden />All questions</Link>
  if (question.isPending) return <div className="space-y-3">{back}<Skeleton className="h-48" /></div>
  if (question.isError) return <div className="space-y-3">{back}<ErrorState title="Could not load the question">{apiService.errorMessage(question.error)}</ErrorState></div>
  const q = question.data
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {back}
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-start gap-2">
          <h1 className="min-w-0 flex-1 text-lg font-semibold text-fg">{q.title}</h1>
          {q.pinned && <Badge tone="accent"><Pin size={11} aria-hidden />Pinned</Badge>}
          {q.locked && <Badge><Lock size={11} aria-hidden />Locked</Badge>}
        </div>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
          Asked by {q.author ?? 'someone'} · {new Date(`${q.created_at}Z`).toLocaleString()}
          {q.tags.map(t => <Link key={t} to={`/community?tag=${encodeURIComponent(t)}`}><Badge>#{t}</Badge></Link>)}
        </p>
        {q.body && <Markdown content={q.body} className="text-[13px] text-fg" />}
        <div className="flex flex-wrap items-center gap-2">
          <LikeButton liked={q.liked} likes={q.likes} label="Like the question" onClick={() => like.mutate({})} />
          {q.can_moderate && (
            <>
              <Button size="sm" variant="ghost" loading={moderate.isPending && moderate.variables?.pinned !== undefined} onClick={() => moderate.mutate({ pinned: !q.pinned })}>{q.pinned ? 'Unpin' : 'Pin'}</Button>
              <Button size="sm" variant="ghost" loading={moderate.isPending && moderate.variables?.locked !== undefined} onClick={() => moderate.mutate({ locked: !q.locked })}>{q.locked ? 'Unlock' : 'Lock'}</Button>
            </>
          )}
          {q.can_edit && <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => setConfirmRemove(true)}>Remove question</Button>}
        </div>
      </Card>

      <section className="space-y-2" aria-label="Answers">
        <h2 className="text-[15px] font-semibold text-fg">{q.answers} answer{q.answers === 1 ? '' : 's'}</h2>
        {q.answers_list.map(a => (
          <Card key={a.id} className="space-y-2 p-4">
            <p className="text-xs text-fg-muted"><span className="font-semibold text-fg">{a.author ?? 'Someone'}</span> · {new Date(`${a.created_at}Z`).toLocaleString()}</p>
            <Markdown content={a.body} className="text-[13px] text-fg" />
            <div className="flex items-center gap-2">
              <LikeButton liked={a.liked} likes={a.likes} label={`Like the answer of ${a.author ?? 'someone'}`} onClick={() => like.mutate({ answerId: a.id })} />
              {a.can_delete && <IconButton size="sm" label={`Remove the answer of ${a.author ?? 'someone'}`} icon={<Trash2 size={13} />} onClick={() => removeAnswer.mutate(a.id)} />}
            </div>
          </Card>
        ))}
      </section>

      {q.locked && !q.can_moderate ? (
        <p className="text-[13px] text-fg-muted">This question is locked: no new answers.</p>
      ) : (
        <Card className="space-y-2 p-4">
          <Textarea label="Your answer (Markdown)" value={answer} onChange={e => setAnswer(e.target.value)} rows={4} />
          <div className="flex justify-end">
            <Button variant="primary" loading={post.isPending} disabled={!answer.trim()} onClick={() => post.mutate()}>Post answer</Button>
          </div>
        </Card>
      )}
      <ConfirmDialog open={confirmRemove} onOpenChange={setConfirmRemove} title="Remove this question?"
        description="It disappears from Community with its answers." confirmLabel="Remove question" destructive
        loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </div>
  )
}
