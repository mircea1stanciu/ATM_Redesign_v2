import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle2, CircleDashed, Download, FolderGit2, Hammer, Loader2, PlayCircle, Rocket, Square, Trash2, X, XCircle,
} from 'lucide-react'
import { apiService } from '@/services/api'
import type { LocalRepoStatus, ScaffoldCatalog, ScaffoldInfo, ScaffoldVerifyJob } from '@/types/domain'

const TYPE_LABELS: Record<string, string> = {
  web: 'Web UI',
  mobile: 'Mobile',
  api: 'API',
  'keyword-driven': 'Keyword-driven',
  performance: 'Performance',
}

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'automation-project'
}

function StepIcon({ status }: { status: ScaffoldVerifyJob['steps'][number]['status'] }) {
  if (status === 'passed') return <CheckCircle2 size={13} className="text-emerald-500" />
  if (status === 'failed') return <XCircle size={13} className="text-rose-500" />
  if (status === 'running') return <Loader2 size={13} className="animate-spin text-blue-500" />
  if (status === 'cancelled') return <Square size={11} className="text-gray-400" />
  return <CircleDashed size={13} className="text-gray-300 dark:text-gray-600" />
}

type StarterOption = ScaffoldCatalog['frameworks'][number]['languages'][number]

/** Missing tools the user has to install; the others ATM downloads itself. */
function blockingTools(option: StarterOption) {
  return option.missing_tools.filter(t => !t.installable)
}

function AutoInstallNote({ option }: { option: StarterOption }) {
  const auto = option.missing_tools.filter(t => t.installable)
  if (!auto.length) return null
  return (
    <p className="flex items-start gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">
      <Download size={13} className="mt-0.5 shrink-0" />
      <span>
        <span className="font-mono">{auto.map(t => t.tool).join(', ')}</span> is not installed on this station.{' '}
        <b>Install &amp; run sample tests</b> downloads the official release from GitHub (checksum verified) into ATM's own
        tools folder first; no admin rights are needed.
      </span>
    </p>
  )
}

function CreateStarterModal({
  projectId,
  projectName,
  onClose,
  onCreated,
}: {
  projectId: string
  projectName: string
  onClose: () => void
  onCreated: (runCheck: boolean) => void
}) {
  const [catalog, setCatalog] = useState<ScaffoldCatalog | null>(null)
  const [framework, setFramework] = useState('')
  const [language, setLanguage] = useState('')
  const [path, setPath] = useState(`~/ATM Projects/${slugify(projectName)}`)
  const [runCheck, setRunCheck] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiService.getScaffoldCatalog(projectId).then(setCatalog).catch(e => setError(apiService.errorMessage(e)))
  }, [projectId])

  const selectedFramework = catalog?.frameworks.find(f => f.id === framework) ?? null
  const option = selectedFramework?.languages.find(l => l.language === language) ?? null
  const groups = useMemo(() => {
    const byType = new Map<string, ScaffoldCatalog['frameworks']>()
    for (const fw of catalog?.frameworks ?? []) byType.set(fw.type, [...(byType.get(fw.type) ?? []), fw])
    return [...byType.entries()]
  }, [catalog])

  const pickFramework = (id: string) => {
    setFramework(id)
    const fw = catalog?.frameworks.find(f => f.id === id)
    setLanguage(prev => (fw?.languages.some(l => l.language === prev) ? prev : fw?.languages[0]?.language ?? ''))
  }

  const create = async () => {
    if (!option || !path.trim()) return
    setCreating(true)
    setError(null)
    try {
      await apiService.createProjectScaffold(projectId, { framework, language, path: path.trim() })
      onCreated(runCheck && blockingTools(option).length === 0)
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !creating && onClose()}>
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Create a starter project</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Pick a framework and language. ATM generates a configured project with working sample tests in a
              local folder, so you can start implementing tests for your application right away.
            </p>
          </div>
          <button onClick={onClose} disabled={creating} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"><X size={16} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {!catalog && !error && (
            <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading templates…</div>
          )}

          {catalog && (
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">1 · Automation framework</p>
              <div className="space-y-3">
                {groups.map(([type, frameworks]) => (
                  <div key={type}>
                    <p className="mb-1.5 text-[11px] font-medium text-gray-400">{TYPE_LABELS[type] ?? type}</p>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {frameworks.map(fw => (
                        <button
                          key={fw.id}
                          onClick={() => pickFramework(fw.id)}
                          className={`rounded-xl border p-3 text-left transition ${framework === fw.id
                            ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500 dark:bg-blue-500/10'
                            : 'border-gray-200 hover:border-blue-300 dark:border-gray-700 dark:hover:border-blue-500/50'}`}
                        >
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">{fw.name}</p>
                          <p className="mt-0.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400">{fw.summary}</p>
                          <p className="mt-1.5 text-[10px] text-gray-400">{fw.languages.map(l => l.language_name).join(' · ')}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {selectedFramework && (
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">2 · Programming language</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(catalog?.languages ?? {}).map(([id, name]) => {
                  const available = selectedFramework.languages.some(l => l.language === id)
                  return (
                    <button
                      key={id}
                      onClick={() => available && setLanguage(id)}
                      disabled={!available}
                      title={available ? undefined : `${selectedFramework.name} is not available in ${name}`}
                      className={`rounded-full border px-4 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-35 ${language === id
                        ? 'border-blue-500 bg-blue-600 text-white'
                        : 'border-gray-200 text-gray-700 hover:border-blue-300 dark:border-gray-600 dark:text-gray-200'}`}
                    >
                      {name}
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {option && selectedFramework && (
            <section className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">3 · Folder on this station</p>
                <div>
                  <input value={path} onChange={e => setPath(e.target.value)} className="form-input font-mono !text-xs" placeholder="/absolute/path/to/folder" />
                  <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    Created if it doesn't exist. If it already contains files, the project goes into a
                    <span className="font-mono"> {slugify(projectName)}</span> subfolder. It becomes this project's local copy (a git
                    repository with a first commit) that you can push to GitHub later.
                  </p>
                </div>
                {blockingTools(option).length > 0 ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={13} /> Missing on this station</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {blockingTools(option).map(t => <li key={t.tool}><span className="font-mono">{t.tool}</span> – {t.hint}</li>)}
                    </ul>
                    <p className="mt-1">You can still create the project and run it once the tools are installed.</p>
                  </div>
                ) : (
                  <>
                    <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                      <input type="checkbox" checked={runCheck} onChange={e => setRunCheck(e.target.checked)} className="h-3.5 w-3.5 accent-blue-600" />
                      Install dependencies and run the sample tests right after creating it
                    </label>
                    <AutoInstallNote option={option} />
                  </>
                )}
                {option.note && <p className="text-[11px] text-gray-500 dark:text-gray-400">{option.note}</p>}
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                  {selectedFramework.name} · {option.language_name} — sample tests target {option.target}
                </p>
                <pre className="mt-2 max-h-40 overflow-auto text-[11px] leading-relaxed text-gray-700 dark:text-gray-300">{['README.md', ...option.files].sort().join('\n')}</pre>
                <p className="mt-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">Run it with</p>
                <pre className="mt-1 overflow-auto rounded bg-gray-900 p-2 text-[11px] text-gray-100">{option.run.join('\n')}</pre>
              </div>
            </section>
          )}

          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-700">
          <button onClick={onClose} disabled={creating} className="btn-ghost">Cancel</button>
          <button onClick={() => void create()} disabled={!option || !path.trim() || creating} className="btn-primary">
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />} Create project
          </button>
        </div>
      </div>
    </div>
  )
}

/** Overview card for projects without a GitHub repository: create a starter project or show the generated one. */
export default function StarterProjectCard({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [catalog, setCatalog] = useState<ScaffoldCatalog | null>(null)
  const [scaffold, setScaffold] = useState<ScaffoldInfo | null>(null)
  const [local, setLocal] = useState<LocalRepoStatus | null>(null)
  const [job, setJob] = useState<ScaffoldVerifyJob | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  const load = useCallback(async () => {
    try {
      const [info, status] = await Promise.all([
        apiService.getProjectScaffold(projectId),
        apiService.getLocalRepoStatus(projectId).catch(() => null),
      ])
      setScaffold(info.scaffold)
      setJob(info.verify)
      setLocal(status)
      if (info.scaffold) apiService.getScaffoldCatalog(projectId).then(setCatalog).catch(() => undefined)
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setLoaded(true)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  // Poll the running check, fetching only new log lines.
  useEffect(() => {
    if (!job || job.status !== 'running') return
    const timer = window.setTimeout(async () => {
      try {
        const next = await apiService.getScaffoldVerify(projectId, job.id, job.log_total)
        setJob(prev => (prev && prev.id === next.id ? { ...next, log: [...prev.log, ...next.log] } : next))
      } catch (e) {
        setError(apiService.errorMessage(e))
      }
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [job, projectId])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job?.log.length])

  // A finished check may have installed tools (k6): refresh what is missing on the station.
  const jobDone = !!job && job.status !== 'running'
  useEffect(() => {
    if (jobDone && scaffold) apiService.getScaffoldCatalog(projectId).then(setCatalog).catch(() => undefined)
  }, [jobDone, scaffold, projectId])

  const startCheck = async () => {
    setError(null)
    try {
      setJob(await apiService.startScaffoldVerify(projectId))
    } catch (e) {
      setError(apiService.errorMessage(e))
    }
  }

  const cancelCheck = async () => {
    if (!job) return
    try {
      const cancelled = await apiService.cancelScaffoldVerify(projectId, job.id)
      setJob(prev => (prev ? { ...cancelled, log: [...prev.log, ...cancelled.log.slice(-1)] } : cancelled))
    } catch (e) {
      setError(apiService.errorMessage(e))
    }
  }

  const deleteStarter = async () => {
    if (!scaffold) return
    const confirmed = window.confirm(
      `Permanently delete the starter project folder?\n\n${scaffold.path}\n\n`
      + 'Every file in it, including your own changes, is deleted from this station. '
      + 'It has not been pushed to a Git repository, so this cannot be undone.',
    )
    if (!confirmed) return
    setDeleting(true)
    setError(null)
    try {
      await apiService.deleteProjectScaffold(projectId)
      setJob(null)
      await load()
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setDeleting(false)
    }
  }

  const onCreated = async (runCheck: boolean) => {
    setShowCreate(false)
    await load()
    if (runCheck) await startCheck()
  }

  if (!loaded) return null

  const framework = catalog?.frameworks.find(f => f.id === scaffold?.framework)
  const option = framework?.languages.find(l => l.language === scaffold?.language)
  const blocking = option ? blockingTools(option) : []
  const managedTools = Object.entries(catalog?.managed_tools ?? {}).filter(([tool]) => option?.tools.includes(tool))

  // A local copy that wasn't generated here: nothing to offer.
  if (!scaffold && local?.is_git_repo) {
    return (
      <section className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <p className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white"><FolderGit2 size={15} /> Local copy</p>
        <p className="mt-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400" title={local.path}>{local.path}</p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Branch {local.current_branch}{local.dirty ? ' · uncommitted changes' : ''} ·{' '}
          <Link to="/work/workspace?view=three-panel" className="font-medium text-blue-600 hover:underline dark:text-blue-400">Manage</Link>
        </p>
      </section>
    )
  }

  return (
    <>
      {!scaffold ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Rocket size={22} className="mt-0.5 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">No repository yet? Start from a ready-made framework</p>
                <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
                  Generate a configured Playwright, Selenium, Cypress, Appium, Bruno, RestAssured… project in JavaScript,
                  Java or Python, with sample tests that already run. Push it to GitHub whenever you're ready.
                </p>
              </div>
            </div>
            <button onClick={() => setShowCreate(true)} className="btn-primary px-4 py-2 text-sm">
              <Rocket size={14} /> Create starter project
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
        </section>
      ) : (
        <section className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                <Hammer size={15} /> Starter project · {framework?.name ?? scaffold.framework} ({option?.language_name ?? scaffold.language})
              </p>
              <p className="mt-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400" title={scaffold.path}>{scaffold.path}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {local?.current_branch && <>Branch {local.current_branch}{local.dirty ? ' · uncommitted changes' : ''} · </>}
                {(scaffold.remotes?.length ?? 0) > 0 ? <>Pushed to {scaffold.remotes?.join(', ')} · </> : <>Local only (not in Git yet) · </>}
                Created {new Date(scaffold.created_at.endsWith('Z') ? scaffold.created_at : `${scaffold.created_at}Z`).toLocaleString()} ·{' '}
                <Link to="/work/workspace?view=editor" className="font-medium text-blue-600 hover:underline dark:text-blue-400">Open files</Link>
              </p>
            </div>
            <div className="flex items-center gap-2">
              {(scaffold.remotes?.length ?? 0) === 0 && (
                <button
                  onClick={() => void deleteStarter()}
                  disabled={deleting}
                  title="Delete the generated folder (only possible while it is not in a Git repository)"
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
                </button>
              )}
              {job?.status === 'running' ? (
                <button onClick={() => void cancelCheck()} className="btn-secondary px-3 py-1.5 text-xs"><Square size={11} /> Stop</button>
              ) : (
                <button onClick={() => void startCheck()} disabled={!!blocking.length} className="btn-primary px-3 py-1.5 text-xs"
                  title={blocking.length ? `Missing: ${blocking.map(t => t.tool).join(', ')}` : undefined}>
                  <PlayCircle size={13} /> {job ? 'Run again' : 'Install & run sample tests'}
                </button>
              )}
            </div>
          </div>

          {blocking.length > 0 && (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              Missing on this station: {blocking.map(t => `${t.tool} (${t.hint})`).join('; ')}
            </p>
          )}
          {option && job?.status !== 'running' && <div className="mt-3"><AutoInstallNote option={option} /></div>}

          {job && (
            <div className="mt-4 space-y-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                {job.steps.map(step => (
                  <span key={step.label} className="inline-flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
                    <StepIcon status={step.status} />{step.label}
                  </span>
                ))}
                <span className={`ml-auto font-semibold ${job.status === 'passed' ? 'text-emerald-600' : job.status === 'failed' ? 'text-rose-600' : 'text-gray-500'}`}>
                  {job.status === 'passed' ? 'Sample tests passed — the project is ready'
                    : job.status === 'failed' ? 'Check failed — see the output below'
                      : job.status === 'cancelled' ? 'Stopped' : 'Running…'}
                </span>
              </div>
              <pre ref={logRef} className="max-h-72 overflow-auto rounded-xl bg-gray-950 p-3 font-mono text-[11px] leading-relaxed text-gray-100">
                {job.log.join('\n') || 'Starting…'}
              </pre>
            </div>
          )}

          {option && (
            <div className="mt-4 grid gap-3 text-xs lg:grid-cols-2">
              <div>
                <p className="mb-1 font-medium text-gray-500 dark:text-gray-400">Run it yourself (in {scaffold.path.split(/[\\/]/).pop()})</p>
                <pre className="overflow-auto rounded-lg bg-gray-900 p-2 text-[11px] text-gray-100">{option.run.join('\n')}</pre>
                {managedTools.map(([tool, path]) => (
                  <p key={tool} className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    <span className="font-mono">{tool}</span> was installed by ATM at <span className="break-all font-mono">{path}</span>, which is
                    not on your PATH: use that full path in a terminal, or install {tool} yourself.
                  </p>
                ))}
              </div>
              <div className="space-y-1.5 text-gray-600 dark:text-gray-300">
                <p className="font-medium text-gray-500 dark:text-gray-400">Next steps</p>
                <p>1. Replace the sample tests (they target {option.target}) with tests for your application.</p>
                <p>2. Create an empty repository on GitHub, push this folder to it, then connect the repository above.</p>
                {option.note && <p className="text-gray-500 dark:text-gray-400">{option.note}</p>}
              </div>
            </div>
          )}
          {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
        </section>
      )}

      {showCreate && (
        <CreateStarterModal
          projectId={projectId}
          projectName={projectName}
          onClose={() => setShowCreate(false)}
          onCreated={runCheck => void onCreated(runCheck)}
        />
      )}
    </>
  )
}
