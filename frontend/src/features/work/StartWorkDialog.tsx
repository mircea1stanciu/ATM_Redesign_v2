import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FilePlus2, Play } from 'lucide-react'
import { apiService } from '@/services/api'
import { usePermission } from '@/hooks/usePermission'
import { Button, Checkbox, Dialog, ErrorState, Input, Skeleton, useToast } from '@/ui'
import { workApi, workKeys } from './api'
import type { WorkSource } from './types'

/** feature/ABC-123-short-name, the same rule as the backend (app/modules/work/service.py). */
export function branchName(key: string, title: string): string {
  const slug = (title.toLowerCase().match(/[a-z0-9]+/g) ?? []).slice(0, 6).join('-').slice(0, 40).replace(/^-+|-+$/g, '')
  return slug ? `feature/${key}-${slug}` : `feature/${key}`
}

/**
 * "Start work": choose the tests to add or change (suggested from the checkout, or the project's suites), name the
 * branch, then ATM creates the work item and the branch and opens the workspace with the story attached.
 */
export default function StartWorkDialog({ open, onOpenChange, projectId, source, itemKey, title }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  source: WorkSource
  itemKey: string
  title: string
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const canWriteJira = usePermission('jira.write')
  const [branch, setBranch] = useState(() => branchName(itemKey, title))
  const [files, setFiles] = useState<string[]>([])
  const [suites, setSuites] = useState<string[]>([])
  const [comment, setComment] = useState(canWriteJira && source === 'jira')

  const suggestions = useQuery({
    queryKey: workKeys.suggestions(projectId, itemKey),
    queryFn: () => workApi.suggestions(projectId, itemKey, title),
    enabled: open,
  })

  const start = useMutation({
    mutationFn: () => workApi.startWork(projectId, {
      source,
      external_key: itemKey,
      branch: branch.trim(),
      comment_in_jira: comment,
      tests: [
        ...files.map(path => ({ type: 'test_file' as const, ref: path })),
        ...suites.map(id => ({
          type: 'suite' as const, ref: id, label: suggestions.data?.suites.find(s => s.id === id)?.name,
        })),
      ],
    }),
    onSuccess: item => {
      void queryClient.invalidateQueries({ queryKey: workKeys.all(projectId) })
      toast({
        title: `Started ${item.external_key} on ${item.branch}`,
        description: item.warning ?? undefined,
        tone: item.warning ? 'warning' : 'success',
      })
      onOpenChange(false)
      navigate(`/work/workspace?view=editor&item=${item.id}`)
    },
  })

  const toggle = (list: string[], value: string, set: (next: string[]) => void) =>
    set(list.includes(value) ? list.filter(v => v !== value) : [...list, value])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Start work on ${itemKey}`}
      description={title}
      className="max-w-lg"
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" icon={<Play size={14} />} loading={start.isPending}
            disabled={!branch.trim()} onClick={() => start.mutate()}>
            Start work
          </Button>
        </>
      )}
    >
      <div className="space-y-5">
        <section>
          <h3 className="mb-1 text-[13px] font-semibold text-fg">1 · Tests to add or change</h3>
          {suggestions.isPending ? <Skeleton className="h-16" /> : suggestions.isError ? (
            <ErrorState title="Could not suggest tests">{apiService.errorMessage(suggestions.error)}</ErrorState>
          ) : (
            <div className="space-y-3">
              {!suggestions.data.has_checkout && (
                <p className="text-xs text-warning">
                  No local checkout is linked for this project. Link one in Work › Repository; the branch is
                  created there.
                </p>
              )}
              {suggestions.data.test_files.length > 0 ? (
                <fieldset className="space-y-1.5">
                  <legend className="mb-1 text-xs text-fg-muted">Suggested test files (they share words with the story)</legend>
                  {suggestions.data.test_files.map(file => (
                    <Checkbox key={file.path} label={<span className="font-mono text-xs">{file.path}</span>}
                      checked={files.includes(file.path)} onChange={() => toggle(files, file.path, setFiles)} />
                  ))}
                </fieldset>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-fg-muted">
                  <FilePlus2 size={14} aria-hidden /> No matching test files: you will write a new test.
                </p>
              )}
              {suggestions.data.suites.length > 0 && (
                <fieldset className="space-y-1.5">
                  <legend className="mb-1 text-xs text-fg-muted">Suites to run</legend>
                  {suggestions.data.suites.map(suite => (
                    <Checkbox key={suite.id} label={suite.name} checked={suites.includes(suite.id)}
                      onChange={() => toggle(suites, suite.id, setSuites)} />
                  ))}
                </fieldset>
              )}
            </div>
          )}
        </section>
        <section className="space-y-3">
          <h3 className="text-[13px] font-semibold text-fg">2 · Branch</h3>
          <Input label="Branch name" value={branch} onChange={e => setBranch(e.target.value)}
            className="font-mono" help="Created from the default branch in your checkout." />
          {source === 'jira' && canWriteJira && (
            <Checkbox label={`Comment on ${itemKey} in Jira that work started`} checked={comment}
              onChange={e => setComment(e.target.checked)} />
          )}
        </section>
        {start.isError && <ErrorState title="Could not start work">{apiService.errorMessage(start.error)}</ErrorState>}
      </div>
    </Dialog>
  )
}
