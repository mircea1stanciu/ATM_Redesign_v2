import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { AlertTriangle, Loader2, PlayCircle, RefreshCw, Wrench, XCircle } from 'lucide-react'
import { apiService } from '@/services/api'
import type { FrameworkRunSelection } from '@/store/useAppStore'
import type { DetectedRunFramework, FrameworkDetection } from '@/types/domain'

const selectionKey = (projectId: string) => `runs.framework.selection.${projectId}`

// Detection per project for this browser session, so switching projects is instant.
const detectionCache = new Map<string, FrameworkDetection | null>()

/** Make the runner open on a specific target (e.g. a file the AI assistant just created). */
export function preselectFrameworkTarget(projectId: string, detection: FrameworkDetection, frameworkId: string, targetId: string) {
  detectionCache.set(projectId, detection)
  window.localStorage.setItem(selectionKey(projectId), JSON.stringify({ framework: frameworkId, target: targetId, extraArgs: '' }))
  window.localStorage.setItem(`runs.local.runner.${projectId}`, 'framework')
}

/** The runnable target for a project file (test file, test class, script, collection), if any. */
export function findTargetForFile(detection: FrameworkDetection, path: string): { frameworkId: string; targetId: string } | null {
  for (const framework of detection.frameworks) {
    const relative = framework.root === '.' ? path : path.startsWith(`${framework.root}/`) ? path.slice(framework.root.length + 1) : null
    if (relative === null) continue
    const target = framework.targets.find(t => t.group !== 'Setup' && (t.label === relative || t.description === relative))
    if (target) return { frameworkId: framework.id, targetId: target.id }
  }
  return null
}

export function useFrameworkDetection(projectId: string | null) {
  const [detection, setDetection] = useState<FrameworkDetection | null>(
    () => (projectId ? detectionCache.get(projectId) ?? null : null),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const load = useCallback(async (refresh = false) => {
    const current = ++requestId.current
    if (!projectId) {
      setDetection(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await apiService.getLocalFrameworks(projectId, refresh)
      if (current !== requestId.current) return
      detectionCache.set(projectId, result)
      setDetection(result)
    } catch (err) {
      if (current !== requestId.current) return
      // 400 = no linked checkout; the Local page already handles that case.
      if (axios.isAxiosError(err) && err.response?.status === 400) {
        detectionCache.set(projectId, null)
        setDetection(null)
      } else {
        setError(apiService.errorMessage(err))
      }
    } finally {
      if (current === requestId.current) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setDetection(projectId ? detectionCache.get(projectId) ?? null : null)
    void load()
  }, [projectId, load])

  return { detection, loading, error, reload: load }
}

const EXTRA_ARGS_EXAMPLES: Record<string, string> = {
  playwright: '--headed --grep @smoke',
  cypress: '--browser chrome --headed',
  wdio: '--logLevel info',
  mocha: '--grep "login"',
  jest: '-t "login"',
  newman: '--bail --timeout-request 10000',
  k6: '--vus 5 --duration 30s',
  npm: 'arguments passed to the script',
  maven: '-Dbrowser.channel=msedge -DbaseUrl=https://…',
  gradle: '--info',
  pytest: '-k login -x',
  robot: '--include smoke --variable BASE_URL:https://…',
}

function frameworkKey(framework: DetectedRunFramework) {
  return framework.id.split('@')[0]
}

function frameworkLabel(framework: DetectedRunFramework) {
  return framework.root === '.' ? framework.name : `${framework.name} (${framework.root})`
}

interface StoredSelection {
  framework: string
  target: string
  extraArgs: string
}

function readStoredSelection(projectId: string | null): StoredSelection | null {
  if (!projectId) return null
  try {
    return JSON.parse(window.localStorage.getItem(selectionKey(projectId)) || 'null')
  } catch {
    return null
  }
}

export function FrameworkRunConfig({
  projectId,
  detection,
  loading,
  onReload,
  onRun,
  onSelectionChange,
}: {
  projectId: string | null
  detection: FrameworkDetection
  loading: boolean
  onReload: () => void
  onRun: (params: { target: string; label: string; extraArgs: string }) => Promise<void>
  onSelectionChange: (selection: FrameworkRunSelection | null) => void
}) {
  const frameworks = detection.frameworks
  const stored = useMemo(() => readStoredSelection(projectId), [projectId])
  const [frameworkId, setFrameworkId] = useState(() =>
    frameworks.some(f => f.id === stored?.framework) ? stored!.framework : frameworks[0]?.id ?? '')
  const framework = frameworks.find(f => f.id === frameworkId) ?? frameworks[0] ?? null
  const runnable = useMemo(() => framework?.targets ?? [], [framework])
  const defaultTarget = (fw: DetectedRunFramework | null) =>
    fw?.targets.find(t => t.group !== 'Setup')?.id ?? fw?.targets[0]?.id ?? ''
  const [targetId, setTargetId] = useState(() =>
    runnable.some(t => t.id === stored?.target) ? stored!.target : defaultTarget(framework))
  const [extraArgs, setExtraArgs] = useState(stored?.extraArgs ?? '')
  const [starting, setStarting] = useState(false)

  // Keep the selection valid when detection changes (files added/removed, re-detect).
  useEffect(() => {
    if (!framework) return
    if (framework.id !== frameworkId) setFrameworkId(framework.id)
    if (!framework.targets.some(t => t.id === targetId)) setTargetId(defaultTarget(framework))
  }, [framework, frameworkId, targetId])

  const target = runnable.find(t => t.id === targetId) ?? null
  const label = target ? (target.group === 'Run tests' ? `${framework?.name} · ${target.label}` : `${framework?.name}: ${target.label}`) : ''

  useEffect(() => {
    if (!projectId) return
    window.localStorage.setItem(selectionKey(projectId), JSON.stringify({ framework: frameworkId, target: targetId, extraArgs }))
    onSelectionChange(target ? { projectId, target: target.id, label, extraArgs } : null)
  }, [projectId, frameworkId, targetId, extraArgs, target, label, onSelectionChange])

  const groups = useMemo(() => {
    const byGroup = new Map<string, typeof runnable>()
    for (const t of runnable) byGroup.set(t.group, [...(byGroup.get(t.group) ?? []), t])
    return [...byGroup.entries()]
  }, [runnable])

  if (!framework) return null
  const missing = framework.missing_tools
  const isSetup = target?.group === 'Setup'

  const run = async () => {
    if (!target) return
    setStarting(true)
    try {
      await onRun({ target: target.id, label, extraArgs })
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <select
          value={framework.id}
          onChange={e => {
            const next = frameworks.find(f => f.id === e.target.value) ?? null
            setFrameworkId(e.target.value)
            setTargetId(defaultTarget(next))
          }}
          className="form-input !py-1.5 !px-2 !text-xs min-w-0 flex-1"
          title={`${framework.runner} · ${framework.language}`}
        >
          {frameworks.map(f => <option key={f.id} value={f.id}>{frameworkLabel(f)}</option>)}
        </select>
        <button
          onClick={onReload}
          disabled={loading}
          title="Re-detect frameworks, test files and station tools"
          className="btn-secondary shrink-0 !px-2 !py-1.5 text-[10px]"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <select value={targetId} onChange={e => setTargetId(e.target.value)} className="form-input !py-1.5 !px-2 !text-xs w-full">
        {groups.map(([group, targets]) => (
          <optgroup key={group} label={group}>
            {targets.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </optgroup>
        ))}
      </select>
      {target?.description && (
        <p className="truncate px-1 font-mono text-[10px] text-gray-500 dark:text-gray-400" title={target.description}>{target.description}</p>
      )}

      {!isSetup && (
        <input
          value={extraArgs}
          onChange={e => setExtraArgs(e.target.value)}
          maxLength={500}
          placeholder={`Extra arguments (optional), e.g. ${EXTRA_ARGS_EXAMPLES[frameworkKey(framework)] ?? '--verbose'}`}
          className="form-input !py-1.5 !px-2 !text-xs w-full font-mono"
        />
      )}

      {missing.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
          {missing.map(m => (
            <p key={m.tool} className="flex items-start gap-1"><XCircle size={11} className="mt-px shrink-0" /><span><b>{m.tool}</b> not found — {m.hint}</span></p>
          ))}
        </div>
      )}
      {framework.issues.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          {framework.issues.map(issue => (
            <p key={issue} className="flex items-start gap-1"><AlertTriangle size={11} className="mt-px shrink-0" />{issue}</p>
          ))}
        </div>
      )}

      <button
        onClick={() => void run()}
        disabled={!projectId || !target || starting || missing.length > 0}
        title={missing.length ? `Missing: ${missing.map(m => m.tool).join(', ')}` : undefined}
        className="btn-primary !px-2 !py-1.5 text-xs w-full justify-center"
      >
        {starting ? <Loader2 size={12} className="animate-spin" /> : isSetup ? <Wrench size={12} /> : <PlayCircle size={12} />}
        {isSetup ? 'Run setup step' : 'Run'}
      </button>
    </div>
  )
}
