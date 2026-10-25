import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, GraduationCap, Pencil, Plus, Trash2 } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { apiService } from '@/services/api'
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, IconButton, Skeleton, Switch, useToast } from '@/ui'
import { learningApi, learningKeys } from './api'
import PathDialog from './PathDialog'
import type { LearningPath } from './paths'
import { pathProgress, programsOf } from './paths'
import { useMyLearning } from './useMyLearning'
import { usePaths } from './usePaths'

export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }} />
    </div>
  )
}

function ManagePath({ path, index, paths, onEdit, onDelete }: {
  path: LearningPath
  index: number
  paths: LearningPath[]
  onEdit: () => void
  onDelete: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const reorder = useMutation({
    mutationFn: (by: number) => {
      const ids = paths.map(p => p.id)
      ids.splice(index, 1)
      ids.splice(index + by, 0, path.id)
      return learningApi.reorderPaths(ids)
    },
    onSuccess: saved => queryClient.setQueryData(learningKeys.paths, saved),
    onError: error => toast({ title: 'Not moved', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  return (
    <div className="flex shrink-0 gap-0.5">
      <IconButton size="sm" label={`Move ${path.title} up`} icon={<ArrowUp size={13} />} disabled={index === 0 || reorder.isPending} onClick={() => reorder.mutate(-1)} />
      <IconButton size="sm" label={`Move ${path.title} down`} icon={<ArrowDown size={13} />} disabled={index === paths.length - 1 || reorder.isPending} onClick={() => reorder.mutate(1)} />
      <IconButton size="sm" label={`Edit ${path.title}`} icon={<Pencil size={13} />} onClick={onEdit} />
      <IconButton size="sm" label={`Delete ${path.title}`} icon={<Trash2 size={13} />} onClick={onDelete} />
    </div>
  )
}

/** Learning › Paths: every learning path with my progress; my path first. Leads build the paths here (phase 21). */
export default function PathsPage() {
  const canUseAi = usePermission('ai.use')
  const canManage = usePermission('learning.manage')
  const queryClient = useQueryClient()
  const toast = useToast()
  const { me, updateProfile } = useMyLearning()
  const { query: pathsQuery, paths } = usePaths()
  const [editing, setEditing] = useState<LearningPath | 'new' | null>(null)
  const [deleting, setDeleting] = useState<LearningPath | null>(null)
  const remove = useMutation({
    mutationFn: (path: LearningPath) => learningApi.deletePath(path.id),
    onSuccess: (_, path) => {
      void queryClient.invalidateQueries({ queryKey: learningKeys.paths })
      void queryClient.invalidateQueries({ queryKey: learningKeys.me })
      toast({ title: `Deleted ${path.title}`, tone: 'success' })
      setDeleting(null)
    },
    onError: error => toast({ title: 'Not deleted', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  if (me.isPending || pathsQuery.isPending) return <div className="grid gap-3 md:grid-cols-2"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
  if (me.isError) return <ErrorState title="Could not load your progress">{apiService.errorMessage(me.error)}</ErrorState>
  if (pathsQuery.isError) return <ErrorState title="Could not load the learning paths">{apiService.errorMessage(pathsQuery.error)}</ErrorState>
  const { profile, progress } = me.data
  // Leads see the order they set; learners see their own path first.
  const ordered = canManage ? paths : [...paths].sort((a, b) => Number(b.id === profile.path_id) - Number(a.id === profile.path_id))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-fg-muted">
          Lessons, quizzes and practice that take you from manual testing to automation. Your progress is saved to your account.
        </p>
        <div className="flex flex-wrap items-start gap-4">
          {canUseAi && (
            <div className="w-72">
              <Switch label="AI tutor mode" checked={profile.tutor_mode} disabled={updateProfile.isPending}
                onChange={on => updateProfile.mutate({ tutor_mode: on })} />
              <p className="mt-1 text-xs text-fg-muted">The AI explains and guides, in lessons and in the workspace, instead of writing the code for you.</p>
            </div>
          )}
          {canManage && <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing('new')}>New path</Button>}
        </div>
      </div>
      {profile.mentor && <p className="text-[13px] text-fg">Your mentor: <span className="font-semibold">{profile.mentor}</span></p>}
      {ordered.length === 0 ? <EmptyState icon={GraduationCap} title="No learning paths yet">{canManage ? 'Create the first one with "New path".' : 'Your lead has not set up any path yet.'}</EmptyState> : (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Learning paths">
          {ordered.map((path, index) => {
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
                    {canManage && <ManagePath path={path} index={index} paths={paths} onEdit={() => setEditing(path)} onDelete={() => setDeleting(path)} />}
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
      )}
      {editing && <PathDialog path={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={deleting !== null} onOpenChange={open => { if (!open) setDeleting(null) }} title={`Delete ${deleting?.title ?? ''}?`}
        description="Progress on its lessons is kept. Those who chose it choose another path, and its practice tasks become for any path."
        confirmLabel="Delete path" destructive loading={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting)} />
    </div>
  )
}
