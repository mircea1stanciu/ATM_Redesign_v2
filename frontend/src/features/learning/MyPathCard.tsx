import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { GraduationCap } from 'lucide-react'
import { buttonStyles, Card, EmptyState, Skeleton } from '@/ui'
import { learningApi, learningKeys } from './api'
import { pathById, pathProgress, programsOf } from './paths'
import { ProgressBar } from './PathsPage'

/** Home (Trainee): my path, how far I am, and the next lesson. */
export default function MyPathCard() {
  const me = useQuery({ queryKey: learningKeys.me, queryFn: learningApi.me })
  if (me.isPending) return <Skeleton className="h-28" />
  const path = pathById(me.data?.profile.path_id)
  if (!me.data || !path) {
    return (
      <EmptyState icon={GraduationCap} title="Choose your learning path"
        action={<Link to="/learning/paths" className={buttonStyles('primary')}>Open Learning</Link>}>
        Lessons, quizzes and practice tasks that take you from manual testing to automation.
      </EmptyState>
    )
  }
  const { lessons } = me.data.progress
  const stats = pathProgress(path, lessons, me.data.progress.quizzes)
  const next = programsOf(path).flatMap(p => p.modules.flatMap(m => m.lessons)).find(l => !(l.id in lessons))
  return (
    <Card className="space-y-2 p-4">
      <p className="text-[13px] font-semibold text-fg">{path.title}</p>
      <ProgressBar percent={stats.percent} label="My path progress" />
      <p className="text-xs text-fg-muted">{stats.percent} % · {stats.lessonsDone}/{stats.lessons} lessons · {stats.quizzesPassed}/{stats.quizzes} quizzes</p>
      {next
        ? <Link to={`/learning/lessons/${next.id}?path=${path.id}`} className={buttonStyles('primary', 'sm')}>Next lesson: {next.title}</Link>
        : <Link to={`/learning/paths/${path.id}`} className={buttonStyles('secondary', 'sm')}>All lessons done: review the quizzes</Link>}
    </Card>
  )
}
