import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, Pencil, Plus } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { usePermission } from '@/hooks/usePermission'
import { apiService } from '@/services/api'
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, ErrorState, IconButton, Input, Select, Skeleton, Textarea, useToast } from '@/ui'
import type { PracticeTask, Submission } from './api'
import { learningApi, learningKeys } from './api'
import { usePaths } from './usePaths'

export const SUBMISSION_STATUS: Record<Submission['status'], { label: string; tone: 'info' | 'success' | 'warning' }> = {
  submitted: { label: 'Waiting for review', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  changes_requested: { label: 'Changes requested', tone: 'warning' },
}

function TaskDialog({ task, onClose }: { task: PracticeTask | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const projects = useAppStore(s => s.projects)
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [pathId, setPathId] = useState(task?.path_id ?? '')
  const [projectId, setProjectId] = useState(task?.project ? String(task.project.id) : '')
  const [active, setActive] = useState(task?.active ?? true)
  const { paths } = usePaths()
  const save = useMutation({
    mutationFn: () => learningApi.saveTask({ title: title.trim(), description: description.trim(), path_id: pathId || null,
      project_id: projectId ? Number(projectId) : null, active }, task?.id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: learningKeys.practice }); onClose() },
  })
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }} title={task ? `Edit ${task.title}` : 'New practice task'} className="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!title.trim() || !description.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <Input label="Title" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
        <Textarea label="What to do" value={description} onChange={e => setDescription(e.target.value)} rows={5}
          help="A small, real change: which file, what the test should check, how to know it is done." />
        <Select label="Path (optional)" value={pathId} onChange={e => setPathId(e.target.value)}>
          <option value="">Any path</option>
          {paths.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
        </Select>
        <Select label="Project to work in (optional)" value={projectId} onChange={e => setProjectId(e.target.value)}>
          <option value="">None</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Checkbox label="Active (learners see it)" checked={active} onChange={e => setActive(e.target.checked)} />
        {save.isError && <ErrorState title="Not saved">{apiService.errorMessage(save.error)}</ErrorState>}
      </div>
    </Dialog>
  )
}

function HandIn({ task }: { task: PracticeTask }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const mine = task.my_submission
  const [branch, setBranch] = useState(mine?.branch ?? '')
  const [link, setLink] = useState(mine?.link ?? '')
  const [note, setNote] = useState('')
  const submit = useMutation({
    mutationFn: () => learningApi.submit(task.id, { branch, link, note }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: learningKeys.practice }); toast({ title: 'Handed in for review', tone: 'success' }) },
  })
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input label="Branch" value={branch} onChange={e => setBranch(e.target.value)} placeholder="practice/my-name/login-test" />
        <Input label="Pull request link" value={link} onChange={e => setLink(e.target.value)} placeholder="https://…" />
      </div>
      <Textarea label="Note for your mentor (optional)" value={note} onChange={e => setNote(e.target.value)} rows={2} />
      {submit.isError && <ErrorState title="Not handed in">{apiService.errorMessage(submit.error)}</ErrorState>}
      <Button size="sm" variant="primary" loading={submit.isPending} disabled={!branch.trim() && !link.trim()} onClick={() => submit.mutate()}>
        {mine ? 'Hand in again' : 'Hand in for review'}
      </Button>
    </div>
  )
}

/** Learning › Practice: small real changes, handed in for a mentor's review. Leads write the tasks. */
export default function PracticePage() {
  const canManage = usePermission('learning.manage')
  const canPractise = usePermission('code.edit')
  const [editing, setEditing] = useState<PracticeTask | 'new' | null>(null)
  const tasks = useQuery({ queryKey: learningKeys.practice, queryFn: learningApi.practice })
  const { byId } = usePaths()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-fg-muted">Do the change on a branch of the project, then hand it in. A mentor reviews it and gives feedback.</p>
        {canManage && <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing('new')}>New practice task</Button>}
      </div>
      {tasks.isPending ? <Skeleton className="h-32" /> : tasks.isError ? (
        <ErrorState title="Could not load the practice tasks">{apiService.errorMessage(tasks.error)}</ErrorState>
      ) : tasks.data.length === 0 ? (
        <Card><EmptyState icon={ClipboardCheck} title="No practice tasks yet">{canManage ? 'Write the first one.' : 'Your lead adds practice tasks here.'}</EmptyState></Card>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Practice tasks">
          {tasks.data.map(task => {
            const mine = task.my_submission
            return (
              <li key={task.id}>
                <Card className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="flex-1 text-[14px] font-semibold text-fg">{task.title}</p>
                    {!task.active && <Badge>Inactive</Badge>}
                    {mine && <Badge tone={SUBMISSION_STATUS[mine.status].tone}>{SUBMISSION_STATUS[mine.status].label}</Badge>}
                    {canManage && <IconButton size="sm" label={`Edit ${task.title}`} icon={<Pencil size={13} />} onClick={() => setEditing(task)} />}
                  </div>
                  <p className="text-xs text-fg-muted">
                    {byId(task.path_id)?.title ?? 'Any path'}{task.project ? ` · in ${task.project.name}` : ''}
                  </p>
                  <p className="whitespace-pre-wrap text-[13px] text-fg">{task.description}</p>
                  {mine?.feedback && (
                    <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg"><span className="font-semibold">{mine.reviewer}:</span> {mine.feedback}</p>
                  )}
                  {canPractise && task.active && mine?.status !== 'approved' && <HandIn task={task} />}
                </Card>
              </li>
            )
          })}
        </ul>
      )}
      {editing && <TaskDialog task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
