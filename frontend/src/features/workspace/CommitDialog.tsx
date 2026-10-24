import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { GitCommitHorizontal, Upload } from 'lucide-react'
import { apiService } from '@/services/api'
import { Badge, Button, Checkbox, Dialog, ErrorState, Input, useToast } from '@/ui'
import type { LocalRepoStatus } from '@/types/domain'
import type { WorkItem } from '@/features/work/types'
import { useRefreshWorkspace, useUncommitted } from './queries'

/** Commit the changed files and push the branch (trainees push only branches they started; the backend checks). */
export default function CommitDialog({ open, onOpenChange, projectId, status, workItem }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  status: LocalRepoStatus | undefined
  workItem: WorkItem | null
}) {
  const toast = useToast()
  const refresh = useRefreshWorkspace(projectId)
  const changes = useUncommitted(projectId)
  const files = changes.data?.files ?? []
  const [message, setMessage] = useState(workItem ? `${workItem.external_key}: ` : '')
  const [push, setPush] = useState(true)
  const branch = status?.current_branch ?? ''

  const run = useMutation({
    mutationFn: async () => {
      if (files.length) await apiService.commitLocalChanges(projectId, message.trim())
      return push ? apiService.pushLocalBranch(projectId, branch) : null
    },
    onSuccess: result => {
      void refresh()
      const linked = (result as { linked_tests?: number } | null)?.linked_tests ?? 0
      toast({
        title: result ? `Pushed ${branch}` : `Committed on ${branch}`,
        description: linked ? `${linked} test file${linked === 1 ? '' : 's'} linked to ${workItem?.external_key}.` : undefined,
        tone: 'success',
      })
      setMessage(workItem ? `${workItem.external_key}: ` : '')
      onOpenChange(false)
    },
  })

  const nothingToCommit = files.length === 0
  // Without new commits there is only something to push when the branch is ahead of GitHub or not there yet.
  const somethingToPush = Boolean(status?.ahead) || status?.has_upstream === false
  const canSubmit = nothingToCommit
    ? push && somethingToPush
    : message.trim().length > 0 && message.trim() !== `${workItem?.external_key}:`

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={nothingToCommit ? `Push ${branch}` : 'Commit & push'}
      description={<>On branch <code>{branch || '…'}</code></>}
      className="max-w-lg"
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={run.isPending} disabled={!canSubmit || !branch}
            icon={push ? <Upload size={14} /> : <GitCommitHorizontal size={14} />} onClick={() => run.mutate()}>
            {nothingToCommit ? 'Push' : push ? 'Commit & push' : 'Commit'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        {nothingToCommit ? (
          <p className="text-[13px] text-fg-muted">
            No uncommitted changes.{' '}
            {status?.ahead ? `${status.ahead} commit${status.ahead === 1 ? '' : 's'} not pushed yet.`
              : status?.has_upstream === false ? 'The branch is not on GitHub yet.' : 'Nothing to push either.'}
          </p>
        ) : (
          <>
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2" aria-label="Changed files">
              {files.map(file => (
                <li key={file.path} className="flex items-center gap-2 text-xs">
                  <Badge tone={file.status === 'deleted' ? 'danger' : file.status === 'added' ? 'success' : 'warning'}>{file.status}</Badge>
                  <code className="min-w-0 truncate text-fg">{file.path}</code>
                </li>
              ))}
            </ul>
            <Input label="Commit message" value={message} onChange={e => setMessage(e.target.value)} autoFocus
              placeholder="What changed and why" />
            <Checkbox label="Push to GitHub after the commit" checked={push} onChange={e => setPush(e.target.checked)} />
          </>
        )}
        {run.isError && <ErrorState title="Not done">{apiService.errorMessage(run.error)}</ErrorState>}
      </div>
    </Dialog>
  )
}
