import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, GitBranch, Loader2, RefreshCw } from 'lucide-react'
import { apiService } from '@/services/api'

type BranchInfo = Awaited<ReturnType<typeof apiService.getLocalBranches>>

/** Current branch of the linked checkout; switch to a local branch or to a GitHub branch (tracked locally). */
export default function BranchPicker({
  projectId,
  canEdit,
  onSwitched,
  confirmSwitch,
}: {
  projectId: string
  canEdit: boolean
  onSwitched: () => void
  /** Return false to cancel the switch (e.g. the user has unsaved edits). */
  confirmSwitch?: (branch: string) => boolean
}) {
  const [info, setInfo] = useState<BranchInfo | null>(null)
  const [busy, setBusy] = useState<'load' | 'fetch' | 'switch' | null>('load')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (fetch = false) => {
    setBusy(fetch ? 'fetch' : 'load')
    setError(null)
    try {
      const data = await apiService.getLocalBranches(projectId, fetch)
      setInfo(data)
      if (data.fetch_error) setError(`Could not refresh GitHub branches: ${data.fetch_error}`)
      return data
    } catch (e) {
      setError(apiService.errorMessage(e))
      return null
    } finally {
      setBusy(null)
    }
  }, [projectId])

  useEffect(() => {
    // Show the local state immediately, then refresh the GitHub branches in the background.
    void load().then(data => { if (data?.github_connected) void load(true) })
  }, [load])

  const switchTo = async (branch: string) => {
    if (!info || branch === info.current_branch) return
    if (confirmSwitch && !confirmSwitch(branch)) {
      setInfo({ ...info })
      return
    }
    setBusy('switch')
    setError(null)
    try {
      await apiService.checkoutLocalRepo(projectId, branch)
      await load()
      onSwitched()
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const local = info?.branches ?? []
  const remoteOnly = (info?.remote_branches ?? []).filter(b => !local.includes(b))

  return (
    <div className="min-w-0 space-y-0.5 text-[11px]">
      <div className="flex min-w-0 items-center gap-1.5">
        <GitBranch size={13} className="shrink-0 text-gray-400" />
        {info ? (
          <select
            value={info.current_branch ?? ''}
            onChange={e => void switchTo(e.target.value)}
            disabled={!canEdit || busy === 'switch'}
            className="form-input min-w-0 flex-1 !py-0.5 !pl-2 !pr-7 font-mono !text-[11px] !text-amber-700 dark:!text-amber-300"
            title={canEdit ? `${info.current_branch ?? 'detached'} — switch branch` : 'Viewers cannot switch branch'}
          >
            {!info.current_branch && <option value="">(detached)</option>}
            <optgroup label="Local">
              {local.map(b => <option key={b} value={b}>{b}</option>)}
            </optgroup>
            {remoteOnly.length > 0 && (
              <optgroup label="GitHub (origin)">
                {remoteOnly.map(b => <option key={`origin/${b}`} value={b}>origin/{b}</option>)}
              </optgroup>
            )}
          </select>
        ) : <span className="flex-1 text-gray-400">Loading branch…</span>}
        <button onClick={() => void load(Boolean(info?.github_connected))} disabled={busy !== null}
          className="shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          title={info?.github_connected ? 'Refresh branches from GitHub' : 'Refresh'}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>
      {info && (
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 pl-5 text-[10px] text-gray-500 dark:text-gray-400">
          <span className={info.dirty ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
            {info.dirty ? '• uncommitted changes' : '• committed'}
          </span>
          {info.has_upstream && (info.ahead > 0 || info.behind > 0) && (
            <span className="inline-flex items-center gap-0.5" title={`${info.ahead} commits to push, ${info.behind} to pull`}>
              {info.ahead > 0 && <><ArrowUp size={10} />{info.ahead}</>}
              {info.behind > 0 && <><ArrowDown size={10} />{info.behind}</>}
            </span>
          )}
          {info.last_commit && (
            <span className="min-w-0 truncate" title={`${info.last_commit.sha} · ${info.last_commit.author} · ${info.last_commit.date}`}>
              • {info.last_commit.sha.slice(0, 7)} {info.last_commit.message}
            </span>
          )}
        </p>
      )}
      {error && (
        <p className="pl-5 text-[10px] text-red-500 break-words">
          {error === 'Not Found' ? 'The backend does not have this feature yet: restart it.' : error}
        </p>
      )}
    </div>
  )
}
