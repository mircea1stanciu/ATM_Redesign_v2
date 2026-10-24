import { useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart2, ExternalLink, FileCog, Github, GitBranch, Info, Laptop, Loader2,
  Pencil, PlayCircle, Smartphone, Square, Terminal, Trash2, XCircle,
} from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { useAppStore } from '@/store/useAppStore'
import { useRunWebSocket } from '@/hooks/useRunWebSocket'
import { useRunFilters } from '@/hooks/useRunFilters'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { LinkifiedText } from '@/components/ui/LinkifiedText'
import { runDisplayName } from '@/utils/runName'
import { RunFiltersBar } from '@/components/runs/RunFiltersBar'
import DevicesPanel from '@/components/runs/DevicesPanel'
import RunDetailsPanel from '@/components/runs/RunDetailsPanel'
import PropertiesEditorModal from '@/components/runs/PropertiesEditorModal'
import { AppiumRunConfig, useAppiumAnalysis } from '@/components/runs/AppiumRunConfig'
import { FrameworkRunConfig, useFrameworkDetection } from '@/components/runs/FrameworkRunConfig'
import ChangedTestsPanel from '@/components/runs/ChangedTestsPanel'
import { apiService } from '@/services/api'
import GitHubActionPanel from '@/pages/projects/GitHubActionPanel'
import type { GitHubTreeItem } from '@/types/domain'

type RightPanel = 'logs' | 'results' | 'details'
type LogView = 'cli' | 'structured'
type RunMode = 'local' | 'github-action' | 'devices'

const LOG_VIEW_STORAGE_KEY = 'runs.logView'
const RUNS_SPLIT_STORAGE_KEY = 'runs.local.leftPanelWidth'

function formatDuration(durationMs: number | null): string {
  if (durationMs == null || Number.isNaN(durationMs)) return '-'
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  return `${(durationMs / 1000).toFixed(2)} s`
}

type RunnerKind = 'appium' | 'bruno' | 'framework'
const RUNNER_KIND_KEY = 'runs.local.runner'

function formatCollectionLabel(path: string): string {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 1) return path
  return parts.slice(1).join('/')
}

/** ``embedded``: only the Local runner, without the Local / GitHub Action / Devices switch (used by AI Driven implementation). */
export default function RunsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const selectedProjectId = useAppStore(s => s.selectedProjectId)
  const runs = useAppStore(s => s.runs)
  const selectedRunId = useAppStore(s => s.selectedRunId)
  const setSelectedRunId = useAppStore(s => s.setSelectedRunId)
  const selectedRunDetails = useAppStore(s => s.selectedRunDetails)
  const runDetailsLoading = useAppStore(s => s.runDetailsLoading)
  const expandedResultId = useAppStore(s => s.expandedResultId)
  const setExpandedResultId = useAppStore(s => s.setExpandedResultId)
  const runProject = useAppStore(s => s.runProject)
  const setRunProject = useAppStore(s => s.setRunProject)
  const detectedProjects = useAppStore(s => s.detectedProjects)
  const projectCollections = useAppStore(s => s.projectCollections)
  const collectionEnvironments = useAppStore(s => s.collectionEnvironments)
  const runCollection = useAppStore(s => s.runCollection)
  const setRunCollection = useAppStore(s => s.setRunCollection)
  const runEnvironment = useAppStore(s => s.runEnvironment)
  const setRunEnvironment = useAppStore(s => s.setRunEnvironment)
  const collections = useAppStore(s => s.collections)
  const createRun = useAppStore(s => s.createRun)
  const createAppiumRun = useAppStore(s => s.createAppiumRun)
  const setAppiumRunSelection = useAppStore(s => s.setAppiumRunSelection)
  const createFrameworkRun = useAppStore(s => s.createFrameworkRun)
  const storeError = useAppStore(s => s.runError)
  const setFrameworkRunSelection = useAppStore(s => s.setFrameworkRunSelection)
  const refreshProjectData = useAppStore(s => s.refreshProjectData)
  const appium = useAppiumAnalysis(selectedProjectId)
  const frameworks = useFrameworkDetection(selectedProjectId)
  const executeRun = useAppStore(s => s.executeRun)
  const loadRunDetails = useAppStore(s => s.loadRunDetails)
  const loadProjectData = useAppStore(s => s.loadProjectData)
  const cancelRun = useAppStore(s => s.cancelRun)
  const deleteRun = useAppStore(s => s.deleteRun)
  const canExecute = usePermission('run.execute')
  const selectedRun = runs.find(r => r.id === selectedRunId) ?? null
  const selectedRunStatus = selectedRun?.status
  const runName = useAppStore(s => s.runName)
  const [envEditorOpen, setEnvEditorOpen] = useState(false)
  const setRunName = useAppStore(s => s.setRunName)
  const renameRun = useAppStore(s => s.renameRun)
  const selectedRunIsActive = selectedRunStatus === 'running' || selectedRunStatus === 'pending'
  const [stopping, setStopping] = useState(false)

  const stopSelectedRun = async () => {
    if (!selectedRunId || !selectedRunIsActive) return
    if (!window.confirm('Stop this execution? The test process will be terminated.')) return
    setStopping(true)
    try {
      await cancelRun(selectedRunId)
    } finally {
      setStopping(false)
    }
  }

  const [rightPanel, setRightPanel] = useState<RightPanel>('logs')
  const [runModeState, setRunMode] = useState<RunMode>('local')
  const runMode: RunMode = embedded ? 'local' : runModeState
  const [logView, setLogView] = useState<LogView>(() => {
    if (typeof window === 'undefined') return 'cli'
    const saved = window.localStorage.getItem(LOG_VIEW_STORAGE_KEY)
    return saved === 'structured' ? 'structured' : 'cli'
  })
  const navigate = useNavigate()
  const [repoEnvironments, setRepoEnvironments] = useState<string[]>([])
  const [repoEnvironmentsResolved, setRepoEnvironmentsResolved] = useState(false)
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return 28
    const raw = Number(window.localStorage.getItem(RUNS_SPLIT_STORAGE_KEY) || '')
    return Number.isFinite(raw) ? Math.min(60, Math.max(20, raw)) : 28
  })
  const [isResizing, setIsResizing] = useState(false)
  const panelsRef = useRef<HTMLDivElement | null>(null)

  const { messages: runMessages, cliText, structuredText, connected, connectionError, clearMessages } = useRunWebSocket({
    runId: selectedRunId,
    enabled: Boolean(selectedRunId),
  })

  // Which run form to show: Appium device runs, Bruno collections, or any other detected framework.
  const runnerKinds = useMemo(() => {
    const kinds: { id: RunnerKind; label: string }[] = []
    if (appium.analysis && appium.analysis.runners.length + appium.analysis.suites.length > 0) {
      kinds.push({ id: 'appium', label: 'Appium' })
    }
    if (detectedProjects.length > 0) kinds.push({ id: 'bruno', label: 'Bruno' })
    if ((frameworks.detection?.frameworks.length ?? 0) > 0) kinds.push({ id: 'framework', label: 'Test frameworks' })
    return kinds
  }, [appium.analysis, detectedProjects.length, frameworks.detection])
  const [preferredRunner, setPreferredRunner] = useState<RunnerKind | null>(null)
  useEffect(() => {
    setPreferredRunner(selectedProjectId
      ? (window.localStorage.getItem(`${RUNNER_KIND_KEY}.${selectedProjectId}`) as RunnerKind | null)
      : null)
  }, [selectedProjectId])
  const runnerKind: RunnerKind | null = runnerKinds.find(k => k.id === preferredRunner)?.id ?? runnerKinds[0]?.id ?? null
  const chooseRunner = (kind: RunnerKind) => {
    setPreferredRunner(kind)
    if (selectedProjectId) window.localStorage.setItem(`${RUNNER_KIND_KEY}.${selectedProjectId}`, kind)
  }

  useEffect(() => {
    if (runnerKind !== 'appium') setAppiumRunSelection(null)
    if (runnerKind !== 'framework') setFrameworkRunSelection(null)
  }, [runnerKind, setAppiumRunSelection, setFrameworkRunSelection])

  // Refresh the run list/details when the live stream reports a status change,
  // so a finished run doesn't stay "running" with stale totals.
  const latestRunStatus = useMemo(() => {
    for (let i = runMessages.length - 1; i >= 0; i -= 1) {
      if (runMessages[i].type === 'status') return runMessages[i].status ?? null
    }
    return null
  }, [runMessages])

  useEffect(() => {
    if (!latestRunStatus || !selectedProjectId || !selectedRunId) return
    void refreshProjectData(selectedProjectId)
    void loadRunDetails(selectedRunId)
  }, [latestRunStatus, selectedProjectId, selectedRunId, refreshProjectData, loadRunDetails])

  // A finished setup step (npm install, .venv, …) changes what detection reports.
  const reloadFrameworks = frameworks.reload
  const frameworkRunFinished = runnerKind === 'framework' && ['passed', 'failed', 'error', 'cancelled'].includes(latestRunStatus ?? '')
  useEffect(() => {
    if (frameworkRunFinished) void reloadFrameworks(true)
  }, [frameworkRunFinished, selectedRunId, reloadFrameworks])

  useEffect(() => {
    if (selectedProjectId) void loadProjectData(selectedProjectId)
  }, [selectedProjectId, loadProjectData])

  useEffect(() => {
    if (selectedRunId) void loadRunDetails(selectedRunId)
  }, [selectedRunId, loadRunDetails])

  useEffect(() => {
    const state = useAppStore.getState()
    const run = state.runs.find(r => r.id === selectedRunId)
    if (run?.status !== 'running') return
    const iv = setInterval(() => void loadRunDetails(selectedRunId!), 5000)
    return () => clearInterval(iv)
  }, [selectedRunId, loadRunDetails])

  const runsByNewest = useMemo(() =>
    [...runs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [runs])
  const {
    filteredRuns, dateFrom, setDateFrom, dateTo, setDateTo, collectionFilter, setCollectionFilter,
    sourceFilter, setSourceFilter, collectionOptions, environmentFilter, setEnvironmentFilter, environmentOptions,
    executionTimeFilter, setExecutionTimeFilter, executionTimeOptions, hasActiveFilters, clearFilters,
  } = useRunFilters(runsByNewest)

  const filteredCollections = useMemo(
    () => (runProject ? (projectCollections[runProject] || []) : collections),
    [runProject, projectCollections, collections],
  )
  const filteredEnvironments = useMemo(() => {
    if (repoEnvironmentsResolved) return repoEnvironments
    return runCollection ? (collectionEnvironments[runCollection] || []) : []
  }, [repoEnvironmentsResolved, repoEnvironments, runCollection, collectionEnvironments])

  useEffect(() => {
    if (!runProject) return
    if (runCollection && filteredCollections.includes(runCollection)) return
    setRunCollection(filteredCollections[0] || '')
  }, [runProject, runCollection, filteredCollections, setRunCollection])

  useEffect(() => {
    let cancelled = false

    const loadBruEnvironments = async () => {
      if (!selectedProjectId || !runCollection) {
        setRepoEnvironments([])
        setRepoEnvironmentsResolved(false)
        return
      }

      const localEnvironments = collectionEnvironments[runCollection]
      if (localEnvironments?.length) {
        setRepoEnvironments(localEnvironments)
        setRepoEnvironmentsResolved(true)
        return
      }

      const candidatePaths = [
        `${runCollection}/environments`,
        `${runCollection}/environment`,
      ]

      let items: GitHubTreeItem[] = []
      let resolved = false

      for (const envPath of candidatePaths) {
        try {
          const response = await apiService.getProjectRepoTree(selectedProjectId, envPath)
          items = response
          resolved = true
          break
        } catch {
          // Try next candidate path.
        }
      }

      if (cancelled) return

      if (!resolved) {
        setRepoEnvironments([])
        setRepoEnvironmentsResolved(false)
        return
      }

      const bruEnvironments = items
        .filter(item => item.type === 'file' && item.name.toLowerCase().endsWith('.bru'))
        .map(item => item.name.replace(/\.bru$/i, ''))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))

      setRepoEnvironments([...new Set(bruEnvironments)])
      setRepoEnvironmentsResolved(true)
    }

    void loadBruEnvironments()

    return () => {
      cancelled = true
    }
  }, [selectedProjectId, runCollection, collectionEnvironments])

  useEffect(() => {
    if (runEnvironment && filteredEnvironments.includes(runEnvironment)) return
    setRunEnvironment(filteredEnvironments[0] || '')
  }, [runEnvironment, filteredEnvironments, setRunEnvironment])

  useEffect(() => {
    window.localStorage.setItem(LOG_VIEW_STORAGE_KEY, logView)
  }, [logView])

  useEffect(() => {
    if (!isResizing) return

    const onMove = (event: MouseEvent) => {
      const container = panelsRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return
      const raw = ((event.clientX - rect.left) / rect.width) * 100
      const clamped = Math.min(60, Math.max(20, raw))
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
    window.localStorage.setItem(RUNS_SPLIT_STORAGE_KEY, String(leftPanelWidth))
  }, [leftPanelWidth])

  const handleOpenAllureReport = () => {
    if (!selectedRunDetails) return
    // The Allure report opens in Reports, embedded (it also opens full screen or in its own tab from there).
    navigate(`/reports/runs/${selectedRunDetails.id}`)
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Run mode sub-tabs: Local vs GitHub Action */}
      {!embedded && (
      <div className="flex shrink-0 items-center gap-1 rounded-2xl border border-gray-200/80 bg-white px-2 py-1.5 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <button
          onClick={() => setRunMode('local')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            runMode === 'local'
              ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700/50'
          }`}
        >
          <Laptop size={13} /> Local
        </button>
        <button
          onClick={() => setRunMode('github-action')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            runMode === 'github-action'
              ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700/50'
          }`}
        >
          <Github size={13} /> GitHub Action
        </button>
        <button
          onClick={() => setRunMode('devices')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            runMode === 'devices'
              ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700/50'
          }`}
        >
          <Smartphone size={13} /> Devices
        </button>
      </div>
      )}

      {runMode === 'devices' ? (
        <DevicesPanel canExecute={canExecute} />
      ) : runMode === 'github-action' ? (
        <GitHubActionPanel projectId={selectedProjectId} canExecute={canExecute} />
      ) : (
        <div ref={panelsRef} className={`flex min-h-0 flex-1 flex-col gap-3 md:flex-row md:gap-0 ${isResizing ? 'select-none' : ''}`}>
      {/* ── Col 1: Project Runs list ── */}
      <div
        className="flex min-h-[180px] min-w-0 shrink-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft md:min-h-0 md:rounded-r-none"
        style={{ width: `clamp(260px, ${leftPanelWidth}%, 60%)` }}
      >
        <div className="shrink-0 border-b border-gray-200 dark:border-gray-700 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-gray-900 dark:text-white">
              Project Runs <span className="text-gray-400 dark:text-gray-500">({filteredRuns.length} of {runs.length})</span>
            </h3>
            <RunFiltersBar
              dateFrom={dateFrom}
              setDateFrom={setDateFrom}
              dateTo={dateTo}
              setDateTo={setDateTo}
              collectionFilter={collectionFilter}
              setCollectionFilter={setCollectionFilter}
              sourceFilter={sourceFilter}
              setSourceFilter={setSourceFilter}
              collectionOptions={collectionOptions}
              environmentFilter={environmentFilter}
              setEnvironmentFilter={setEnvironmentFilter}
              environmentOptions={environmentOptions}
              executionTimeFilter={executionTimeFilter}
              setExecutionTimeFilter={setExecutionTimeFilter}
              executionTimeOptions={executionTimeOptions}
              hasActiveFilters={hasActiveFilters}
              clearFilters={clearFilters}
            />
          </div>
        </div>
        {/* Create run */}
        {canExecute && (
        <div className="max-h-[55%] shrink-0 space-y-1.5 overflow-y-auto border-b border-gray-200 dark:border-gray-700 p-2">
          <input
            value={runName}
            onChange={e => setRunName(e.target.value)}
            maxLength={120}
            placeholder="Run name (optional)"
            className="form-input !py-1.5 !px-2 !text-xs w-full"
          />
          {selectedProjectId && runnerKinds.length > 0 && (
            <ChangedTestsPanel projectId={selectedProjectId} detection={frameworks.detection} />
          )}
          {runnerKinds.length > 1 && (
            <div className="flex rounded-lg border border-gray-200 p-0.5 text-[10px] font-medium dark:border-gray-700">
              {runnerKinds.map(kind => (
                <button
                  key={kind.id}
                  onClick={() => chooseRunner(kind.id)}
                  className={`flex-1 rounded-md px-2 py-1 transition ${runnerKind === kind.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`}
                >
                  {kind.label}
                </button>
              ))}
            </div>
          )}
          {runnerKind === 'framework' && frameworks.detection ? (
            <FrameworkRunConfig
              key={selectedProjectId ?? 'none'}
              projectId={selectedProjectId}
              detection={frameworks.detection}
              loading={frameworks.loading}
              onReload={() => void frameworks.reload(true)}
              onRun={createFrameworkRun}
              onSelectionChange={setFrameworkRunSelection}
            />
          ) : runnerKind === 'appium' && appium.analysis ? (
            <AppiumRunConfig
              key={selectedProjectId ?? 'none'}
              projectId={selectedProjectId}
              analysis={appium.analysis}
              loading={appium.loading}
              onReload={() => void appium.reload(true)}
              onRun={createAppiumRun}
              onSelectionChange={setAppiumRunSelection}
            />
          ) : !runnerKind && (appium.loading || frameworks.loading) ? (
            <div className="flex items-center gap-1.5 px-1 py-2 text-[11px] text-gray-500 dark:text-gray-400">
              <Loader2 size={12} className="animate-spin" /> Detecting project type…
            </div>
          ) : !runnerKind ? (
            <div className="space-y-1.5 px-1 py-1 text-[11px] text-gray-500 dark:text-gray-400">
              <p>No runnable tests were detected in the linked checkout.</p>
              <p>
                Supported: Bruno, Appium, Playwright, Cypress, WebdriverIO, Selenium / Appium (Mocha, pytest, Maven,
                Gradle), Jest, Postman (Newman), k6, Robot Framework, RestAssured, Karate, JUnit/TestNG and npm scripts.
              </p>
              <button onClick={() => { void frameworks.reload(true); void appium.reload(true) }} className="btn-secondary !px-2 !py-1 text-[10px]">
                <Loader2 size={11} className={frameworks.loading ? 'animate-spin' : 'hidden'} /> Re-detect
              </button>
            </div>
          ) : (
          <>
          <select
            value={runProject}
            onChange={e => setRunProject(e.target.value)}
            className="form-input !py-1.5 !px-2 !text-xs w-full"
          >
            {detectedProjects.length === 0 && <option value="">No projects detected</option>}
            {detectedProjects.map(project => <option key={project} value={project}>{project}</option>)}
          </select>
          <select value={runCollection} onChange={e => setRunCollection(e.target.value)} className="form-input !py-1.5 !px-2 !text-xs w-full">
            {filteredCollections.length === 0 && <option value="">No collections</option>}
            {filteredCollections.map(c => <option key={c} value={c}>{formatCollectionLabel(c)}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <select value={runEnvironment} onChange={e => setRunEnvironment(e.target.value)} className="form-input !py-1.5 !px-2 !text-xs min-w-0 flex-1">
              {filteredEnvironments.length === 0 && <option value="">No environments</option>}
              {filteredEnvironments.map(env => <option key={env} value={env}>{env}</option>)}
            </select>
            <button
              onClick={() => setEnvEditorOpen(true)}
              disabled={!selectedProjectId || !runCollection}
              title="View and edit this collection's environment variables (environments/*.bru) before running"
              className="btn-secondary shrink-0 !px-2 !py-1.5 text-[10px]"
            >
              <FileCog size={11} /> Variables
            </button>
          </div>
          {envEditorOpen && selectedProjectId && runCollection && (
            <PropertiesEditorModal
              kind="bruno"
              projectId={selectedProjectId}
              collection={runCollection}
              initialEnvironment={runEnvironment}
              canEdit
              onClose={() => setEnvEditorOpen(false)}
              onSaved={() => undefined}
            />
          )}
          <button onClick={() => void createRun()} disabled={!selectedProjectId || !runCollection} className="btn-primary !px-2 !py-1.5 text-xs w-full justify-center">
            <PlayCircle size={12} /> Run
          </button>
          </>
          )}
          {appium.error && (
            <div className="text-[10px] text-red-600 dark:text-red-400">Appium detection failed: {appium.error}</div>
          )}
          {frameworks.error && (
            <div className="text-[10px] text-red-600 dark:text-red-400">Framework detection failed: {frameworks.error}</div>
          )}
          {storeError && (
            <div className="flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
              <span className="break-words">{storeError}</span>
              <button onClick={() => useAppStore.setState({ runError: null })} className="shrink-0" title="Dismiss"><XCircle size={11} /></button>
            </div>
          )}
        </div>
        )}
        {/* Execute button */}
        {canExecute && (
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 dark:border-gray-700 px-3 py-2">
          <span className="text-[10px] text-gray-500 dark:text-gray-400">
            {selectedRun ? `Selected: ${runDisplayName(selectedRun)}` : 'Select a run'}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => void stopSelectedRun()}
              disabled={!selectedRunIsActive || stopping}
              title={selectedRunIsActive ? 'Stop this execution' : 'No execution in progress'}
              className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1 text-[10px] font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40"
            >
              {stopping ? <Loader2 size={11} className="animate-spin" /> : <Square size={10} />} Stop
            </button>
            <button onClick={() => void executeRun()} disabled={!selectedRunId || selectedRunIsActive} className="btn-primary !px-2.5 !py-1 text-[10px]">
              <PlayCircle size={11} /> Execute
            </button>
          </div>
        </div>
        )}
        {/* Runs list */}
        <div className="min-h-[120px] flex-1 overflow-y-auto">
          {runs.length === 0 && <p className="py-8 text-center text-xs text-gray-400 dark:text-gray-500">Create a run to get started.</p>}
          {runs.length > 0 && filteredRuns.length === 0 && <p className="py-8 text-center text-xs text-gray-400 dark:text-gray-500">No runs match the current filters.</p>}
          {filteredRuns.map(run => (
            <div
              key={run.id}
              className={`group flex w-full items-center border-b border-gray-100 dark:border-gray-700/50 transition ${
                selectedRunId === run.id
                  ? 'bg-blue-50 dark:bg-blue-500/10'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
              }`}
            >
              <button
                onClick={() => setSelectedRunId(run.id)}
                className="flex flex-1 items-center justify-between px-3 py-2.5 text-left min-w-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[11px] font-semibold text-gray-800 dark:text-gray-100" title={runDisplayName(run)}>
                      {runDisplayName(run)}
                    </span>
                    {run.name && <span className="shrink-0 font-mono text-[9px] text-gray-400 dark:text-gray-500">{run.id}</span>}
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                      <GitBranch size={9} />{run.branch || 'main'}
                    </span>
                  </div>
                  <p className="truncate text-[10px] font-medium text-gray-700 dark:text-gray-300" title={run.collection || ''}>{run.collection || 'Unnamed run'}</p>
                  <p className="truncate text-[9px] text-gray-400 dark:text-gray-500">
                    {run.environment ? `${run.environment} · ` : ''}{run.execution_time ? new Date(run.execution_time).toLocaleString() : new Date(run.created_at).toLocaleString()}
                  </p>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    {run.passed_tests}/{run.total_tests} passed
                    {run.app_version && <span className="ml-1.5 text-gray-400 dark:text-gray-500">· 📱 {run.app_version}</span>}
                    {(run.report_count ?? 0) > 0 && <span className="ml-1.5 text-gray-400 dark:text-gray-500">· 📄 {run.report_count} report{run.report_count === 1 ? '' : 's'}</span>}
                  </span>
                </div>
                <StatusBadge status={run.status} />
              </button>
              {/* Cancel / Delete actions */}
              {canExecute && (
                <div className="flex shrink-0 items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {(run.status === 'running' || run.status === 'pending') && (
                    <button
                      title="Cancel run"
                      onClick={e => { e.stopPropagation(); void cancelRun(run.id) }}
                      className="rounded p-1 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-600"
                    >
                      <XCircle size={13} />
                    </button>
                  )}
                  {run.id.startsWith('manual-') && (
                    <button
                      title="Rename run"
                      onClick={e => {
                        e.stopPropagation()
                        const next = window.prompt('Run name (leave empty to clear):', run.name ?? '')
                        if (next !== null) void renameRun(run.id, next.trim() || null)
                      }}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700/50 dark:hover:text-gray-200"
                    >
                      <Pencil size={12} />
                    </button>
                  )}
                  <button
                    title="Delete run"
                    onClick={e => { e.stopPropagation(); void deleteRun(run.id) }}
                    className="rounded p-1 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize test runs panels"
        onMouseDown={() => setIsResizing(true)}
        className="hidden w-2 cursor-col-resize items-stretch justify-center md:flex"
        title="Drag to resize panels"
      >
        <div className={`w-px rounded-full transition-colors ${isResizing ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-700'}`} />
      </div>

      {/* ── Col 2: Logs / Results ── */}
      <div className="flex min-h-[180px] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft md:min-h-0 md:rounded-l-none">
        {/* Panel tabs */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 dark:border-gray-700 px-3 py-2">
          <div className="flex items-center gap-1">
            <button onClick={() => setRightPanel('logs')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                rightPanel === 'logs'
                  ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700/50'
              }`}>
              <Terminal size={12} /> Live Logs
            </button>
            <button onClick={() => setRightPanel('results')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                rightPanel === 'results'
                  ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700/50'
              }`}>
              <BarChart2 size={12} /> Results
            </button>
            <button onClick={() => setRightPanel('details')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                rightPanel === 'details'
                  ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700/50'
              }`}>
              <Info size={12} /> Run details
            </button>
          </div>
          <div className="flex items-center gap-2">
            {rightPanel === 'logs' && (
              <>
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-0.5">
                  <button
                    onClick={() => setLogView('cli')}
                    className={`rounded-md px-2 py-1 text-[10px] font-medium transition ${
                      logView === 'cli'
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                  >
                    Raw CLI
                  </button>
                  <button
                    onClick={() => setLogView('structured')}
                    className={`rounded-md px-2 py-1 text-[10px] font-medium transition ${
                      logView === 'structured'
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                  >
                    Structured
                  </button>
                </div>
                <span className={`flex items-center gap-1 text-[10px] ${connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
                  {connected ? 'Live' : 'Off'}
                </span>
                <button onClick={clearMessages} className="btn-ghost !px-2 !py-1 !text-[10px]">Clear</button>
              </>
            )}
            {rightPanel === 'results' && (
              <button onClick={handleOpenAllureReport}
                disabled={!selectedRunDetails || selectedRunDetails.results.length === 0}
                className="btn-ghost !px-2 !py-1 !text-[10px]">
                <ExternalLink size={10} /> Allure report
              </button>
            )}
          </div>
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-hidden">
          {rightPanel === 'logs' ? (
            <div className="flex h-full flex-col p-3">
              {connectionError && <p className="mb-1 shrink-0 text-[10px] text-red-500 dark:text-red-400">{connectionError}</p>}
              <pre className="flex-1 overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-950 dark:bg-gray-900 p-3 font-mono text-[11px] leading-relaxed text-emerald-400">
                <LinkifiedText text={(logView === 'cli' ? cliText : structuredText) || '$ Waiting for logs... Select a run and press Execute.'} />
              </pre>
            </div>
          ) : rightPanel === 'details' ? (
            !selectedRunId ? (
              <div className="flex h-full items-center justify-center text-sm text-gray-400 dark:text-gray-500">Select a run</div>
            ) : runDetailsLoading && !selectedRunDetails ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-400 dark:text-gray-500">
                <Loader2 size={14} className="animate-spin" /> Loading...
              </div>
            ) : selectedRunDetails ? (
              <RunDetailsPanel
                run={selectedRunDetails}
                onOpenAllure={handleOpenAllureReport}
              />
            ) : null
          ) : (
            <div className="flex h-full flex-col">
              {!selectedRunId ? (
                <div className="flex flex-1 items-center justify-center text-sm text-gray-400 dark:text-gray-500">Select a run</div>
              ) : runDetailsLoading ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-gray-400 dark:text-gray-500">
                  <Loader2 size={14} className="animate-spin" /> Loading...
                </div>
              ) : selectedRunDetails ? (
                <>
                  {/* Stats bar */}
                  <div className="flex shrink-0 gap-2 border-b border-gray-200 dark:border-gray-700 px-3 py-2">
                    {[
                      { label: 'Total', value: selectedRunDetails.total_tests, cls: 'text-gray-900 dark:text-white' },
                      { label: 'Pass', value: selectedRunDetails.passed_tests, cls: 'text-emerald-600 dark:text-emerald-400' },
                      { label: 'Fail', value: selectedRunDetails.failed_tests, cls: 'text-red-600 dark:text-red-400' },
                      { label: 'Skip', value: selectedRunDetails.skipped_tests, cls: 'text-gray-500 dark:text-gray-400' },
                    ].map(({ label, value, cls }) => (
                      <div key={label} className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 px-2.5 py-1.5">
                        <span className={`text-sm font-bold ${cls}`}>{value}</span>
                        <span className="text-[10px] text-gray-500 dark:text-gray-400">{label}</span>
                      </div>
                    ))}
                  </div>
                  {/* Results list */}
                  <div className="flex-1 overflow-y-auto">
                    {selectedRunDetails.results.length === 0 ? (
                      <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">No results yet.</p>
                    ) : (
                      selectedRunDetails.results.map(result => {
                        const isExpanded = expandedResultId === result.id
                        return (
                          <div key={result.id} className="border-b border-gray-100 dark:border-gray-700/50">
                            <button
                              onClick={() => setExpandedResultId(isExpanded ? null : result.id)}
                              className="flex w-full items-center justify-between px-3 py-2.5 text-left transition hover:bg-gray-50 dark:hover:bg-gray-700/30"
                            >
                              <div className="min-w-0 flex-1 pr-3">
                                <p className="truncate text-xs font-medium text-gray-900 dark:text-gray-200">{result.test_name}</p>
                                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                                  {result.class_name || 'No class'} · {formatDuration(result.duration_ms)}
                                </p>
                              </div>
                              <StatusBadge status={result.status || 'error'} />
                            </button>
                            {isExpanded && (result.error_message || result.stack_trace) && (
                              <div className="space-y-2 border-t border-gray-100 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-900/30 px-3 py-2">
                                {result.error_message && (
                                  <div>
                                    <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-widest text-red-500 dark:text-red-400">Error</p>
                                    <p className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/20 p-2 text-[11px] text-red-700 dark:text-red-300">{result.error_message}</p>
                                  </div>
                                )}
                                {result.stack_trace && (
                                  <div>
                                    <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Stack Trace</p>
                                    <pre className="max-h-32 overflow-auto rounded-lg bg-gray-900 border border-gray-200 dark:border-gray-700 p-2 font-mono text-[10px] text-gray-300">{result.stack_trace}</pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
        </div>
      )}
    </div>
  )
}
