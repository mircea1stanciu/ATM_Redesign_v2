import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileDiff, GitBranch, Loader2, PlayCircle, RefreshCw } from 'lucide-react'
import { apiService } from '@/services/api'
import { useAppStore } from '@/store/useAppStore'
import type { FrameworkDetection, LocalChanges } from '@/types/domain'
import { findTargetForFile } from './FrameworkRunConfig'

type Scope = 'all' | 'uncommitted'

const STATUS_STYLE: Record<string, string> = {
  added: 'text-emerald-600 dark:text-emerald-400',
  modified: 'text-amber-600 dark:text-amber-400',
  deleted: 'text-rose-600 dark:text-rose-400 line-through',
  renamed: 'text-sky-600 dark:text-sky-400',
}
const STATUS_LETTER: Record<string, string> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' }

/**
 * "Test only new/modified features": the files changed in the linked checkout (uncommitted, plus the
 * commits of the current branch that are not on the base branch) and a run of only the matching tests —
 * the changed Bruno requests of a collection, or the changed test files of another framework.
 */
export default function ChangedTestsPanel({
  projectId,
  detection,
}: {
  projectId: string
  detection: FrameworkDetection | null
}) {
  const createBrunoSubsetRun = useAppStore(s => s.createBrunoSubsetRun)
  const createFrameworkRun = useAppStore(s => s.createFrameworkRun)
  const runEnvironment = useAppStore(s => s.runEnvironment)
  const [scope, setScope] = useState<Scope>(() => (localStorage.getItem('runs.changed.scope') as Scope) || 'all')
  const [base, setBase] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [data, setData] = useState<LocalChanges | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const [showFiles, setShowFiles] = useState(false)
  const [environments, setEnvironments] = useState<Record<string, string>>({})
  const [starting, setStarting] = useState<string | null>(null)

  useEffect(() => { localStorage.setItem('runs.changed.scope', scope) }, [scope])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await apiService.getLocalChanges(projectId, { base, committed: scope === 'all' }))
    } catch (e) {
      setData(null)
      setError(apiService.errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [projectId, base, scope])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    apiService.getLocalBranches(projectId).then(info => {
      setBranches([...new Set([...info.remote_branches.map(b => `origin/${b}`), ...info.branches])]
        .filter(b => b !== info.current_branch))
    }).catch(() => setBranches([]))
  }, [projectId])

  // Changed test files of other frameworks that are runnable targets on their own.
  const frameworkTargets = useMemo(() => {
    if (!data || !detection) return []
    const seen = new Set<string>()
    const targets: { frameworkId: string; targetId: string; label: string; path: string }[] = []
    for (const file of data.files) {
      if (file.status === 'deleted') continue
      const match = findTargetForFile(detection, file.path)
      if (!match || seen.has(match.targetId)) continue
      seen.add(match.targetId)
      const framework = detection.frameworks.find(f => f.id === match.frameworkId)
      const target = framework?.targets.find(t => t.id === match.targetId)
      targets.push({ ...match, path: file.path, label: `${framework?.name ?? 'Tests'}: ${target?.label ?? file.path}` })
    }
    return targets
  }, [data, detection])

  const environmentFor = (collection: string, options: string[]) =>
    environments[collection] ?? (options.includes(runEnvironment) ? runEnvironment : options[0] ?? '')

  const runBruno = async (group: LocalChanges['bruno'][number]) => {
    const environment = environmentFor(group.collection, group.environments)
    setStarting(group.collection)
    try {
      await createBrunoSubsetRun({
        collection: group.collection, environment, requests: group.requests,
        label: `Changed: ${group.collection} (${group.requests.length})`,
      })
    } finally {
      setStarting(null)
    }
  }

  const runTarget = async (target: { targetId: string; label: string }) => {
    setStarting(target.targetId)
    try {
      await createFrameworkRun({ target: target.targetId, label: `Changed · ${target.label}`, extraArgs: '' })
    } finally {
      setStarting(null)
    }
  }

  const uncommitted = data?.files.filter(f => f.scope === 'uncommitted').length ?? 0
  const committed = (data?.files.length ?? 0) - uncommitted
  const runnable = (data?.bruno.length ?? 0) + frameworkTargets.length

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/60 text-[11px] dark:border-blue-500/30 dark:bg-blue-500/5">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left font-semibold text-blue-700 dark:text-blue-300">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<FileDiff size={12} /> Test only new / modified
        {data && <span className="ml-auto font-normal text-gray-500 dark:text-gray-400">{data.files.length} files · {runnable} runnable</span>}
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-blue-100 px-2 py-1.5 dark:border-blue-500/20">
          <div className="flex flex-wrap items-center gap-1">
            <div className="flex overflow-hidden rounded border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800">
              <button onClick={() => setScope('all')} className={`px-1.5 py-0.5 ${scope === 'all' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300'}`}
                title="Uncommitted changes and the commits of this branch that are not on the base branch">Branch + uncommitted</button>
              <button onClick={() => setScope('uncommitted')} className={`px-1.5 py-0.5 ${scope === 'uncommitted' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300'}`}
                title="Only files changed since the last commit">Uncommitted</button>
            </div>
            <button onClick={() => void load()} disabled={loading} className="ml-auto rounded p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="Refresh">
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </button>
          </div>
          {scope === 'all' && (
            <label className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
              <GitBranch size={11} className="shrink-0" /> Compared with
              <select value={base} onChange={e => setBase(e.target.value)} className="form-input min-w-0 flex-1 !py-0.5 !pl-1.5 !pr-6 font-mono !text-[10px]">
                <option value="">{data?.base ? `${data.base} (default)` : 'default branch'}</option>
                {branches.filter(b => b !== data?.base).map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
          )}

          {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
          {data && !error && (
            <>
              <p className="text-gray-600 dark:text-gray-300">
                <b>{data.branch ?? 'detached'}</b>: {uncommitted} uncommitted
                {scope === 'all' && (data.base ? `, ${committed} committed since ${data.base}` : ' (no base branch to compare with)')}
                {data.truncated && ' — list truncated'}
              </p>
              {data.files.length > 0 && (
                <div>
                  <button onClick={() => setShowFiles(s => !s)} className="flex items-center gap-1 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
                    {showFiles ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Changed files
                  </button>
                  {showFiles && (
                    <ul className="mt-1 max-h-40 space-y-px overflow-y-auto rounded bg-white p-1 font-mono text-[10px] dark:bg-gray-900/40">
                      {data.files.map(f => (
                        <li key={f.path} className="flex items-center gap-1.5" title={`${f.status} · ${f.scope}`}>
                          <span className={`w-3 shrink-0 font-bold ${STATUS_STYLE[f.status]}`}>{STATUS_LETTER[f.status]}</span>
                          <span className={`min-w-0 truncate ${f.status === 'deleted' ? STATUS_STYLE.deleted : 'text-gray-700 dark:text-gray-200'}`}>{f.path}</span>
                          {f.scope === 'uncommitted' && <span className="ml-auto shrink-0 text-amber-500">●</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {data.bruno.map(group => {
                const environment = environmentFor(group.collection, group.environments)
                return (
                  <div key={group.collection} className="space-y-1 rounded border border-gray-200 bg-white p-1.5 dark:border-gray-700 dark:bg-gray-800">
                    <p className="font-semibold text-gray-800 dark:text-gray-100">Bruno · {group.collection}</p>
                    <p className="truncate font-mono text-[10px] text-gray-500 dark:text-gray-400" title={group.requests.join('\n')}>
                      {group.requests.includes('.') ? 'whole collection (collection.bru changed)' : group.requests.join(', ')}
                    </p>
                    {group.environments_changed.length > 0 && (
                      <p className="text-[10px] text-amber-700 dark:text-amber-300">Environment changed: {group.environments_changed.join(', ')}</p>
                    )}
                    <div className="flex items-center gap-1">
                      <select value={environment} onChange={e => setEnvironments(v => ({ ...v, [group.collection]: e.target.value }))}
                        className="form-input min-w-0 flex-1 !py-0.5 !pl-1.5 !pr-6 !text-[10px]">
                        {group.environments.length === 0 && <option value="">No environments</option>}
                        {group.environments.map(env => <option key={env} value={env}>{env}</option>)}
                      </select>
                      <button onClick={() => void runBruno(group)} disabled={!environment || starting !== null}
                        className="btn-primary shrink-0 !px-2 !py-0.5 text-[10px]">
                        {starting === group.collection ? <Loader2 size={11} className="animate-spin" /> : <PlayCircle size={11} />}
                        Run {group.requests.includes('.') ? 'all' : group.requests.length}
                      </button>
                    </div>
                  </div>
                )
              })}

              {frameworkTargets.map(target => (
                <div key={target.targetId} className="flex items-center gap-1 rounded border border-gray-200 bg-white p-1.5 dark:border-gray-700 dark:bg-gray-800">
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-gray-700 dark:text-gray-200" title={target.path}>{target.label}</span>
                  <button onClick={() => void runTarget(target)} disabled={starting !== null} className="btn-primary shrink-0 !px-2 !py-0.5 text-[10px]">
                    {starting === target.targetId ? <Loader2 size={11} className="animate-spin" /> : <PlayCircle size={11} />} Run
                  </button>
                </div>
              ))}

              {data.files.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400">No new or modified files{scope === 'all' && data.base ? ` compared with ${data.base}` : ''}.</p>
              ) : runnable === 0 && (
                <p className="text-gray-500 dark:text-gray-400">None of the changed files is a test that can run on its own (Bruno requests, test files or test classes).</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
