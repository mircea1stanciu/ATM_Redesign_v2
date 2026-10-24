import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleDot, GitBranch, GitBranchPlus, GitPullRequest, PanelLeft, PanelRight, Play, Upload } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { usePermission } from '@/hooks/usePermission'
import { Button, StatusPill, Switch, Tooltip, cn } from '@/ui'
import { runDisplayName } from '@/utils/runName'
import type { WorkItem } from '@/features/work/types'
import CommitDialog from './CommitDialog'
import NewBranchDialog from './NewBranchDialog'
import PullRequestDialog from './PullRequestDialog'
import { useRepoStatus, useUncommitted } from './queries'
import RunChangedDrawer from './RunChangedDrawer'

const RUN_POLL_MS = 3000

function PaneToggle({ label, active, onClick, icon }: { label: string; active: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <Tooltip content={`${active ? 'Hide' : 'Show'} ${label.toLowerCase()}`}>
      <button type="button" aria-label={`${active ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-pressed={active} onClick={onClick}
        className={cn('flex h-7 w-7 items-center justify-center rounded-md', active ? 'bg-accent/10 text-accent' : 'text-fg-muted hover:bg-surface-2')}>
        {icon}
      </button>
    </Tooltip>
  )
}

/**
 * The workspace's bottom bar: branch and uncommitted files, Run changed tests, Commit & push, Open PR, and the
 * last run, always visible.
 */
export default function ActionBar({ projectId, workItem, layout, onLayoutChange, onBranchChanged }: {
  projectId: string
  /** The checkout switched branch from here (New branch): the editor reloads its files. */
  onBranchChanged: () => void
  workItem: WorkItem | null
  layout: { explorer: boolean; assistant: boolean; hints: boolean }
  onLayoutChange: (layout: { explorer: boolean; assistant: boolean; hints: boolean }) => void
}) {
  const status = useRepoStatus(projectId)
  const uncommitted = useUncommitted(projectId)
  const runs = useAppStore(s => s.runs)
  const refreshProjectData = useAppStore(s => s.refreshProjectData)
  const canRun = usePermission('run.execute')
  const canPush = usePermission('code.push')
  const canOpenPr = usePermission('pr.create')
  const [dialog, setDialog] = useState<'run' | 'branch' | 'commit' | 'pr' | null>(null)
  const defaultBranch = useAppStore(s => s.projects.find(p => p.id === projectId)?.default_branch) || 'main'

  const branch = status.data?.current_branch ?? ''
  const changed = uncommitted.data?.files.length ?? 0
  const email = useAppStore(s => s.user?.email)
  // My last run: the project's runs are shared with everyone, the workspace is mine.
  const lastRun = useMemo(
    () => runs.filter(r => r.triggered_by === email)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0],
    [runs, email],
  )
  const running = lastRun && ['running', 'pending'].includes(lastRun.status)

  // Keep the last run's status live while it runs.
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => void refreshProjectData(projectId), RUN_POLL_MS)
    return () => window.clearInterval(timer)
  }, [running, projectId, refreshProjectData])

  const onDefaultBranch = !branch || branch === defaultBranch

  return (
    <div role="toolbar" aria-label="Workspace actions"
      className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[13px]">
      <PaneToggle label="Explorer" active={layout.explorer} icon={<PanelLeft size={15} />}
        onClick={() => onLayoutChange({ ...layout, explorer: !layout.explorer })} />
      <span className="flex items-center gap-1 text-fg" title="Current branch">
        <GitBranch size={14} className="text-fg-muted" aria-hidden /><code className="text-xs">{branch || '—'}</code>
      </span>
      {canPush && (
        <Tooltip content="New branch">
          <button type="button" aria-label="New branch" onClick={() => setDialog('branch')}
            className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg">
            <GitBranchPlus size={14} />
          </button>
        </Tooltip>
      )}
      <span className={cn('flex items-center gap-1 text-xs', changed ? 'text-warning' : 'text-fg-muted')}>
        <CircleDot size={12} aria-hidden /> {changed} uncommitted
      </span>
      <span className="mx-1 h-5 w-px bg-line" />
      {canRun && (
        <Button size="sm" icon={<Play size={13} />} onClick={() => setDialog('run')}>Run changed tests</Button>
      )}
      {canPush && (
        <Button size="sm" icon={<Upload size={13} />} disabled={!branch} onClick={() => setDialog('commit')}>Commit &amp; push</Button>
      )}
      {canOpenPr && (
        <Tooltip content={onDefaultBranch ? 'Start work on a story (or create a branch) first' : 'Open a pull request from this branch'}>
          <span>
            <Button size="sm" icon={<GitPullRequest size={13} />} disabled={onDefaultBranch} onClick={() => setDialog('pr')}>Open PR</Button>
          </span>
        </Tooltip>
      )}
      <span className="flex-1" />
      {lastRun && (
        <Link to="?view=runs" className="flex min-w-0 items-center gap-2 text-xs text-fg-muted hover:text-fg" aria-label="Last run">
          <span className="truncate">{runDisplayName(lastRun)}</span>
          <StatusPill status={lastRun.status} />
          {lastRun.total_tests > 0 && <span>{lastRun.passed_tests}/{lastRun.total_tests}</span>}
        </Link>
      )}
      <span className="mx-1 h-5 w-px bg-line" />
      <div className="w-24"><Switch label="Hints" checked={layout.hints} onChange={hints => onLayoutChange({ ...layout, hints })} /></div>
      <PaneToggle label="Assistant" active={layout.assistant} icon={<PanelRight size={15} />}
        onClick={() => onLayoutChange({ ...layout, assistant: !layout.assistant })} />

      {dialog === 'run' && <RunChangedDrawer open onOpenChange={open => { if (!open) setDialog(null) }} projectId={projectId} />}
      {dialog === 'branch' && (
        <NewBranchDialog open onOpenChange={open => { if (!open) setDialog(null) }} projectId={projectId}
          defaultBranch={defaultBranch} onCreated={onBranchChanged} />
      )}
      {dialog === 'commit' && (
        <CommitDialog open onOpenChange={open => { if (!open) setDialog(null) }} projectId={projectId}
          status={status.data} workItem={workItem} />
      )}
      {dialog === 'pr' && (
        <PullRequestDialog open onOpenChange={open => { if (!open) setDialog(null) }} projectId={projectId}
          branch={branch} baseBranch={defaultBranch} workItem={workItem} />
      )}
    </div>
  )
}
