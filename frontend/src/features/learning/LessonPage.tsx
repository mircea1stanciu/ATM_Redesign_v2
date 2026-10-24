import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Lightbulb, Sparkles } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { apiService } from '@/services/api'
import { Button, Card, EmptyState, ErrorState, Section, Skeleton } from '@/ui'
import type { Program } from './content'
import { learningApi, learningKeys } from './api'
import { PATHS, findLesson, pathById } from './paths'
import { useMyLearning } from './useMyLearning'
import { CourseViewer } from './viewers'

/** Where "back" goes: the path in the URL, my path if it has this program, or the first path that has it. */
export function backToPath(program: Program, fromUrl: string | null, myPath: string | null | undefined): string {
  const candidates = [pathById(fromUrl), pathById(myPath), ...PATHS]
  const path = candidates.find(p => p?.programs.includes(program.id))
  return path ? `/learning/paths/${path.id}` : '/learning/paths'
}

function TopicHints({ program }: { program: Program }) {
  const hints = useQuery({ queryKey: learningKeys.hints, queryFn: learningApi.hints, staleTime: 10 * 60_000 })
  const topic = (hints.data ?? []).filter(h => h.topics.includes(program.id))
  if (!topic.length) return null
  return (
    <Section title="Hints for this topic">
      <Card>
        <ul className="divide-y divide-line" aria-label="Topic hints">
          {topic.map(hint => (
            <li key={hint.id} className="flex gap-2 px-3 py-2 text-[13px]">
              <Lightbulb size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden />
              <span><Link to={`/learning/hints#hint-${hint.id}`} className="font-semibold text-fg hover:underline">{hint.title}</Link>
                <span className="block text-xs text-fg-muted">{hint.text}</span></span>
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  )
}

function Tutor({ lesson, context }: { lesson: string; context: string }) {
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const ask = useMutation({
    mutationFn: (q: string) => learningApi.tutor({ lesson, context, question: q, history: history.slice(-10) }),
    onSuccess: (answer, q) => { setHistory(list => [...list, { role: 'user', content: q }, { role: 'assistant', content: answer }]); setQuestion('') },
  })
  return (
    <Section title="Ask the AI tutor">
      <Card className="space-y-2 p-3">
        {history.length > 0 && (
          <ul className="max-h-80 space-y-2 overflow-y-auto" aria-label="Tutor conversation">
            {history.map((m, i) => (
              <li key={i} className={m.role === 'user' ? 'text-[13px] font-semibold text-fg' : 'whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-[13px] text-fg'}>{m.content}</li>
            ))}
          </ul>
        )}
        <textarea aria-label="Question for the tutor" value={question} onChange={e => setQuestion(e.target.value)} rows={2}
          placeholder="What is unclear in this step?" className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] text-fg" />
        {ask.isError && <ErrorState title="No answer">{apiService.errorMessage(ask.error)}</ErrorState>}
        <Button size="sm" icon={<Sparkles size={13} />} loading={ask.isPending} disabled={!question.trim()} onClick={() => ask.mutate(question.trim())}>Ask</Button>
      </Card>
    </Section>
  )
}

/** Learning › one lesson: its steps; finishing it saves it as done. */
export default function LessonPage() {
  const { lessonId = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const canUseAi = usePermission('ai.use')
  const { me, completeLesson } = useMyLearning()
  const found = findLesson(lessonId)
  if (!found) return <EmptyState title="Lesson not found"><Link to="/learning/paths" className="text-accent hover:underline">All paths</Link></EmptyState>
  if (me.isPending) return <Skeleton className="h-64" />
  const { program, module, lesson } = found
  const back = backToPath(program, params.get('path'), me.data?.profile.path_id)
  const context = [lesson.summary, ...lesson.objectives.map(o => `- ${o}`), ...lesson.steps.map(s => `## ${s.title}\n${s.detail}`)].join('\n').slice(0, 11_000)
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-h-0">
        <CourseViewer program={program} module={module} lesson={lesson} isCompleted={Boolean(me.data && lesson.id in me.data.progress.lessons)}
          onBack={() => navigate(back)} onComplete={() => completeLesson.mutate(lesson.id)} />
      </div>
      <aside className="flex flex-col gap-4">
        <Section title="Practice">
          <Card className="p-3 text-[13px] text-fg">{lesson.practice}</Card>
        </Section>
        <TopicHints program={program} />
        {canUseAi && <Tutor lesson={`${program.name} · ${lesson.title}`} context={context} />}
      </aside>
    </div>
  )
}
