import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2, ChevronDown, ChevronRight, Loader2, Pencil, Play, RefreshCw, Terminal, XCircle,
} from 'lucide-react'
import { apiService } from '@/services/api'
import type { LocalScript, LocalScriptRunResult } from '@/types/domain'

interface LocalScriptsPanelProps {
  projectId: string
}

/** Modal for entering a script's detected "Usage:" variables (positional args / flags). */
function ScriptConfigModal({
  script,
  submitting,
  error,
  onSave,
  onClose,
}: {
  script: LocalScript
  submitting: boolean
  error: string | null
  onSave: (values: Record<string, string | boolean>) => void
  onClose: () => void
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() => ({ ...script.config_values }))

  const setValue = (name: string, value: string | boolean) => {
    setValues(prev => ({ ...prev, [name]: value }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white p-4 shadow-xl dark:bg-gray-800">
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Configure {script.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <XCircle size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {script.usage && (
            <pre className="mb-3 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-100 p-2 font-mono text-[10.5px] text-gray-600 dark:bg-gray-900 dark:text-gray-300">
              {script.usage}
            </pre>
          )}
          {script.example && (
            <div className="mb-3">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Example</span>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-blue-100 bg-blue-50 p-3 font-mono text-[10.5px] leading-relaxed text-blue-800 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
                {script.example}
              </pre>
            </div>
          )}
          <div className="space-y-3">
            {script.params.map(p => (
              <div key={`${p.type}:${p.name}`}>
                {p.value_type === 'boolean' ? (
                  <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={Boolean(values[p.name])}
                      onChange={e => setValue(p.name, e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-gray-300"
                    />
                    <span className="font-mono">--{p.name}</span>
                    {p.required && <span className="text-red-500">*</span>}
                  </label>
                ) : (
                  <>
                    <label className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-300">
                      {p.type === 'flag' ? <span className="font-mono">--{p.name}</span> : p.name}
                      {p.required && <span className="text-red-500"> *</span>}
                    </label>
                    <input
                      value={typeof values[p.name] === 'string' ? (values[p.name] as string) : ''}
                      onChange={e => setValue(p.name, e.target.value)}
                      placeholder={p.type === 'positional' ? p.name : `Value for --${p.name}`}
                      className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    />
                  </>
                )}
              </div>
            ))}
            {script.params.length === 0 && (
              <p className="text-xs text-gray-400">No variables detected for this script.</p>
            )}
          </div>
        </div>
        {error && <p className="mb-3 text-[11px] text-red-500 break-words">{error}</p>}
        <div className="mt-3 flex shrink-0 justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(values)}
            disabled={submitting}
            className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {submitting && <Loader2 size={11} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

const TYPE_LABELS: Record<LocalScript['type'], string> = {
  npm: 'package.json scripts',
  make: 'Makefile targets',
  pytest: 'pytest',
  shell: 'Shell scripts (.sh)',
  python: 'Python files (.py)',
  node: 'JavaScript files (.js)',
  typescript: 'TypeScript files (.ts)',
}

const TYPE_ORDER: LocalScript['type'][] = ['npm', 'make', 'pytest', 'shell', 'python', 'node', 'typescript']

const TYPE_BADGE: Record<LocalScript['type'], string> = {
  npm: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  make: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  pytest: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  shell: 'bg-gray-200 text-gray-700 dark:bg-gray-600/40 dark:text-gray-200',
  python: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  node: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300',
  typescript: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
}

const SCRIPTS_SPLIT_STORAGE_KEY = 'projects.scripts.leftPanelWidth'

export default function LocalScriptsPanel({ projectId }: LocalScriptsPanelProps) {
  const [scripts, setScripts] = useState<LocalScript[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const [runningId, setRunningId] = useState<string | null>(null)
  const [result, setResult] = useState<LocalScriptRunResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const [configScript, setConfigScript] = useState<LocalScript | null>(null)
  const [configSubmitting, setConfigSubmitting] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return 34
    const raw = Number(window.localStorage.getItem(SCRIPTS_SPLIT_STORAGE_KEY) || '')
    return Number.isFinite(raw) ? Math.min(70, Math.max(20, raw)) : 34
  })
  const [isResizing, setIsResizing] = useState(false)
  const panelsRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setScripts(await apiService.getLocalScripts(projectId))
    } catch (e: unknown) {
      setError(apiService.errorMessage(e))
      setScripts([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  const grouped = useMemo(() => {
    const map = new Map<LocalScript['type'], LocalScript[]>()
    for (const s of scripts) {
      const arr = map.get(s.type) ?? []
      arr.push(s)
      map.set(s.type, arr)
    }
    return TYPE_ORDER.filter(t => map.has(t)).map(t => ({ type: t, items: map.get(t)! }))
  }, [scripts])

  const run = useCallback(async (script: LocalScript) => {
    setRunningId(script.id)
    setRunError(null)
    setResult(null)
    try {
      setResult(await apiService.runLocalScript(projectId, script.id))
    } catch (e: unknown) {
      setRunError(apiService.errorMessage(e))
    } finally {
      setRunningId(null)
    }
  }, [projectId])

  const saveConfig = useCallback(async (values: Record<string, string | boolean>) => {
    if (!configScript) return
    setConfigSubmitting(true)
    setConfigError(null)
    try {
      const updated = await apiService.saveLocalScriptConfig(projectId, configScript.id, values)
      setScripts(prev => prev.map(s => (s.id === updated.id ? updated : s)))
      setConfigScript(null)
    } catch (e: unknown) {
      setConfigError(apiService.errorMessage(e))
    } finally {
      setConfigSubmitting(false)
    }
  }, [projectId, configScript])

  useEffect(() => {
    if (!isResizing) return

    const onMove = (event: MouseEvent) => {
      const container = panelsRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return
      const raw = ((event.clientX - rect.left) / rect.width) * 100
      const clamped = Math.min(70, Math.max(20, raw))
      setLeftPanelWidth(clamped)
    }

    const onUp = () => setIsResizing(false)

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isResizing])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SCRIPTS_SPLIT_STORAGE_KEY, String(leftPanelWidth))
  }, [leftPanelWidth])

  return (
    <div ref={panelsRef} className={`flex h-full min-h-0 flex-col gap-3 md:flex-row md:gap-0 ${isResizing ? 'select-none' : ''}`}>
      {/* Script list */}
      <div
        className="flex min-h-[180px] min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 md:min-h-0 md:rounded-r-none"
        style={{ width: `clamp(260px, ${leftPanelWidth}%, 72%)` }}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 dark:border-gray-700 px-3 py-2">
          <Terminal size={14} className="text-gray-400" />
          <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">Detected scripts</span>
          <span className="text-[10px] text-gray-400">{scripts.length}</span>
          <button
            onClick={() => void load()}
            disabled={loading}
            title="Rescan"
            className="ml-auto flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[10px] text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Rescan
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-gray-400">
              <Loader2 size={16} className="animate-spin" /> Scanning…
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
              <Terminal size={24} className="text-red-400" />
              <p className="text-xs text-red-500 dark:text-red-400 break-words">{error}</p>
            </div>
          ) : scripts.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-gray-400">
              <Terminal size={24} className="text-gray-300 dark:text-gray-600" />
              <p className="text-xs">No runnable scripts detected. Clone the local copy first.</p>
            </div>
          ) : (
            grouped.map(group => {
              const isCollapsed = collapsed[group.type]
              return (
                <div key={group.type} className="border-b border-gray-100 dark:border-gray-700/50">
                  <button
                    onClick={() => setCollapsed(c => ({ ...c, [group.type]: !c[group.type] }))}
                    className="flex w-full items-center gap-1.5 bg-gray-50 px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-700/30 dark:text-gray-400"
                  >
                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    {TYPE_LABELS[group.type]}
                    <span className="ml-1 font-normal normal-case text-gray-400">({group.items.length})</span>
                  </button>
                  {!isCollapsed && group.items.map(s => {
                    const needsConfig = s.params.length > 0
                    const canRun = !needsConfig || s.configured
                    return (
                    <div key={s.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <span className={`grid h-4 shrink-0 place-items-center rounded px-1 text-[9px] font-bold ${TYPE_BADGE[s.type]}`}>
                        {s.type}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-medium text-gray-700 dark:text-gray-200" title={s.command}>
                          {s.name}
                          {needsConfig && (
                            <span
                              className={`ml-1.5 rounded px-1 py-0.5 text-[8.5px] font-semibold ${
                                s.configured
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                              }`}
                            >
                              {s.configured ? 'configured' : 'needs setup'}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-[9.5px] text-gray-400" title={s.source}>
                          {s.cwd ? `${s.cwd}/ · ` : ''}{s.command}
                        </span>
                      </span>
                      {needsConfig && (
                        <button
                          onClick={() => { setConfigError(null); setConfigScript(s) }}
                          title="Edit configuration"
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[10px] font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                        >
                          <Pencil size={11} />
                          Edit
                        </button>
                      )}
                      <button
                        onClick={() => void run(s)}
                        disabled={runningId != null || !canRun}
                        title={canRun ? 'Run' : 'Configure the script first'}
                        className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[10px] font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-40 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-blue-500/10"
                      >
                        {runningId === s.id ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                        Run
                      </button>
                    </div>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize scripts panels"
        onMouseDown={() => setIsResizing(true)}
        className="hidden w-2 cursor-col-resize items-stretch justify-center md:flex"
        title="Drag to resize panels"
      >
        <div className={`w-px rounded-full transition-colors ${isResizing ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-700'}`} />
      </div>

      {/* Output console */}
      <div className="flex min-h-[180px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-900 md:min-h-0 md:rounded-l-none">
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-700 px-3 py-2">
          <Terminal size={14} className="text-gray-400" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-300">
            {result ? `$ ${result.command}` : runningId ? 'Running…' : 'Output'}
          </span>
          {result && (
            result.timed_out ? (
              <span className="flex shrink-0 items-center gap-1 text-[10px] text-amber-400">
                <XCircle size={12} /> timed out
              </span>
            ) : result.exit_code === 0 ? (
              <span className="flex shrink-0 items-center gap-1 text-[10px] text-emerald-400">
                <CheckCircle2 size={12} /> exit 0 · {result.duration_seconds}s
              </span>
            ) : (
              <span className="flex shrink-0 items-center gap-1 text-[10px] text-red-400">
                <XCircle size={12} /> exit {result.exit_code} · {result.duration_seconds}s
              </span>
            )
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11.5px] leading-[1.5]">
          {runningId ? (
            <div className="flex items-center gap-2 text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Running… output appears when it finishes.
            </div>
          ) : runError ? (
            <div className="text-red-400">{runError}</div>
          ) : !result ? (
            <div className="text-gray-500">Select a script and press Run. Output (stdout + stderr) appears here.</div>
          ) : (
            <>
              {result.stdout && <pre className="whitespace-pre-wrap break-words text-gray-200">{result.stdout}</pre>}
              {result.stderr && (
                <pre className="mt-2 whitespace-pre-wrap break-words text-red-300">{result.stderr}</pre>
              )}
              {!result.stdout && !result.stderr && (
                <div className="text-gray-500">(no output)</div>
              )}
            </>
          )}
        </div>
      </div>

      {configScript && (
        <ScriptConfigModal
          script={configScript}
          submitting={configSubmitting}
          error={configError}
          onSave={values => void saveConfig(values)}
          onClose={() => { if (!configSubmitting) setConfigScript(null) }}
        />
      )}
    </div>
  )
}
