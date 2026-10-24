import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lightbulb, Pencil, Plus, Trash2 } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { apiService } from '@/services/api'
import { Badge, Button, Card, cn, ConfirmDialog, Dialog, EmptyState, ErrorState, IconButton, Input, Skeleton, Textarea } from '@/ui'
import type { Hint } from './api'
import { learningApi, learningKeys } from './api'
import { PROGRAMS } from './content'

const programName = (id: string) => PROGRAMS.find(p => p.id === id)?.name ?? id

function HintDialog({ hint, onClose }: { hint: Hint | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [id, setId] = useState(hint?.id ?? '')
  const [title, setTitle] = useState(hint?.title ?? '')
  const [text, setText] = useState(hint?.text ?? '')
  const [details, setDetails] = useState(hint?.details ?? '')
  const [topics, setTopics] = useState<string[]>(hint?.topics ?? [])
  const save = useMutation({
    mutationFn: () => learningApi.saveHint(id.trim(), { title: title.trim(), text: text.trim(), details: details.trim(), topics }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: learningKeys.hints }); onClose() },
  })
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }} title={hint ? `Edit ${hint.title}` : 'New hint'} className="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!id.trim() || !title.trim() || !text.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <Input label="Id" value={id} onChange={e => setId(e.target.value)} disabled={Boolean(hint)} placeholder="name-tests-after-behaviour"
          help="Lower-case letters, digits and '-'. The workspace's rules use the ids of the standard hints." />
        <Input label="Title" value={title} onChange={e => setTitle(e.target.value)} />
        <Textarea label="Short text (shown in the editor)" value={text} onChange={e => setText(e.target.value)} rows={2} />
        <Textarea label="Explanation" value={details} onChange={e => setDetails(e.target.value)} rows={4} />
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-fg-muted">Topics (none: every topic)</legend>
          <div className="flex flex-wrap gap-1.5">
            {PROGRAMS.map(p => (
              <button key={p.id} type="button" aria-pressed={topics.includes(p.id)}
                onClick={() => setTopics(list => list.includes(p.id) ? list.filter(t => t !== p.id) : [...list, p.id])}
                className={cn('rounded-full border px-2.5 py-0.5 text-xs', topics.includes(p.id) ? 'border-accent bg-accent/10 text-accent' : 'border-line text-fg-muted')}>
                {p.name}
              </button>
            ))}
          </div>
        </fieldset>
        {save.isError && <ErrorState title="Not saved">{apiService.errorMessage(save.error)}</ErrorState>}
      </div>
    </Dialog>
  )
}

/** Learning › Hints: the advice shown in lessons and in the workspace editor. Leads edit it. */
export default function HintsPage() {
  const canManage = usePermission('learning.manage')
  const { hash } = useLocation()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Hint | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Hint | null>(null)
  const hints = useQuery({ queryKey: learningKeys.hints, queryFn: learningApi.hints })
  const remove = useMutation({
    mutationFn: (hint: Hint) => learningApi.deleteHint(hint.id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: learningKeys.hints }); setDeleting(null) },
  })
  useEffect(() => {
    if (hash && hints.data) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'center' })
  }, [hash, hints.data])
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-fg-muted">The same advice appears in lessons and, when it applies to the open file, above the workspace editor.</p>
        {canManage && <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing('new')}>New hint</Button>}
      </div>
      {hints.isPending ? <Skeleton className="h-32" /> : hints.isError ? (
        <ErrorState title="Could not load the hints">{apiService.errorMessage(hints.error)}</ErrorState>
      ) : hints.data.length === 0 ? <Card><EmptyState icon={Lightbulb} title="No hints yet" /></Card> : (
        <ul className="flex flex-col gap-2" aria-label="Hints">
          {hints.data.map(hint => (
            <li key={hint.id} id={`hint-${hint.id}`}>
              <Card className={cn('space-y-1 p-4', hash === `#hint-${hint.id}` && 'ring-2 ring-accent')}>
                <div className="flex items-center gap-2">
                  <Lightbulb size={15} className="text-warning" aria-hidden />
                  <p className="flex-1 text-[13px] font-semibold text-fg">{hint.title}</p>
                  {canManage && <>
                    <IconButton size="sm" label={`Edit ${hint.title}`} icon={<Pencil size={13} />} onClick={() => setEditing(hint)} />
                    <IconButton size="sm" label={`Delete ${hint.title}`} icon={<Trash2 size={13} />} onClick={() => setDeleting(hint)} />
                  </>}
                </div>
                <p className="text-[13px] text-fg">{hint.text}</p>
                {hint.details && <p className="text-xs text-fg-muted">{hint.details}</p>}
                <div className="flex flex-wrap gap-1">
                  {hint.topics.length ? hint.topics.map(t => <Badge key={t}>{programName(t)}</Badge>) : <Badge>Every topic</Badge>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editing && <HintDialog hint={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={open => { if (!open) setDeleting(null) }} destructive title={`Delete ${deleting?.title ?? ''}?`}
        confirmLabel="Delete" loading={remove.isPending} description="Lessons and the workspace stop showing it (a standard rule falls back to its built-in text)."
        onConfirm={() => deleting && remove.mutate(deleting)} />
    </div>
  )
}
