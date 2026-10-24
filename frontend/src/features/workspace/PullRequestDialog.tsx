import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { GitPullRequest } from 'lucide-react'
import { apiService } from '@/services/api'
import { usePermission } from '@/hooks/usePermission'
import { Button, Checkbox, Dialog, ErrorState, Input, Textarea, useToast } from '@/ui'
import { workApi, workKeys } from '@/features/work/api'
import type { WorkItem } from '@/features/work/types'

function defaultBody(item: WorkItem | null): string {
  if (!item) return ''
  const tests = (item.links ?? []).filter(link => link.target_type === 'test_file').map(link => `- ${link.target_ref}`)
  return [
    `${item.external_key}: ${item.title}`,
    item.url ? `Story: ${item.url}` : '',
    tests.length ? `\nTests:\n${tests.join('\n')}` : '',
  ].filter(Boolean).join('\n')
}

/** Open a pull request from the current branch; the work item of the branch links to it in ATM (and in Jira). */
export default function PullRequestDialog({ open, onOpenChange, projectId, branch, baseBranch, workItem }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  branch: string
  baseBranch: string
  workItem: WorkItem | null
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const canWriteJira = usePermission('jira.write')
  const [title, setTitle] = useState(workItem ? `${workItem.external_key} ${workItem.title}` : '')
  const [body, setBody] = useState(() => defaultBody(workItem))
  const [base, setBase] = useState(baseBranch)
  const [draft, setDraft] = useState(false)
  const offerJira = Boolean(workItem && workItem.source === 'jira' && canWriteJira)
  const [linkInJira, setLinkInJira] = useState(offerJira)

  const create = useMutation({
    mutationFn: async () => {
      const pr = await apiService.createPullRequest(projectId, { head: branch, base: base.trim(), title: title.trim(), body, draft })
      let jiraError: string | null = null
      if (linkInJira && workItem) {
        try {
          await workApi.remoteLink(projectId, workItem.id, pr.url, `Pull request #${pr.number}`)
        } catch (error) {
          jiraError = apiService.errorMessage(error)
        }
      }
      return { pr, jiraError }
    },
    onSuccess: ({ pr, jiraError }) => {
      void queryClient.invalidateQueries({ queryKey: workKeys.all(projectId) })
      toast({
        title: `Opened pull request #${pr.number}`,
        description: jiraError ? `The Jira link failed: ${jiraError}` : workItem ? `Linked to ${workItem.external_key}.` : undefined,
        tone: jiraError ? 'warning' : 'success',
        action: { label: 'Open on GitHub', onClick: () => window.open(pr.url, '_blank', 'noopener') },
      })
      onOpenChange(false)
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Open a pull request"
      description={<>From <code>{branch}</code></>}
      className="max-w-lg"
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" icon={<GitPullRequest size={14} />} loading={create.isPending}
            disabled={!title.trim() || !base.trim()} onClick={() => create.mutate()}>
            Open pull request
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Input label="Title" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
        <Input label="Into branch" value={base} onChange={e => setBase(e.target.value)} className="font-mono" />
        <Textarea label="Description" rows={5} value={body} onChange={e => setBody(e.target.value)} />
        <Checkbox label="Draft (not ready for review yet)" checked={draft} onChange={e => setDraft(e.target.checked)} />
        {offerJira && (
          <Checkbox label={`Link the pull request on ${workItem?.external_key} in Jira`} checked={linkInJira}
            onChange={e => setLinkInJira(e.target.checked)} />
        )}
        {create.isError && <ErrorState title="The pull request was not opened">{apiService.errorMessage(create.error)}</ErrorState>}
      </div>
    </Dialog>
  )
}
