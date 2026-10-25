import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { apiService } from '@/services/api'
import { Button, Dialog, ErrorState, IconButton, Input, Select, Textarea, useToast } from '@/ui'
import { PROGRAMS } from './content'
import { learningApi, learningKeys } from './api'
import type { LearningPath } from './paths'

const programName = (id: string) => PROGRAMS.find(p => p.id === id)?.name ?? id

/** Create or edit a learning path (leads, phase 21): its title, description and programs in the order to take them. */
export default function PathDialog({ path, onClose }: { path: LearningPath | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [title, setTitle] = useState(path?.title ?? '')
  const [description, setDescription] = useState(path?.description ?? '')
  const [programs, setPrograms] = useState<string[]>(path?.programs ?? [])
  const save = useMutation({
    mutationFn: () => learningApi.savePath({ title: title.trim(), description: description.trim(), programs }, path?.id),
    onSuccess: saved => {
      void queryClient.invalidateQueries({ queryKey: learningKeys.paths })
      toast({ title: path ? `Saved ${saved.title}` : `Created ${saved.title}`, tone: 'success' })
      onClose()
    },
  })
  const move = (index: number, by: number) => setPrograms(list => {
    const next = [...list]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item)
    return next
  })
  const available = PROGRAMS.filter(p => !programs.includes(p.id))
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }} title={path ? `Edit ${path.title}` : 'New learning path'} className="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!title.trim() || programs.length === 0} onClick={() => save.mutate()}>Save path</Button></>}>
      <div className="space-y-4">
        <Input label="Path title" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
        <Textarea label="Description" value={description} onChange={e => setDescription(e.target.value)} rows={2}
          help="One sentence: where the path takes a manual tester." />
        <div className="space-y-2">
          <p className="text-xs font-medium text-fg-muted">Programs, in the order to take them</p>
          {programs.length === 0 ? <p className="text-[13px] text-fg-muted">Add at least one program.</p> : (
            <ol className="space-y-1" aria-label="Programs of the path">
              {programs.map((id, index) => (
                <li key={id} className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[13px]">
                  <span className="w-5 text-xs text-fg-muted">{index + 1}.</span>
                  <span className="flex-1 text-fg">{programName(id)}</span>
                  <IconButton size="sm" label={`Move ${programName(id)} up`} icon={<ArrowUp size={13} />} disabled={index === 0} onClick={() => move(index, -1)} />
                  <IconButton size="sm" label={`Move ${programName(id)} down`} icon={<ArrowDown size={13} />} disabled={index === programs.length - 1} onClick={() => move(index, 1)} />
                  <IconButton size="sm" label={`Remove ${programName(id)}`} icon={<X size={13} />} onClick={() => setPrograms(list => list.filter(p => p !== id))} />
                </li>
              ))}
            </ol>
          )}
          {available.length > 0 && (
            <Select label="Add a program" value="" onChange={e => { const id = e.target.value; if (id) setPrograms(list => [...list, id]) }}>
              <option value="">Choose…</option>
              {available.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
          <p className="text-xs text-fg-muted">The lessons and quizzes of each program come with ATM; a path chooses which ones, and their order.</p>
        </div>
        {save.isError && <ErrorState title="Not saved">{apiService.errorMessage(save.error)}</ErrorState>}
      </div>
    </Dialog>
  )
}
