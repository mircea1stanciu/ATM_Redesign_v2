import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Award } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { usePermission } from '@/hooks/usePermission'
import { apiService } from '@/services/api'
import { ROLE_LABELS, type UserRole } from '@/types/domain'
import { Badge, Button, Card, EmptyState, ErrorState, Section, Select, Skeleton, useToast } from '@/ui'
import type { Readiness, ReadinessRequest } from './api'
import { learningApi, learningKeys } from './api'
import { pathProgress } from './paths'
import { usePaths } from './usePaths'
import { ProgressBar } from './PathsPage'

const roleName = (role: string | null) => (role ? ROLE_LABELS[role as UserRole] ?? role : '')
const when = (iso: string | null) => (iso ? new Date(`${iso}Z`).toLocaleString() : '')

function Stat({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="text-lg font-semibold text-fg">{value}</dd>
      {detail && <dd className="text-xs text-fg-muted">{detail}</dd>}
    </div>
  )
}

function Evidence({ data }: { data: Readiness }) {
  const e = data.evidence
  const path = usePaths().byId(e.path_id)
  const stats = path ? pathProgress(path, e.lessons, e.quizzes) : null
  return (
    <Section title="Evidence">
      <Card className="space-y-3 p-4">
        {path && stats ? (
          <div className="space-y-1">
            <p className="text-[13px] text-fg">{path.title}</p>
            <ProgressBar percent={stats.percent} label="Path progress" />
            <p className="text-xs text-fg-muted">{stats.percent} % of the path</p>
          </div>
        ) : <p className="text-xs text-fg-muted">No learning path chosen.</p>}
        <dl className="grid gap-2 sm:grid-cols-3" aria-label="Evidence">
          <Stat label="Lessons done" value={Object.keys(e.lessons).length} />
          <Stat label="Quizzes passed" value={Object.values(e.quizzes).filter(q => q.passed).length} />
          <Stat label="Practice approved" value={e.practice.approved} detail={e.practice.submitted ? `${e.practice.submitted} waiting for review` : undefined} />
          <Stat label="Work items done" value={e.work_items.done} detail={`${e.work_items.in_review} in review, ${e.work_items.in_progress} in progress`} />
          <Stat label="Pull requests approved" value={e.pull_requests.approved} detail={`of ${e.pull_requests.opened} opened from ATM`} />
          <Stat label="Merged after review" value={e.github.merged_after_review}
            detail={`${e.github.approved_not_merged} approved, not merged yet · ${e.github.merged_without_review} merged without approval`} />
          <Stat label="Runs" value={e.runs.total} detail={`${e.runs.passed} passed, ${e.runs.failed} failed`} />
          {(e.ai.connected || e.ai.assistant + e.ai.tutor + e.ai.review > 0) && (
            <Stat label="AI use" value={e.ai.assistant + e.ai.tutor + e.ai.review}
              detail={`${e.ai.assistant} assistant messages, ${e.ai.tutor} tutor questions, ${e.ai.review} AI reviews`} />
          )}
        </dl>
        {e.github.errors.length > 0 && (
          <p className="text-xs text-fg-muted">
            GitHub was not asked for {e.github.errors.map(err => `${err.project} (${err.detail})`).join('; ')}.
          </p>
        )}
        <p className="text-xs text-fg-muted">
          Last learning activity: {when(e.last_activity) || 'none yet'}. Merged pull requests come from GitHub{e.github.projects.length ? ` (${e.github.projects.join(', ')})` : ''}; AI use is counted since phase 22.
          ATM never promotes anyone by itself: the lead decides.
        </p>
      </Card>
    </Section>
  )
}

function Decide({ data }: { data: Readiness }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [role, setRole] = useState(data.promote_to[0] ?? '')
  const [note, setNote] = useState('')
  const decide = useMutation({
    mutationFn: (decision: 'promote' | 'not_yet') => learningApi.decide(data.user.id, decision, note.trim(), decision === 'promote' ? role : undefined),
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: ['learning'] })
      toast({ title: result.decision === 'promoted' ? `${data.user.name} is now ${roleName(result.to_role)}` : 'Decision saved', tone: 'success' })
      setNote('')
    },
    onError: error => toast({ title: 'Not saved', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  return (
    <Section title="Decision">
      <Card className="space-y-3 p-4">
        <Select label="New role" value={role} onChange={e => setRole(e.target.value)}>
          {data.promote_to.map(r => <option key={r} value={r}>{roleName(r)}</option>)}
        </Select>
        <textarea aria-label="Decision note" value={note} onChange={e => setNote(e.target.value)} rows={3}
          placeholder="A short note: what convinced you, or what to work on first"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-fg" />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<Award size={14} />} disabled={!note.trim() || !role || decide.isPending}
            loading={decide.isPending && decide.variables === 'promote'} onClick={() => decide.mutate('promote')}>
            Promote to {roleName(role)}
          </Button>
          <Button disabled={!note.trim() || decide.isPending} loading={decide.isPending && decide.variables === 'not_yet'}
            onClick={() => decide.mutate('not_yet')}>Not yet</Button>
        </div>
        <p className="text-xs text-fg-muted">The role changes at once and {data.user.name} is notified with your note. The decision is kept in the audit log.</p>
      </Card>
    </Section>
  )
}

function RequestReview({ data, self }: { data: Readiness; self: boolean }) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const request = useMutation({
    mutationFn: () => learningApi.requestReadiness(data.user.id, note.trim()),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['learning'] }); setNote('') },
  })
  return (
    <Card className="space-y-2 p-4">
      <p className="text-[13px] text-fg">
        {self ? 'Ready for the next step? Ask your lead to review your readiness.' : `Ask the lead to review ${data.user.name}'s readiness.`}
      </p>
      <textarea aria-label="Readiness request note" value={note} onChange={e => setNote(e.target.value)} rows={2}
        placeholder="What you have done (optional)" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-fg" />
      {request.isError && <ErrorState title="Not requested">{apiService.errorMessage(request.error)}</ErrorState>}
      <Button variant="primary" loading={request.isPending} onClick={() => request.mutate()}>Request readiness review</Button>
    </Card>
  )
}

function History({ items }: { items: ReadinessRequest[] }) {
  if (!items.length) return null
  return (
    <Section title="Decisions so far">
      <Card>
        <ul className="divide-y divide-line" aria-label="Readiness decisions">
          {items.map(item => (
            <li key={item.id} className="px-4 py-2 text-[13px]">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={item.decision === 'promoted' ? 'success' : 'warning'}>
                  {item.decision === 'promoted' ? `Promoted to ${roleName(item.to_role)}` : 'Not yet'}
                </Badge>
                <span className="text-xs text-fg-muted">{item.decided_by} · {when(item.decided_at)}</span>
              </p>
              {item.decision_note && <p className="mt-1 text-fg">{item.decision_note}</p>}
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  )
}

/** Learning › Readiness of one person: the evidence, the open request, the decision (leads) and the history. */
function PersonReadiness({ userId }: { userId: string }) {
  const me = useAppStore(s => s.user)
  const canMentor = usePermission('learning.mentor')
  const readiness = useQuery({ queryKey: learningKeys.readiness(userId), queryFn: () => learningApi.readiness(userId) })
  if (readiness.isPending) return <Skeleton className="h-64" />
  if (readiness.isError) return <ErrorState title="Could not load the readiness">{apiService.errorMessage(readiness.error)}</ErrorState>
  const data = readiness.data
  const self = String(data.user.id) === String(me?.id)
  const open = data.open_request
  return (
    <div className="flex flex-col gap-4">
      {canMentor && (
        <Link to="/learning/readiness" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
          <ArrowLeft size={13} aria-hidden />All readiness requests
        </Link>
      )}
      <h2 className="text-lg font-semibold text-fg">{data.user.name} <span className="font-normal text-fg-muted">· {roleName(data.user.role)}</span></h2>
      {open && (
        <Card className="p-4 text-[13px]">
          <p className="font-semibold text-fg">Readiness review requested {open.requested_by && open.requested_by !== data.user.name ? `by ${open.requested_by}` : ''} · {when(open.requested_at)}</p>
          {open.note && <p className="mt-1 text-fg">“{open.note}”</p>}
        </Card>
      )}
      {data.can_request && (self || canMentor) && <RequestReview data={data} self={self} />}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Evidence data={data} />
        {data.promote_to.length > 0 && <Decide key={data.user.role} data={data} />}
      </div>
      <History items={data.history} />
    </div>
  )
}

/** Learning › Readiness: mentors see the open requests and their people; a learner sees their own readiness. */
export default function ReadinessPage() {
  const { userId } = useParams()
  const me = useAppStore(s => s.user)
  const canMentor = usePermission('learning.mentor')
  const requests = useQuery({ queryKey: learningKeys.requests, queryFn: learningApi.openRequests, enabled: canMentor && !userId })
  const people = useQuery({ queryKey: learningKeys.mentor, queryFn: learningApi.mentor, enabled: canMentor && !userId })
  if (userId) return <PersonReadiness key={userId} userId={userId} />
  if (!canMentor) return me ? <Navigate to={`/learning/readiness/${me.id}`} replace /> : null
  if (requests.isPending || people.isPending) return <Skeleton className="h-48" />
  if (requests.isError) return <ErrorState title="Could not load the requests">{apiService.errorMessage(requests.error)}</ErrorState>
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title={`Readiness requests (${requests.data.length})`}>
        <Card>
          {requests.data.length === 0 ? <EmptyState icon={Award} title="No open requests">Trainees and users ask for a readiness review here.</EmptyState> : (
            <ul className="divide-y divide-line" aria-label="Readiness requests">
              {requests.data.map(r => (
                <li key={r.id} className="px-4 py-2 text-[13px]">
                  <Link to={`/learning/readiness/${r.user_id}`} className="font-semibold text-fg hover:text-accent hover:underline">{r.user}</Link>
                  <p className="text-xs text-fg-muted">{roleName(r.from_role)} · {when(r.requested_at)}{r.note ? ` · “${r.note}”` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>
      <Section title="People I mentor">
        <Card>
          <ul className="divide-y divide-line" aria-label="People">
            {(people.data?.people ?? []).map(p => (
              <li key={p.id} className="flex items-center gap-2 px-4 py-2 text-[13px]">
                <Link to={`/learning/readiness/${p.id}`} className="flex-1 font-medium text-fg hover:text-accent hover:underline">{p.name}</Link>
                <span className="text-xs text-fg-muted">{roleName(p.role)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </Section>
    </div>
  )
}
