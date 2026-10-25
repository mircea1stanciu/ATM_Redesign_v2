import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Circle, HelpCircle } from 'lucide-react'
import { apiService } from '@/services/api'
import { Badge, Button, Card, EmptyState, ErrorState, Section, Skeleton } from '@/ui'
import { pathProgress, programsOf } from './paths'
import { usePaths } from './usePaths'
import { ProgressBar } from './PathsPage'
import { useMyLearning } from './useMyLearning'

/** Learning › one path: its programs, modules, lessons and quizzes, with what I have done. */
export default function PathPage() {
  const { pathId = '' } = useParams()
  const { query: paths, byId } = usePaths()
  const path = byId(pathId)
  const { me, updateProfile } = useMyLearning()
  if (paths.isPending) return <Skeleton className="h-64" />
  if (paths.isError) return <ErrorState title="Could not load the learning paths">{apiService.errorMessage(paths.error)}</ErrorState>
  if (!path) return <EmptyState title="Path not found"><Link to="/learning/paths" className="text-accent hover:underline">All paths</Link></EmptyState>
  if (me.isPending) return <Skeleton className="h-64" />
  if (me.isError) return <ErrorState title="Could not load your progress">{apiService.errorMessage(me.error)}</ErrorState>
  const { profile, progress } = me.data
  const stats = pathProgress(path, progress.lessons, progress.quizzes)
  const query = `?path=${path.id}`
  return (
    <div className="flex flex-col gap-4">
      <Link to="/learning/paths" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
        <ArrowLeft size={13} aria-hidden />All paths
      </Link>
      <Card className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex-1 text-lg font-semibold text-fg">{path.title}</h2>
          {path.id === profile.path_id
            ? <Badge tone="accent">My path</Badge>
            : <Button size="sm" variant="primary" loading={updateProfile.isPending} onClick={() => updateProfile.mutate({ path_id: path.id })}>Make this my path</Button>}
        </div>
        <p className="text-[13px] text-fg-muted">{path.description}</p>
        <ProgressBar percent={stats.percent} label={`${path.title} progress`} />
        <p className="text-xs text-fg-muted">{stats.percent} % · {stats.lessonsDone}/{stats.lessons} lessons · {stats.quizzesPassed}/{stats.quizzes} quizzes passed</p>
      </Card>
      {programsOf(path).map(program => (
        <Section key={program.id} title={program.name}>
          <div className="space-y-3">
            {program.modules.map(module => {
              const quiz = progress.quizzes[module.id]
              return (
                <Card key={module.id}>
                  <div className="border-b border-line px-4 py-2.5">
                    <p className="text-[13px] font-semibold text-fg">{module.title}</p>
                    <p className="text-xs text-fg-muted">{module.description}</p>
                  </div>
                  <ul className="divide-y divide-line" aria-label={module.title}>
                    {module.lessons.map(lesson => {
                      const done = lesson.id in progress.lessons
                      return (
                        <li key={lesson.id} className="flex items-center gap-2 px-4 py-2 text-[13px]">
                          {done ? <CheckCircle2 size={15} className="text-success" aria-label="Done" /> : <Circle size={15} className="text-fg-muted" aria-label="Not done" />}
                          <Link to={`/learning/lessons/${lesson.id}${query}`} className="min-w-0 flex-1 truncate text-fg hover:text-accent hover:underline">{lesson.title}</Link>
                          <span className="text-xs text-fg-muted">{lesson.duration}</span>
                        </li>
                      )
                    })}
                    <li className="flex items-center gap-2 px-4 py-2 text-[13px]">
                      <HelpCircle size={15} className={quiz?.passed ? 'text-success' : 'text-fg-muted'} aria-hidden />
                      <Link to={`/learning/quizzes/${module.id}${query}`} className="min-w-0 flex-1 text-fg hover:text-accent hover:underline">Quiz: {module.title}</Link>
                      {quiz && <span className="text-xs text-fg-muted">best {quiz.best_score}/{quiz.total}</span>}
                      {quiz?.passed && <Badge tone="success">Passed</Badge>}
                    </li>
                  </ul>
                </Card>
              )
            })}
          </div>
        </Section>
      ))}
    </div>
  )
}
