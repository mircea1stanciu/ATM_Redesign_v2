import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FolderInput, FolderOpen, GitBranch, Github, HardDrive, Loader2, RefreshCw, Trash2, X } from 'lucide-react'
import { apiService } from '@/services/api'
import type { Branch, GitHubCommitInfo, GitHubTreeItem, LocalFolderInspection, LocalRepoStatus } from '@/types/domain'
import RepoTreePanel from './RepoTreePanel'

interface ParallelRepoViewProps {
  projectId: string
}

/** Modal for entering an absolute server-side folder path (import or link-existing). */
function LocalPathModal({
  projectId,
  mode,
  submitting,
  error,
  branches,
  defaultBranch,
  branchesError,
  onSubmit,
  onClose,
}: {
  projectId: string
  mode: 'import' | 'existing'
  submitting: boolean
  error: string | null
  branches: Branch[]
  defaultBranch: string
  branchesError: string | null
  onSubmit: (path: string, branch: string) => void
  onClose: () => void
}) {
  const [path, setPath] = useState('')
  // Import: empty value = clone the repository's default branch.
  // Existing: the local branch to check out (defaults to the current one).
  const [branch, setBranch] = useState('')
  const sortedBranches = useMemo(
    () => [...branches].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name)),
    [branches],
  )

  // "Existing project": inspect the folder as the user types (debounced).
  const [inspection, setInspection] = useState<LocalFolderInspection | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [inspectError, setInspectError] = useState<string | null>(null)
  useEffect(() => {
    if (mode !== 'existing') return
    const value = path.trim()
    setInspection(null)
    setInspectError(null)
    if (!value) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setInspecting(true)
      try {
        const info = await apiService.inspectLocalFolder(projectId, value)
        if (cancelled) return
        setInspection(info)
        setBranch(info.current_branch || '')
      } catch (e: unknown) {
        if (!cancelled) setInspectError(apiService.errorMessage(e))
      } finally {
        if (!cancelled) setInspecting(false)
      }
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [mode, path, projectId])

  const existingReady = !!inspection && !inspection.error
  const switchingBranch = existingReady && !!branch && branch !== inspection?.current_branch
  const canSubmit = !submitting && !!path.trim() && (mode === 'import' || (existingReady && !inspecting))
  const submit = () => {
    if (!canSubmit) return
    if (mode === 'import') onSubmit(path.trim(), branch || (branches.length ? defaultBranch : ''))
    else onSubmit(path.trim(), branch)
  }

  const inputClass = 'w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl dark:bg-gray-800">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            {mode === 'import' ? 'Import new project' : 'Existing project'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X size={16} />
          </button>
        </div>
        <p className="mb-3 text-[11px] text-gray-500 dark:text-gray-400">
          {mode === 'import'
            ? 'The selected branch is cloned into this folder on the server; the folder is created if it doesn\'t exist. If the folder already contains other files, the copy goes into a subfolder named after the repository. If it is already a checkout of this repository, the branch is fetched and checked out. Once saved, this project always reopens from this path.'
            : 'Point this project at a folder that is already cloned on the server and pick which of its local branches to use. Its "origin" remote must match this project\'s GitHub repository. Once saved, this project always reopens from this path.'}
        </p>
        <label className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-300">
          Folder path
        </label>
        <input
          autoFocus
          value={path}
          onChange={e => setPath(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="/absolute/path/to/folder"
          className={`mb-1 ${inputClass}`}
        />
        <p className="mb-3 text-[10px] text-gray-400">Spaces can be typed as-is or escaped (e.g. <span className="font-mono">Mircea\ stuff</span>).</p>

        {mode === 'import' && (
          <>
            <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-gray-600 dark:text-gray-300">
              <GitBranch size={11} /> Branch
            </label>
            <select value={branch} onChange={e => setBranch(e.target.value)} className={`mb-1 ${inputClass}`}>
              <option value="">Default branch ({defaultBranch})</option>
              {sortedBranches.filter(b => !b.is_default).map(b => (
                <option key={b.name} value={b.name}>{b.name}</option>
              ))}
            </select>
            <p className="mb-3 text-[10px] text-gray-400">
              {branchesError
                ? `Could not load branches from GitHub: ${branchesError}`
                : `${branches.length} branch${branches.length === 1 ? '' : 'es'} in the connected repository`}
            </p>
          </>
        )}

        {mode === 'existing' && path.trim() && (
          <div className="mb-3 space-y-2">
            {inspecting && (
              <p className="flex items-center gap-1 text-[11px] text-gray-500"><Loader2 size={11} className="animate-spin" /> Checking folder…</p>
            )}
            {!inspecting && (inspectError || inspection?.error) && (
              <p className="flex items-start gap-1 text-[11px] text-red-500 break-words">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />{inspectError || inspection?.error}
              </p>
            )}
            {!inspecting && existingReady && inspection && (
              <>
                <p className="flex items-start gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 break-all">
                  <CheckCircle2 size={11} className="mt-0.5 shrink-0" />Git checkout of {inspection.origin}
                </p>
                <div>
                  <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-gray-600 dark:text-gray-300">
                    <GitBranch size={11} /> Local branch
                  </label>
                  <select value={branch} onChange={e => setBranch(e.target.value)} className={inputClass}>
                    {inspection.branches.map(b => (
                      <option key={b} value={b}>{b}{b === inspection.current_branch ? ' (current)' : ''}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-gray-400">
                    {inspection.branches.length} local branch{inspection.branches.length === 1 ? '' : 'es'}, most recently committed first
                  </p>
                </div>
                {switchingBranch && inspection.dirty && (
                  <p className="flex items-start gap-1 text-[11px] text-amber-600">
                    <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                    The folder has uncommitted changes; switching branches fails if they conflict.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {error && <p className="mb-3 text-[11px] text-red-500 break-words">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {submitting && <Loader2 size={11} className="animate-spin" />}
            {mode === 'import'
              ? (submitting ? 'Cloning…' : 'Clone here')
              : (switchingBranch ? `Link and switch to ${branch}` : 'Link folder')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ParallelRepoView({ projectId }: ParallelRepoViewProps) {
  // Shared branch list (for panel A default + panel B selector).
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchesError, setBranchesError] = useState<string | null>(null)
  const [selectedBranch, setSelectedBranch] = useState('')

  // GitHub main-branch commit info (panel A).
  const [mainCommit, setMainCommit] = useState<GitHubCommitInfo | null>(null)
  const [mainCommitError, setMainCommitError] = useState<string | null>(null)

  // Local copy state.
  const [local, setLocal] = useState<LocalRepoStatus | null>(null)
  const [localLoading, setLocalLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [localReloadKey, setLocalReloadKey] = useState(0)

  // "Import new project" / "Existing project" modal.
  const [pathModalMode, setPathModalMode] = useState<'import' | 'existing' | null>(null)
  const [pathModalSubmitting, setPathModalSubmitting] = useState(false)
  const [pathModalError, setPathModalError] = useState<string | null>(null)

  const defaultBranch = useMemo(
    () => branches.find(b => b.is_default)?.name ?? branches[0]?.name ?? 'main',
    [branches],
  )

  const loadBranches = useCallback(async () => {
    setBranchesError(null)
    try {
      const list = await apiService.listBranches(projectId)
      setBranches(list)
      setSelectedBranch(prev => prev || list.find(b => !b.is_default)?.name || list[0]?.name || '')
    } catch (e: unknown) {
      setBranchesError(apiService.errorMessage(e))
    }
  }, [projectId])

  const loadLocalStatus = useCallback(async () => {
    setLocalLoading(true)
    setLocalError(null)
    try {
      setLocal(await apiService.getLocalRepoStatus(projectId))
    } catch (e: unknown) {
      setLocalError(apiService.errorMessage(e))
    } finally {
      setLocalLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void loadBranches()
    void loadLocalStatus()
  }, [loadBranches, loadLocalStatus])

  useEffect(() => {
    if (!defaultBranch) return
    setMainCommitError(null)
    apiService
      .getGitHubCommit(projectId, defaultBranch)
      .then(setMainCommit)
      .catch((e: unknown) => setMainCommitError(apiService.errorMessage(e)))
  }, [projectId, defaultBranch])

  const handleSync = async () => {
    setSyncing(true)
    setLocalError(null)
    try {
      // "Sync" only re-reads the already-imported project from local disk
      // (git status + file tree) — it never fetches/pulls from GitHub.
      const status = await apiService.getLocalRepoStatus(projectId)
      setLocal(status)
      setLocalReloadKey(k => k + 1)
    } catch (e: unknown) {
      setLocalError(apiService.errorMessage(e))
    } finally {
      setSyncing(false)
    }
  }

  const handleRemove = async () => {
    if (!window.confirm('Remove this local copy? If it was linked from an existing folder, the folder itself is kept — only the association is removed.')) {
      return
    }
    setRemoving(true)
    setLocalError(null)
    try {
      await apiService.deleteLocalRepo(projectId)
      setLocal(null)
      setLocalReloadKey(k => k + 1)
    } catch (e: unknown) {
      setLocalError(apiService.errorMessage(e))
    } finally {
      setRemoving(false)
    }
  }

  const handlePathModalSubmit = async (path: string, branch: string) => {
    if (!pathModalMode) return
    setPathModalSubmitting(true)
    setPathModalError(null)
    try {
      const status =
        pathModalMode === 'import'
          ? await apiService.importLocalRepo(projectId, path, branch || undefined)
          : await apiService.linkExistingLocalRepo(projectId, path, branch || undefined)
      setLocal(status)
      setLocalError(null)
      setLocalReloadKey(k => k + 1)
      setPathModalMode(null)
    } catch (e: unknown) {
      setPathModalError(apiService.errorMessage(e))
    } finally {
      setPathModalSubmitting(false)
    }
  }

  // Loaders passed to each panel.
  const loadMainTree = useCallback(
    (path: string): Promise<GitHubTreeItem[]> => apiService.getProjectRepoTree(projectId, path, defaultBranch),
    [projectId, defaultBranch],
  )
  const loadBranchTree = useCallback(
    (path: string): Promise<GitHubTreeItem[]> => apiService.getProjectRepoTree(projectId, path, selectedBranch),
    [projectId, selectedBranch],
  )
  const loadLocalTree = useCallback(
    (path: string): Promise<GitHubTreeItem[]> => apiService.getLocalRepoTree(projectId, path),
    [projectId],
  )

  const localReady = !!local?.is_git_repo

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-3">
      {/* Panel A — GitHub main */}
      <RepoTreePanel
        title={`GitHub · ${defaultBranch} (main)`}
        icon={<Github size={14} />}
        accentClassName="text-gray-700 dark:text-gray-200"
        headerControls={
          <div className="text-[10px] text-gray-500 dark:text-gray-400">
            {mainCommitError ? (
              <span className="text-red-500 break-words">{mainCommitError}</span>
            ) : mainCommit ? (
              <span className="flex flex-wrap items-center gap-x-2">
                <span className="inline-flex items-center gap-1"><GitBranch size={10} /> {defaultBranch}</span>
                <span className="truncate">• {mainCommit.sha.slice(0, 7)} {mainCommit.message}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Loading…</span>
            )}
          </div>
        }
        loadTree={loadMainTree}
        reloadKey={`main:${defaultBranch}`}
        disabled={!!branchesError}
        disabledMessage={branchesError ?? 'Connect GitHub to browse the main branch.'}
      />

      {/* Panel B — GitHub selected branch */}
      <RepoTreePanel
        title="GitHub · branch"
        icon={<GitBranch size={14} />}
        accentClassName="text-purple-500"
        headerControls={
          <select
            value={selectedBranch}
            onChange={e => setSelectedBranch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
          >
            {branches.length === 0 && <option value="">No branches</option>}
            {branches.map(b => (
              <option key={b.name} value={b.name}>
                {b.name}{b.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>
        }
        loadTree={loadBranchTree}
        reloadKey={`branch:${selectedBranch}`}
        disabled={!!branchesError || !selectedBranch}
        disabledMessage={branchesError ?? 'Select a branch to browse.'}
      />

      {/* Panel C — Local copy */}
      <RepoTreePanel
        title="Local copy"
        icon={<HardDrive size={14} />}
        accentClassName="text-emerald-500"
        headerActions={
          localReady ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => void handleSync()}
                disabled={syncing || localLoading || removing}
                title="Refresh from local disk to see recent changes"
                className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              >
                {syncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                Sync
              </button>
              <button
                onClick={() => void handleRemove()}
                disabled={syncing || localLoading || removing}
                title="Remove this local copy and choose a different one"
                className="flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-900 dark:bg-gray-700 dark:text-red-400 dark:hover:bg-gray-600"
              >
                {removing ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                Remove
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setPathModalError(null); setPathModalMode('import') }}
                disabled={localLoading}
                title="Clone the GitHub repository into a new local folder"
                className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              >
                <FolderInput size={11} />
                Import new project
              </button>
              <button
                onClick={() => { setPathModalError(null); setPathModalMode('existing') }}
                disabled={localLoading}
                title="Use an already-cloned folder on the server"
                className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              >
                <FolderOpen size={11} />
                Existing project
              </button>
            </div>
          )
        }
        headerControls={
          <div className="text-[10px] text-gray-500 dark:text-gray-400">
            {localLoading ? (
              <span className="flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Checking…</span>
            ) : localError ? (
              <span className="text-red-500 break-words">{localError}</span>
            ) : localReady ? (
              <span className="flex flex-wrap items-center gap-x-2">
                <span className="inline-flex items-center gap-1"><GitBranch size={10} /> {local?.current_branch}</span>
                {local?.dirty && <span className="text-amber-500">• uncommitted changes</span>}
                {local?.last_commit && <span className="truncate">• {local.last_commit.sha.slice(0, 7)} {local.last_commit.message}</span>}
              </span>
            ) : (
              <span>Not set up yet — choose “Import new project” or “Existing project”.</span>
            )}
          </div>
        }
        loadTree={loadLocalTree}
        reloadKey={`local:${localReloadKey}`}
        disabled={!localReady}
        disabledMessage={
          localError
            ? localError
            : 'No local checkout yet. Choose “Import new project” or “Existing project” above.'
        }
      />

      {pathModalMode && (
        <LocalPathModal
          projectId={projectId}
          mode={pathModalMode}
          submitting={pathModalSubmitting}
          error={pathModalError}
          branches={branches}
          defaultBranch={defaultBranch}
          branchesError={branchesError}
          onSubmit={(path, branch) => void handlePathModalSubmit(path, branch)}
          onClose={() => (pathModalSubmitting ? null : setPathModalMode(null))}
        />
      )}
    </div>
  )
}
