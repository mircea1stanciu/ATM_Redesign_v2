import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { GitBranchPlus } from 'lucide-react'
import { apiService } from '@/services/api'
import { Button, Dialog, ErrorState, Input, useToast } from '@/ui'
import { useRefreshWorkspace } from './queries'

/** A branch for work without a story (stories get theirs from Work › Start work). */
export default function NewBranchDialog({ open, onOpenChange, projectId, defaultBranch, onCreated }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  defaultBranch: string
  /** The checkout switched branch: open files must reload. */
  onCreated: () => void
}) {
  const toast = useToast()
  const refresh = useRefreshWorkspace(projectId)
  const [name, setName] = useState('feature/')
  const create = useMutation({
    mutationFn: () => apiService.createLocalBranch(projectId, name.trim(), defaultBranch),
    onSuccess: status => {
      void refresh()
      onCreated()
      toast({ title: `Switched to the new branch ${status.current_branch}`, tone: 'success' })
      onOpenChange(false)
    },
  })
  const valid = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+(?<!\/)$/.test(name.trim()) && name.trim() !== 'feature/'
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New branch"
      description={<>Created from <code>{defaultBranch}</code> in your checkout.</>}
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" icon={<GitBranchPlus size={14} />} loading={create.isPending} disabled={!valid}
            onClick={() => create.mutate()}>
            Create branch
          </Button>
        </>
      )}
    >
      <div className="space-y-3">
        <Input label="Branch name" value={name} onChange={e => setName(e.target.value)} autoFocus className="font-mono"
          help="For a story, use Work › Inbox › Start work: it names the branch after the story." />
        {create.isError && <ErrorState title="The branch was not created">{apiService.errorMessage(create.error)}</ErrorState>}
      </div>
    </Dialog>
  )
}
