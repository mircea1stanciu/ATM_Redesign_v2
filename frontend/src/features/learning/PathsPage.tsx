import { Link } from 'react-router-dom'
import { GraduationCap } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { apiService } from '@/services/api'
import { Badge, Card, ErrorState, Skeleton, Switch } from '@/ui'
import { PATHS, pathProgress, programsOf } from './paths'
import { useMyLearning } from './useMyLearning'

export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }} />
    </div>
  )
}

/** Learning › Paths: every learning path with my progress; my path first. */
export default function PathsPage() {
  const canUseAi = usePermission('ai.use')
  const { me, updateProfile } = useMyLearning()
  if (me.isPending) return <div className="grid gap-3 md:grid-cols-2"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
  if (me.isError) return <ErrorState title="Could not load your progress">{apiService.errorMessage(me.error)}</ErrorState>
  const { profile, progress } = me.data
  const ordered = [...PATHS].sort((a, b) => Number(b.id === profile.path_id) - Number(a.id === profile.path_id))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-fg-muted">
          Lessons, quizzes and practice that take you from manual testing to automation. Your progress is saved to your account.
        </p>
        {canUseAi && (
          <div className="w-72">
            <Switch label="AI tutor mode" checked={profile.tutor_mode} disabled={updateProfile.isPending}
              onChange={on => updateProfile.mutate({ tutor_mode: on })} />
            <p className="mt-1 text-xs text-fg-muted">The AI explains and guides, in lessons and in the workspace, instead of writing the code for you.</p>
          </div>
        )}
      </div>
      <ul className="grid gap-3 md:grid-cols-2" aria-label="Learning paths">
        {ordered.map(path => {
          const stats = pathProgress(path, progress.lessons, progress.quizzes)
          return (
            <li key={path.id}>
              <Card className="flex h-full flex-col gap-2 p-4">
                <div className="flex items-start gap-2">
                  <GraduationCap size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <Link to={`/learning/paths/${path.id}`} className="text-[14px] font-semibold text-fg hover:text-accent hover:underline">{path.title}</Link>
                    <p className="text-xs text-fg-muted">{path.description}</p>
                  </div>
                  {path.id === profile.path_id && <Badge tone="accent">My path</Badge>}
                </div>
                <p className="text-xs text-fg-muted">{programsOf(path).map(p => p.name).join(' → ')}</p>
                <div className="mt-auto space-y-1">
                  <ProgressBar percent={stats.percent} label={`${path.title} progress`} />
                  <p className="text-xs text-fg-muted">
                    {stats.percent} % · {stats.lessonsDone}/{stats.lessons} lessons · {stats.quizzesPassed}/{stats.quizzes} quizzes
                  </p>
                </div>
              </Card>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
