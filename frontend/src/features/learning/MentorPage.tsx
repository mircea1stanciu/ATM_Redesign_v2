import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { apiService } from '@/services/api'
import { ROLE_LABELS, type UserRole } from '@/types/domain'
import { Button, Card, EmptyState, ErrorState, Section, Skeleton, useToast } from '@/ui'
import type { Mentors, WaitingPractice } from './api'
import { learningApi, learningKeys } from './api'
import { pathProgress } from './paths'
import { ProgressBar } from './PathsPage'
import { usePaths } from './usePaths'

function ReviewPractice({ item }: { item: WaitingPractice }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [feedback, setFeedback] = useState('')
  const review = useMutation({
    mutationFn: (decision: 'approved' | 'changes_requested') => learningApi.review(item.id, decision, feedback.trim()),
    onSuccess: (_, decision) => {
      void queryClient.invalidateQueries({ queryKey: learningKeys.mentor })
      toast({ title: decision === 'approved' ? 'Practice approved' : 'Changes requested', tone: 'success' })
    },
    onError: error => toast({ title: 'Not saved', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  return (
    <Card className="space-y-2 p-3">
      <p className="text-[13px] font-semibold text-fg">{item.learner}: {item.task}</p>
      <p className="text-xs text-fg-muted">
        {item.branch && <>Branch <code>{item.branch}</code> </>}
        {item.link && <a href={item.link} target="_blank" rel="noreferrer" className="text-accent hover:underline">Open the pull request</a>}
        {' '}· handed in {new Date(`${item.submitted_at}Z`).toLocaleString()}
      </p>
      {item.note && <p className="text-[13px] text-fg">“{item.note}”</p>}
      <textarea aria-label={`Feedback for ${item.learner}`} value={feedback} onChange={e => setFeedback(e.target.value)} rows={2}
        placeholder="Feedback (needed to ask for changes)" className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] text-fg" />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" loading={review.isPending && review.variables === 'approved'} disabled={review.isPending} onClick={() => review.mutate('approved')}>Approve</Button>
        <Button size="sm" loading={review.isPending && review.variables === 'changes_requested'} disabled={review.isPending || !feedback.trim()} onClick={() => review.mutate('changes_requested')}>Ask for changes</Button>
      </div>
    </Card>
  )
}

/** Leads choose a Senior mentor for each of their Trainees and Users (phase 21). */
function AssignMentors() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const mentors = useQuery({ queryKey: learningKeys.mentors, queryFn: learningApi.mentors })
  const assign = useMutation({
    mutationFn: ({ userId, mentorId }: { userId: number; mentorId: number | null }) => learningApi.assignMentor(userId, mentorId),
    onSuccess: saved => {
      queryClient.setQueryData<Mentors>(learningKeys.mentors, data => data && {
        ...data, people: data.people.map(p => p.id === saved.id ? { ...p, mentor_id: saved.mentor_id } : p),
      })
      void queryClient.invalidateQueries({ queryKey: learningKeys.mentor })
      toast({ title: saved.mentor ? `${saved.mentor} mentors them now` : 'Mentor removed', tone: 'success' })
    },
    onError: error => toast({ title: 'Not saved', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  if (mentors.isPending) return <Skeleton className="h-24" />
  if (mentors.isError) return <ErrorState title="Could not load the mentors">{apiService.errorMessage(mentors.error)}</ErrorState>
  const { people, seniors } = mentors.data
  return (
    <Section title="Mentors">
      <Card className="overflow-x-auto">
        {people.length === 0 ? <p className="p-4 text-[13px] text-fg-muted">You lead no Trainees or Users yet.</p> : (
          <table className="w-full text-left text-[13px]" aria-label="Mentors">
            <thead className="border-b border-line text-xs text-fg-muted">
              <tr><th className="px-4 py-2 font-medium">Person</th><th className="px-4 py-2 font-medium">Senior mentor</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {people.map(person => (
                <tr key={person.id}>
                  <td className="px-4 py-2">
                    <p className="font-medium text-fg">{person.name}</p>
                    <p className="text-xs text-fg-muted">{ROLE_LABELS[person.role as UserRole] ?? person.role}</p>
                  </td>
                  <td className="w-72 px-4 py-2">
                    <select aria-label={`Mentor of ${person.name}`} value={person.mentor_id ?? ''} disabled={assign.isPending}
                      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] text-fg disabled:opacity-50"
                      onChange={e => assign.mutate({ userId: person.id, mentorId: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">No Senior mentor (you mentor them)</option>
                      {seniors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Section>
  )
}

/** Learning › Mentor (Lead, Senior): the people I mentor with their progress, and practice waiting for my review. */
export default function MentorPage() {
  const canAssign = usePermission('learning.manage')
  const { byId } = usePaths()
  const mentor = useQuery({ queryKey: learningKeys.mentor, queryFn: learningApi.mentor, refetchInterval: 60_000 })
  if (mentor.isPending) return <Skeleton className="h-48" />
  if (mentor.isError) return <ErrorState title="Could not load the mentor view">{apiService.errorMessage(mentor.error)}</ErrorState>
  const { people, waiting } = mentor.data
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-4">
      <Section title="People I mentor">
        <Card className="overflow-x-auto">
          {people.length === 0 ? <EmptyState icon={Users} title="Nobody to mentor yet">{canAssign ? 'Your Trainees and Users show here.' : 'The Trainees and Users a lead assigns to you show here.'}</EmptyState> : (
            <table className="w-full text-left text-[13px]" aria-label="Mentees">
              <thead className="border-b border-line text-xs text-fg-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Person</th>
                  <th className="px-2 py-2 font-medium">Path</th>
                  <th className="px-2 py-2 font-medium">Lessons</th>
                  <th className="px-2 py-2 font-medium">Quizzes passed</th>
                  <th className="px-2 py-2 font-medium">Practice</th>
                  <th className="px-4 py-2 font-medium">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {people.map(person => {
                  const path = byId(person.path_id)
                  const stats = path ? pathProgress(path, person.lessons, person.quizzes) : null
                  return (
                    <tr key={person.id}>
                      <td className="px-4 py-2">
                        <p className="font-medium text-fg">{person.name}</p>
                        <p className="text-xs text-fg-muted">{ROLE_LABELS[person.role as UserRole] ?? person.role}{canAssign && person.mentor ? ` · mentor ${person.mentor}` : ''} · <Link to={`/learning/readiness/${person.id}`} className="font-semibold text-accent hover:underline" aria-label={`Readiness of ${person.name}`}>Readiness</Link></p>
                      </td>
                      <td className="min-w-[180px] px-2 py-2">
                        {path && stats ? <><p className="text-xs text-fg">{path.title}</p><ProgressBar percent={stats.percent} label={`${person.name} on ${path.title}`} /><p className="text-xs text-fg-muted">{stats.percent} %</p></>
                          : <span className="text-xs text-fg-muted">No path chosen</span>}
                      </td>
                      <td className="px-2 py-2">{Object.keys(person.lessons).length}</td>
                      <td className="px-2 py-2">{Object.values(person.quizzes).filter(q => q.passed).length}</td>
                      <td className="px-2 py-2 text-xs">{person.practice.approved} approved{person.practice.submitted ? `, ${person.practice.submitted} waiting` : ''}</td>
                      <td className="px-4 py-2 text-xs text-fg-muted">{person.last_activity ? new Date(`${person.last_activity}Z`).toLocaleString() : 'Not started'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>
      </Section>
      {canAssign && <AssignMentors />}
      </div>
      <Section title={`Practice waiting for review (${waiting.length})`}>
        {waiting.length === 0 ? <Card><p className="p-4 text-[13px] text-fg-muted">Nothing waiting.</p></Card> : (
          <ul className="space-y-2" aria-label="Practice waiting for review">
            {waiting.map(item => <li key={item.id}><ReviewPractice item={item} /></li>)}
          </ul>
        )}
      </Section>
    </div>
  )
}
