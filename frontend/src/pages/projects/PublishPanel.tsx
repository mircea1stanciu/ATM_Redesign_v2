import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, GitBranch, GitCommit, GitPullRequest, Loader2,
  Plus, Upload,
} from 'lucide-react'
import { apiService } from '@/services/api'
import type { Branch, LocalRepoStatus, PullRequestResult } from '@/types/domain'

interface PublishPanelProps {
  projectId: string
}

export default function PublishPanel({ projectId }: PublishPanelProps) {
  const [local, setLocal] = useState<LocalRepoStatus | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // Create-branch
  const [newBranch, setNewBranch] = useState('')
  const [creatingBranch, setCreatingBranch] = useState(false)
  // Commit
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  // Push
  const [pushing, setPushing] = useState(false)
  // PR
  const [prBase, setPrBase] = useState('')
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [creatingPr, setCreatingPr] = useState(false)
  const [pr, setPr] = useState<PullRequestResult | null>(null)

  const defaultBranch = useMemo(
    () => branches.find(b => b.is_default)?.name ?? 'main',
    [branches],
  )

  const loadState = useCallback(async () => {
    setLoading(true)
    try {
      const [l, b] = await Promise.all([
        apiService.getLocalRepoStatus(projectId).catch(() => null),
        apiService.listBranches(projectId).catch(() => [] as Branch[]),
      ])
      setLocal(l)
      setBranches(b)
      setPrBase(prev => prev || b.find(x => x.is_default)?.name || 'main')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void loadState()
  }, [loadState])

  const currentBranch = local?.current_branch ?? ''
  const localReady = !!local?.is_git_repo

  const createBranch = async () => {
    setCreatingBranch(true)
    setBanner(null)
    try {
      const status = await apiService.createLocalBranch(projectId, newBranch.trim())
      setLocal(status)
      setNewBranch('')
      setBanner({ kind: 'ok', text: `Created and switched to “${status.current_branch}”.` })
    } catch (e: unknown) {
      setBanner({ kind: 'err', text: apiService.errorMessage(e) })
    } finally {
      setCreatingBranch(false)
    }
  }

  const commit = async () => {
    setCommitting(true)
    setBanner(null)
    try {
      const status = await apiService.commitLocalChanges(projectId, commitMsg.trim())
      setLocal(status)
      setCommitMsg('')
      setBanner({ kind: 'ok', text: 'Changes committed locally.' })
    } catch (e: unknown) {
      setBanner({ kind: 'err', text: apiService.errorMessage(e) })
    } finally {
      setCommitting(false)
    }
  }

  const push = async () => {
    if (!window.confirm(`Push branch “${currentBranch}” to GitHub?`)) return
    setPushing(true)
    setBanner(null)
    try {
      const res = await apiService.pushLocalBranch(projectId)
      setLocal(res.status)
      setBanner({ kind: 'ok', text: `Pushed “${res.branch}” to GitHub.` })
      // Refresh remote branch list so the new branch shows up as a PR head.
      apiService.listBranches(projectId).then(setBranches).catch(() => {})
    } catch (e: unknown) {
      setBanner({ kind: 'err', text: apiService.errorMessage(e) })
    } finally {
      setPushing(false)
    }
  }

  const createPr = async () => {
    if (!window.confirm(`Open a pull request: ${currentBranch} → ${prBase}?`)) return
    setCreatingPr(true)
    setBanner(null)
    setPr(null)
    try {
      const result = await apiService.createPullRequest(projectId, {
        head: currentBranch,
        base: prBase,
        title: prTitle.trim(),
        body: prBody,
      })
      setPr(result)
      setBanner({ kind: 'ok', text: `Pull request #${result.number} created.` })
    } catch (e: unknown) {
      setBanner({ kind: 'err', text: apiService.errorMessage(e) })
    } finally {
      setCreatingPr(false)
    }
  }

  if (loading && !local) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-gray-400">
        <Loader2 size={18} className="animate-spin" /> Loading…
      </div>
    )
  }

  if (!localReady) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-gray-400">
        <GitPullRequest size={28} className="text-gray-300 dark:text-gray-600" />
        <p className="text-sm">No local checkout yet.</p>
        <p className="max-w-md text-xs">Clone the local copy from the 3-Panel tab, make your changes in the Editor, then come back to publish.</p>
      </div>
    )
  }

  const onDefault = currentBranch === defaultBranch
  const alreadyPushed = !!local?.has_upstream && (local?.ahead ?? 0) === 0

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col gap-3 overflow-y-auto pr-1">
      {/* Current state */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1 font-medium text-gray-700 dark:text-gray-200">
            <GitBranch size={13} /> {currentBranch || '—'}
          </span>
          {local?.dirty
            ? <span className="text-amber-500">● uncommitted changes</span>
            : <span className="text-emerald-500">✓ clean working tree</span>}
          {local?.last_commit && (
            <span className="truncate text-gray-400">
              {local.last_commit.sha.slice(0, 7)} · {local.last_commit.message}
            </span>
          )}
        </div>
      </div>

      {banner && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
          banner.kind === 'ok'
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
            : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
        }`}>
          {banner.kind === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          <span className="break-words">{banner.text}</span>
        </div>
      )}

      {/* Step 1: Create branch */}
      <Section icon={<Plus size={13} />} title="1 · Create a working branch" hint={onDefault ? 'You are on the default branch — create a branch before committing.' : undefined}>
        <div className="flex gap-2">
          <input
            value={newBranch}
            onChange={e => setNewBranch(e.target.value)}
            placeholder="feature/my-change"
            className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
          />
          <button
            onClick={() => void createBranch()}
            disabled={creatingBranch || !newBranch.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-900 disabled:opacity-40 dark:bg-gray-600 dark:hover:bg-gray-500"
          >
            {creatingBranch ? <Loader2 size={12} className="animate-spin" /> : <GitBranch size={12} />} Create
          </button>
        </div>
      </Section>

      {/* Step 2: Commit */}
      <Section icon={<GitCommit size={13} />} title="2 · Commit your changes" hint={!local?.dirty ? 'No uncommitted changes right now.' : undefined}>
        <div className="flex flex-col gap-2">
          <input
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            placeholder="Describe your change"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
          />
          <button
            onClick={() => void commit()}
            disabled={committing || !commitMsg.trim() || !local?.dirty}
            className="flex items-center justify-center gap-1.5 self-start rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-900 disabled:opacity-40 dark:bg-gray-600 dark:hover:bg-gray-500"
          >
            {committing ? <Loader2 size={12} className="animate-spin" /> : <GitCommit size={12} />} Commit all changes
          </button>
        </div>
      </Section>

      {/* Step 3: Push */}
      <Section
        icon={<Upload size={13} />}
        title="3 · Push to GitHub"
        hint={
          alreadyPushed
            ? 'Already pushed — no new commits to push.'
            : onDefault
              ? 'Pushing the default branch directly is usually not what you want.'
              : undefined
        }
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => void push()}
            disabled={pushing || alreadyPushed}
            title={alreadyPushed ? 'Nothing to push — branch is up to date with GitHub.' : undefined}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {pushing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            Push “{currentBranch}” to GitHub
          </button>
          {alreadyPushed && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
              <CheckCircle2 size={13} /> Pushed
            </span>
          )}
        </div>
      </Section>

      {/* Step 4: PR */}
      <Section icon={<GitPullRequest size={13} />} title="4 · Open a pull request">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="rounded bg-gray-100 px-2 py-1 font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200">{currentBranch}</span>
            <span>→</span>
            <select
              value={prBase}
              onChange={e => setPrBase(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            >
              {branches.map(b => (
                <option key={b.name} value={b.name}>{b.name}{b.is_default ? ' (default)' : ''}</option>
              ))}
              {branches.length === 0 && <option value="main">main</option>}
            </select>
          </div>
          <input
            value={prTitle}
            onChange={e => setPrTitle(e.target.value)}
            placeholder="Pull request title"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
          />
          <textarea
            value={prBody}
            onChange={e => setPrBody(e.target.value)}
            placeholder="Description (optional)"
            rows={3}
            className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
          />
          <button
            onClick={() => void createPr()}
            disabled={creatingPr || !prTitle.trim() || currentBranch === prBase}
            className="flex items-center gap-1.5 self-start rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {creatingPr ? <Loader2 size={12} className="animate-spin" /> : <GitPullRequest size={12} />}
            Create pull request
          </button>
          {pr && (
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              <GitPullRequest size={12} /> PR #{pr.number} — {pr.title} (open on GitHub)
            </a>
          )}
        </div>
      </Section>
    </div>
  )
}

function Section({ icon, title, hint, children }: {
  icon: React.ReactNode
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-gray-400">{icon}</span>
        <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">{title}</span>
      </div>
      {hint && <p className="mb-2 text-[11px] text-amber-500">{hint}</p>}
      {children}
    </div>
  )
}
