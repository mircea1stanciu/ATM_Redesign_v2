import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCcw,
  Rocket,
  Search,
  Wand2,
  X,
} from 'lucide-react'
import { apiService } from '@/services/api'

// ── Types ─────────────────────────────────────────────────────────────────
type FolderNode = {
  id: string
  name: string
  parent_id?: string | null
  kind: string
  count?: number
  files?: string[]
  children: FolderNode[]
}

type ReferenceFlatItem = {
  id: string
  name: string
  depth: number
  bru_count: number
  files: string[]
  has_children: boolean
}

type Step = {
  index: number
  description: string
  test_data: string
  expected_result: string
}

type Case = {
  key: string
  name: string
  status: string
  priority: string
  folder: string
  story_task_id?: string
  story_task_status?: string
  story_task_team?: string
  precondition: string
  objective: string
  source: string
  steps: Step[]
}

type TargetProject = {
  project_id: string
  project_name: string
  local_repo_path: string
  detected_framework: string
}

type GenerateResult = {
  framework: string
  target_dir: string
  output_dir: string
  created_files: string[]
  skipped_cases: Array<{ key: string; reason: string }>
  warnings: string[]
}

interface Props {
  connectedProjectKey: string
  connectedProjectName?: string
  ready: boolean
}

const ZEPHYR_SPLIT_STORAGE_KEY = 'projects.zephyr.planner.leftPanelWidth'

// ── Helpers ───────────────────────────────────────────────────────────────
function buildFolderTree(folders: Array<{ id: string; name: string; parent_id?: string | null; kind: string; count?: number }>): FolderNode[] {
  const map = new Map<string, FolderNode>()
  for (const f of folders) {
    map.set(f.id, { ...f, children: [] })
  }
  const roots: FolderNode[] = []
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sort = (list: FolderNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name))
    for (const n of list) sort(n.children)
  }
  sort(roots)
  return roots
}

function statusBadgeClass(status: string): string {
  const s = status.toLowerCase()
  if (s.includes('draft')) return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  if (s.includes('approved') || s.includes('active')) return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
  if (s.includes('deprecated')) return 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
  return 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
}

function canSelectForGeneration(status: string): boolean {
  return status.trim().toLowerCase() === 'suggested for automation'
}

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase()
}

function flattenFolderTree(
  nodes: FolderNode[],
  depth = 0,
  out: ReferenceFlatItem[] = [],
): ReferenceFlatItem[] {
  for (const n of nodes) {
    out.push({
      id: n.id,
      name: n.name,
      depth,
      bru_count: n.count ?? 0,
      files: n.files || [],
      has_children: n.children.length > 0,
    })
    flattenFolderTree(n.children, depth + 1, out)
  }
  return out
}

// ── Component ─────────────────────────────────────────────────────────────
export default function ZephyrAutomationPlannerPanel({ connectedProjectKey, connectedProjectName, ready }: Props) {
  const [folders, setFolders] = useState<FolderNode[]>([])
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [foldersError, setFoldersError] = useState<string | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState<string>('')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  const [cases, setCases] = useState<Case[]>([])
  const [casesLoading, setCasesLoading] = useState(false)
  const [casesError, setCasesError] = useState<string | null>(null)
  const [selectedCaseKeys, setSelectedCaseKeys] = useState<Set<string>>(new Set())
  const [caseSearch, setCaseSearch] = useState('')
  const [expandedCaseKey, setExpandedCaseKey] = useState<string>('')

  // Status filter shared by both the Folders/Subfolders tree (scopes each
  // folder's count to matching cases) and the Manual Test Cases table
  // (narrows the visible rows) — one control drives both sections.
  const [caseStatusFilter, setCaseStatusFilter] = useState<string>('')
  // Monotonic request ids so only the freshest folders/cases response is
  // applied — quickly changing the Status/Team filter used to let a slower
  // earlier response overwrite a newer one (stale/empty grid even though the
  // backend answered correctly).
  const foldersReqId = useRef(0)
  const casesReqId = useRef(0)

  const [targets, setTargets] = useState<TargetProject[]>([])
  const [targetsLoading, setTargetsLoading] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [customPath, setCustomPath] = useState<string>('')
  const [outputSubpath, setOutputSubpath] = useState<string>('generated-automation')
  const [framework, setFramework] = useState<string>('auto')

  // Reference collection: an existing folder of .bru requests in the target
  // repo the user can pick to reuse as a base — its requests are copied first,
  // then the Zephyr-derived steps are appended after them.
  const [referenceFolderTree, setReferenceFolderTree] = useState<FolderNode[]>([])
  const [referenceFoldersFlat, setReferenceFoldersFlat] = useState<ReferenceFlatItem[]>([])
  const [referenceFoldersLoading, setReferenceFoldersLoading] = useState(false)
  const [selectedReferenceFolder, setSelectedReferenceFolder] = useState<string>('')
  const [showReferenceModal, setShowReferenceModal] = useState(false)
  const [referenceModalSearch, setReferenceModalSearch] = useState('')
  const [expandedReferenceFolders, setExpandedReferenceFolders] = useState<Set<string>>(new Set())
  const [expandedSearchReferenceFolders, setExpandedSearchReferenceFolders] = useState<Set<string>>(new Set())

  const [statusOptions, setStatusOptions] = useState<Array<{ name: string; color: string }>>([])
  const [statusUpdating, setStatusUpdating] = useState<Set<string>>(new Set())
  const [statusError, setStatusError] = useState<string | null>(null)

  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult] = useState<GenerateResult | null>(null)
  const [genError, setGenError] = useState<string | null>(null)

  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 38
    const raw = Number(window.localStorage.getItem(ZEPHYR_SPLIT_STORAGE_KEY) || '38')
    return Number.isFinite(raw) ? Math.min(60, Math.max(24, raw)) : 38
  })
  const [isResizing, setIsResizing] = useState(false)
  const panelsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isResizing) return

    const onMove = (event: MouseEvent) => {
      const container = panelsRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return
      const raw = ((event.clientX - rect.left) / rect.width) * 100
      const clamped = Math.min(60, Math.max(24, raw))
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
    window.localStorage.setItem(ZEPHYR_SPLIT_STORAGE_KEY, String(leftPanelWidth))
  }, [leftPanelWidth])

  const loadFolders = useCallback(async () => {
    if (!connectedProjectKey) return
    const reqId = ++foldersReqId.current
    setFoldersLoading(true)
    setFoldersError(null)
    try {
      const res = await apiService.listZephyrPlannerFolders(
        connectedProjectKey,
        caseStatusFilter || undefined,
      )
      if (reqId !== foldersReqId.current) return
      setFolders(buildFolderTree(res.folders))
    } catch (e: any) {
      if (reqId !== foldersReqId.current) return
      setFoldersError(e?.response?.data?.detail || e?.message || 'Failed to load Zephyr folders')
      setFolders([])
    } finally {
      if (reqId === foldersReqId.current) setFoldersLoading(false)
    }
  }, [connectedProjectKey, caseStatusFilter])

  const loadCases = useCallback(async (folderId: string, statusFilter?: string) => {
    if (!connectedProjectKey) return
    const reqId = ++casesReqId.current
    setCasesLoading(true)
    setCasesError(null)
    try {
      const res = await apiService.listZephyrPlannerCases(
        connectedProjectKey,
        folderId || undefined,
        statusFilter || undefined,
      )
      if (reqId !== casesReqId.current) return
      setCases(res.cases)
    } catch (e: any) {
      if (reqId !== casesReqId.current) return
      setCasesError(e?.response?.data?.detail || e?.message || 'Failed to load Zephyr test cases')
      setCases([])
    } finally {
      if (reqId === casesReqId.current) setCasesLoading(false)
    }
  }, [connectedProjectKey])

  const loadTargets = useCallback(async () => {
    setTargetsLoading(true)
    try {
      const res = await apiService.listZephyrPlannerTargets()
      setTargets(res.projects)
    } catch {
      setTargets([])
    } finally {
      setTargetsLoading(false)
    }
  }, [])

  const loadStatuses = useCallback(async () => {
    if (!connectedProjectKey) return
    try {
      const res = await apiService.listZephyrPlannerStatuses(connectedProjectKey)
      setStatusOptions(res.statuses.map(s => ({ name: s.name, color: s.color })))
    } catch {
      setStatusOptions([])
    }
  }, [connectedProjectKey])

  const handleStatusChange = useCallback(async (caseKey: string, newStatus: string) => {
    const previous = cases.find(c => c.key === caseKey)?.status
    if (previous === newStatus) return
    // Optimistic update so the dropdown feels instant; rolled back on failure.
    setCases(prev => prev.map(c => c.key === caseKey ? { ...c, status: newStatus } : c))
    setStatusUpdating(prev => new Set(prev).add(caseKey))
    setStatusError(null)
    try {
      await apiService.updateZephyrPlannerCaseStatus(connectedProjectKey, caseKey, newStatus)
    } catch (e: any) {
      setCases(prev => prev.map(c => c.key === caseKey ? { ...c, status: previous || c.status } : c))
      setStatusError(e?.response?.data?.detail || e?.message || `Failed to update status for ${caseKey}`)
    } finally {
      setStatusUpdating(prev => {
        const next = new Set(prev)
        next.delete(caseKey)
        return next
      })
    }
  }, [cases, connectedProjectKey])

  useEffect(() => {
    if (ready) {
      loadFolders()
      loadTargets()
      loadStatuses()
    }
  }, [ready, loadFolders, loadTargets, loadStatuses])

  useEffect(() => {
    if (ready) loadCases(selectedFolderId, caseStatusFilter)
  }, [ready, selectedFolderId, caseStatusFilter, loadCases])

  const filteredCases = useMemo(() => {
    const q = caseSearch.trim().toLowerCase()
    return cases.filter(c => {
      if (caseStatusFilter && normalizeStatus(c.status) !== normalizeStatus(caseStatusFilter)) return false
      if (!q) return true
      return (
        c.key.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (c.folder || '').toLowerCase().includes(q)
      )
    })
  }, [cases, caseSearch, caseStatusFilter])

  const selectableFilteredCases = useMemo(
    () => filteredCases.filter(c => canSelectForGeneration(c.status)),
    [filteredCases],
  )

  useEffect(() => {
    // Keep the selection aligned with the current Zephyr status rules.
    setSelectedCaseKeys(prev => {
      const allowed = new Set(cases.filter(c => canSelectForGeneration(c.status)).map(c => c.key))
      let changed = false
      const next = new Set<string>()
      prev.forEach(key => {
        if (allowed.has(key)) {
          next.add(key)
        } else {
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [cases])

  const allVisibleSelected = selectableFilteredCases.length > 0 && selectableFilteredCases.every(c => selectedCaseKeys.has(c.key))
  const toggleAllVisible = () => {
    const next = new Set(selectedCaseKeys)
    if (allVisibleSelected) {
      for (const c of selectableFilteredCases) next.delete(c.key)
    } else {
      for (const c of selectableFilteredCases) next.add(c.key)
    }
    setSelectedCaseKeys(next)
  }

  const toggleCase = (key: string) => {
    const targetCase = cases.find(c => c.key === key)
    if (!targetCase || !canSelectForGeneration(targetCase.status)) return
    const next = new Set(selectedCaseKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelectedCaseKeys(next)
  }

  const toggleFolder = (id: string) => {
    const next = new Set(expandedFolders)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedFolders(next)
  }

  const selectedTarget = useMemo(() => targets.find(t => t.project_id === selectedProjectId) || null, [targets, selectedProjectId])
  const effectiveFramework = framework === 'auto' ? (selectedTarget?.detected_framework || 'auto') : framework

  const loadReferenceFolders = useCallback(async () => {
    const targetPath = customPath.trim()
    if (!targetPath && !selectedProjectId) {
      setReferenceFolderTree([])
      setReferenceFoldersFlat([])
      return
    }
    setReferenceFoldersLoading(true)
    try {
      const res = await apiService.listZephyrPlannerReferenceFolders(
        targetPath ? { targetPath } : { projectId: selectedProjectId },
      )
      const tree = buildFolderTree(
        res.folders.map(f => ({
          id: f.id,
          name: f.name,
          parent_id: f.parent_id,
          kind: 'folder',
          count: f.bru_count,
          files: f.bru_files || [],
        })),
      )
      setReferenceFolderTree(tree)
      setReferenceFoldersFlat(flattenFolderTree(tree))
      setExpandedReferenceFolders(new Set(tree.map(node => node.id)))
    } catch {
      setReferenceFolderTree([])
      setReferenceFoldersFlat([])
    } finally {
      setReferenceFoldersLoading(false)
    }
  }, [customPath, selectedProjectId])

  useEffect(() => {
    setSelectedReferenceFolder('')
    if (ready) void loadReferenceFolders()
  }, [ready, selectedProjectId, customPath, loadReferenceFolders])

  const filteredReferenceFolders = useMemo(() => {
    const q = referenceModalSearch.trim().toLowerCase()
    if (!q) return referenceFoldersFlat
    // Path-aware search: matches on the folder's own name or any segment of
    // its full path, and also on .bru file names inside that folder.
    return referenceFoldersFlat.filter(f =>
      f.name.toLowerCase().includes(q) ||
      f.id.toLowerCase().includes(q) ||
      f.files.some(file => file.toLowerCase().includes(q)),
    )
  }, [referenceFoldersFlat, referenceModalSearch])

  useEffect(() => {
    // In search mode, keep matched folders collapsed by default so the user
    // can explicitly expand only the entries they care about.
    setExpandedSearchReferenceFolders(new Set())
  }, [referenceModalSearch])

  const toggleReferenceFolder = (id: string) => {
    const next = new Set(expandedReferenceFolders)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedReferenceFolders(next)
  }

  const toggleSearchReferenceFolder = (id: string) => {
    const next = new Set(expandedSearchReferenceFolders)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedSearchReferenceFolders(next)
  }

  const canGenerate = selectedCaseKeys.size > 0 && (selectedProjectId || customPath.trim()) && !generating

  const handleGenerate = async () => {
    setGenerating(true)
    setGenError(null)
    setGenResult(null)
    try {
      const chosen = cases.filter(c => selectedCaseKeys.has(c.key))
      const payload: Parameters<typeof apiService.generateZephyrPlannerAutomation>[0] = {
        framework,
        output_subpath: outputSubpath.trim() || 'generated-automation',
        reference_folder: selectedReferenceFolder || undefined,
        cases: chosen.map(c => ({
          key: c.key,
          name: c.name,
          status: c.status,
          priority: c.priority,
          folder: c.folder,
          precondition: c.precondition,
          objective: c.objective,
          source: c.source,
          steps: c.steps.map(s => ({
            index: s.index,
            description: s.description,
            test_data: s.test_data,
            expected_result: s.expected_result,
          })),
        })),
      }
      if (customPath.trim()) {
        payload.target_path = customPath.trim()
      } else {
        payload.project_id = selectedProjectId
      }
      const res = await apiService.generateZephyrPlannerAutomation(payload)
      setGenResult(res)
    } catch (e: any) {
      setGenError(e?.response?.data?.detail || e?.message || 'Failed to generate automation script')
    } finally {
      setGenerating(false)
    }
  }

  if (!ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <FolderOpen size={30} className="text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">Jira / Zephyr not connected</p>
        <p className="max-w-sm text-xs text-gray-500 dark:text-gray-400">
          Configure Jira and select a project in Settings to use the Zephyr Automation Planner.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800/80">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Zephyr Automation Planner</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Project <span className="font-medium">{connectedProjectName || connectedProjectKey}</span>. Pick manual test cases and generate automation scripts into any local repository.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
            <span className="font-medium">Status:</span>
            <select
              value={caseStatusFilter}
              onChange={e => setCaseStatusFilter(e.target.value)}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              title="Filter Folders/Subfolders and Manual Test Cases by test case status"
            >
              <option value="">All statuses</option>
              {statusOptions.map(s => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          </label>
          <button
            onClick={() => { loadFolders(); loadCases(selectedFolderId, caseStatusFilter); loadTargets() }}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700/50"
          >
            <RefreshCcw size={13} /> Refresh
          </button>
        </div>
      </div>

      <div
        ref={panelsRef}
        className={`flex min-h-0 flex-1 flex-col gap-3 md:flex-row md:gap-0 ${isResizing ? 'select-none' : ''}`}
        style={{ '--zephyr-left-panel': `${leftPanelWidth}%` } as Record<string, string>}
      >
        {/* Folders panel */}
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/80 md:min-w-[280px] md:shrink-0 md:basis-[var(--zephyr-left-panel)] md:rounded-r-none">
          <div className="border-b border-gray-100 px-3 py-1.5 text-xs font-semibold uppercase text-gray-500 dark:border-gray-700 dark:text-gray-400">
            Folders/Subfolders
          </div>
          <div className="flex-1 overflow-auto p-2 text-xs">
            {foldersLoading ? (
              <div className="flex items-center gap-1.5 p-2 text-gray-500 dark:text-gray-400">
                <Loader2 size={12} className="animate-spin" /> Loading…
              </div>
            ) : foldersError ? (
              <div className="flex items-start gap-1.5 rounded-md bg-red-50 p-2 text-red-700 dark:bg-red-900/20 dark:text-red-300">
                <AlertCircle size={12} className="mt-0.5" /> {foldersError}
              </div>
            ) : folders.length === 0 ? (
              <div className="p-2 text-gray-400">No folders/subfolders.</div>
            ) : (
              <FolderList
                nodes={folders}
                depth={0}
                selectedId={selectedFolderId}
                expanded={expandedFolders}
                onSelect={setSelectedFolderId}
                onToggle={toggleFolder}
              />
            )}
          </div>
        </div>

        <div
          className="relative hidden w-2 shrink-0 cursor-col-resize md:flex"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize folders and cases panels"
          onMouseDown={() => setIsResizing(true)}
        >
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gray-200 dark:bg-gray-700" />
          <div className="absolute left-1/2 top-1/2 h-10 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-300/80 dark:bg-gray-600/80" />
        </div>

        {/* Cases panel */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/80 md:rounded-l-none">
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-1.5 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Manual Test Cases</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {selectedCaseKeys.size} selected / {filteredCases.length} shown
              </span>
            </div>
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={caseSearch}
                onChange={e => setCaseSearch(e.target.value)}
                placeholder="Search key / name / folder"
                className="w-64 rounded-md border border-gray-200 bg-white py-1 pl-6 pr-2 text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
          </div>

          {statusError && (
            <div className="mx-3 mt-2 flex items-start gap-1.5 rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span className="flex-1">{statusError}</span>
              <button onClick={() => setStatusError(null)} className="shrink-0 text-red-500 hover:text-red-700 dark:text-red-400">✕</button>
            </div>
          )}

          <div className="flex-1 overflow-auto">
            {casesLoading ? (
              <div className="flex items-center gap-1.5 p-4 text-xs text-gray-500 dark:text-gray-400">
                <Loader2 size={12} className="animate-spin" /> Loading test cases…
              </div>
            ) : casesError ? (
              <div className="m-3 flex items-start gap-1.5 rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span className="flex-1">{casesError}</span>
                <button
                  onClick={() => loadCases(selectedFolderId, caseStatusFilter)}
                  className="shrink-0 rounded border border-red-300 px-1.5 py-0.5 text-[10px] font-medium text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/30"
                >
                  Retry
                </button>
              </div>
            ) : !selectedFolderId ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-gray-400">
                <Folder size={22} className="text-gray-300 dark:text-gray-600" />
                Select a folder on the left to view its test cases.
              </div>
            ) : filteredCases.length === 0 ? (
              <div className="p-4 text-center text-xs text-gray-400">
                No test cases in this folder yet.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-gray-50 text-[11px] uppercase text-gray-500 dark:bg-gray-900/60 dark:text-gray-400">
                  <tr>
                    <th className="w-8 px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        disabled={selectableFilteredCases.length === 0}
                        title={selectableFilteredCases.length === 0 ? 'No visible cases are Suggested for Automation' : 'Select all visible Suggested for Automation cases'}
                      />
                    </th>
                    <th className="w-6 px-1"></th>
                    <th className="px-2 py-1.5">Key</th>
                    <th className="px-2 py-1.5">Name</th>
                    <th className="px-2 py-1.5">Priority</th>
                    <th className="px-2 py-1.5">Status</th>
                    <th className="px-2 py-1.5">Story/Task ID</th>
                    <th className="px-2 py-1.5">Story/Task Status</th>
                    <th className="px-2 py-1.5">Team</th>
                    <th className="px-2 py-1.5">Folder</th>
                    <th className="px-2 py-1.5">Steps</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCases.map(c => {
                    const expanded = expandedCaseKey === c.key
                    const selectable = canSelectForGeneration(c.status)
                    return (
                      <Fragment key={c.key}>
                        <tr
                          className="border-t border-gray-100 hover:bg-gray-50 dark:border-gray-700/50 dark:hover:bg-gray-700/30"
                        >
                          <td className="px-2 py-1.5">
                            <input
                              type="checkbox"
                              checked={selectedCaseKeys.has(c.key)}
                              onChange={() => toggleCase(c.key)}
                              disabled={!selectable}
                              title={selectable ? 'Select for generation' : 'Only Suggested for Automation cases can be generated'}
                            />
                          </td>
                          <td className="px-1">
                            <button
                              onClick={() => setExpandedCaseKey(expanded ? '' : c.key)}
                              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                            >
                              <ChevronRight
                                size={12}
                                className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
                              />
                            </button>
                          </td>
                          <td className="px-2 py-1.5 font-mono text-blue-600 dark:text-blue-400">{c.key}</td>
                          <td className="px-2 py-1.5">{c.name || <span className="text-gray-400">(no name)</span>}</td>
                          <td className="px-2 py-1.5">{c.priority || '—'}</td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1.5">
                              {statusUpdating.has(c.key) && <Loader2 size={11} className="animate-spin text-gray-400" />}
                              {statusOptions.length > 0 ? (
                                <select
                                  value={c.status || ''}
                                  disabled={statusUpdating.has(c.key)}
                                  onClick={e => e.stopPropagation()}
                                  onChange={e => handleStatusChange(c.key, e.target.value)}
                                  className="rounded px-1.5 py-0.5 text-[10px] font-medium disabled:opacity-60"
                                  style={{
                                    backgroundColor: `${statusOptions.find(s => s.name === c.status)?.color || '#e5e7eb'}22`,
                                    color: statusOptions.find(s => s.name === c.status)?.color || undefined,
                                  }}
                                >
                                  {!statusOptions.some(s => s.name === c.status) && c.status && (
                                    <option value={c.status}>{c.status}</option>
                                  )}
                                  {statusOptions.map(s => (
                                    <option key={s.name} value={s.name}>{s.name}</option>
                                  ))}
                                </select>
                              ) : (
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(c.status)}`}>
                                  {c.status || 'n/a'}
                                </span>
                              )}
                              {!selectable && (
                                <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                                  not selectable
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 font-mono text-[11px] text-indigo-600 dark:text-indigo-300">
                            {c.story_task_id || '—'}
                          </td>
                          <td className="px-2 py-1.5">
                            {c.story_task_status ? (
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(c.story_task_status)}`}>
                                {c.story_task_status}
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            {c.story_task_team ? (
                              <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-500/10 dark:text-purple-300">
                                {c.story_task_team}
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">{c.folder || '—'}</td>
                          <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">{c.steps.length}</td>
                        </tr>
                        {expanded && (
                          <tr className="bg-gray-50/60 dark:bg-gray-900/40">
                            <td></td><td></td>
                            <td colSpan={9} className="px-3 py-2">
                              {c.precondition && (
                                <div className="mb-1"><span className="font-semibold">Precondition:</span> {c.precondition}</div>
                              )}
                              {c.objective && (
                                <div className="mb-1"><span className="font-semibold">Objective:</span> {c.objective}</div>
                              )}
                              <ol className="ml-4 mt-1 list-decimal space-y-1">
                                {c.steps.map(s => (
                                  <li key={s.index}>
                                    <div>{s.description || <span className="text-gray-400">(empty step)</span>}</div>
                                    {s.test_data && <div className="text-gray-500">Data: {s.test_data}</div>}
                                    {s.expected_result && <div className="text-emerald-600 dark:text-emerald-400">Expected: {s.expected_result}</div>}
                                  </li>
                                ))}
                              </ol>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Generator bar */}
      <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/80">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-gray-600 dark:text-gray-300">Target project</span>
            <select
              value={selectedProjectId}
              onChange={e => { setSelectedProjectId(e.target.value); setCustomPath('') }}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              disabled={targetsLoading}
            >
              <option value="">— pick a project —</option>
              {targets.map(t => (
                <option key={t.project_id} value={t.project_id}>
                  {t.project_name} · {t.detected_framework}
                </option>
              ))}
            </select>
            {selectedTarget && (
              <span className="truncate text-[10px] text-gray-500" title={selectedTarget.local_repo_path}>
                {selectedTarget.local_repo_path}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-xs md:col-span-2">
            <span className="font-medium text-gray-600 dark:text-gray-300">Or absolute path (override)</span>
            <input
              value={customPath}
              onChange={e => { setCustomPath(e.target.value); if (e.target.value) setSelectedProjectId('') }}
              placeholder="/absolute/path/to/local/repo"
              className="rounded-md border border-gray-200 bg-white px-2 py-1 font-mono text-[11px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-gray-600 dark:text-gray-300">Framework</span>
            <select
              value={framework}
              onChange={e => setFramework(e.target.value)}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="auto">Auto detect ({effectiveFramework})</option>
              <option value="bruno">Bruno</option>
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-xs">
          <span className="flex items-center gap-1.5 font-medium text-gray-600 dark:text-gray-300">
            Reference collection (optional)
            {referenceFoldersLoading && <Loader2 size={11} className="animate-spin text-gray-400" />}
          </span>
          <button
            type="button"
            disabled={referenceFoldersLoading || (!selectedProjectId && !customPath.trim())}
            onClick={() => { setReferenceModalSearch(''); setShowReferenceModal(true) }}
            className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-left font-mono text-[10px] disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            <span className="truncate">
              {selectedReferenceFolder
                ? (referenceFoldersFlat.find(f => f.id === selectedReferenceFolder)?.name || selectedReferenceFolder)
                : '— none (generate steps only) —'}
            </span>
            <Search size={12} className="shrink-0 text-gray-400" />
          </button>
          <span className="text-[9px] text-gray-500 dark:text-gray-400">
            Pick an existing local .bru folder to reuse — its requests are copied first, then the Zephyr steps are added after them.
          </span>
        </label>

        <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-end">
          <label className="flex flex-1 flex-col gap-1 text-xs">
            <span className="font-medium text-gray-600 dark:text-gray-300">Output subfolder (relative to target)</span>
            <input
              value={outputSubpath}
              onChange={e => setOutputSubpath(e.target.value)}
              placeholder="generated-automation"
              className="rounded-md border border-gray-200 bg-white px-2 py-1 font-mono text-[11px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </label>
          <button
            disabled={!canGenerate}
            onClick={handleGenerate}
            className="btn-primary flex items-center gap-1.5 disabled:opacity-50"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            Generate {selectedCaseKeys.size} case{selectedCaseKeys.size === 1 ? '' : 's'}
          </button>
        </div>

        {genError && (
          <div className="flex items-start gap-1.5 rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
            <AlertCircle size={12} className="mt-0.5" /> {genError}
          </div>
        )}

        {genResult && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-2 text-xs dark:border-emerald-900/60 dark:bg-emerald-900/20">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
              <Rocket size={13} /> Generated {genResult.created_files.length} file{genResult.created_files.length === 1 ? '' : 's'} · framework: {genResult.framework}
            </div>
            <div className="text-gray-500 dark:text-gray-400">Output: <span className="font-mono">{genResult.output_dir}</span></div>
            {genResult.warnings.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-amber-700 dark:text-amber-300">
                {genResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
            {genResult.skipped_cases.length > 0 && (
              <div className="mt-1">
                Skipped:{' '}
                {genResult.skipped_cases.map(s => `${s.key || '(no key)'} — ${s.reason}`).join('; ')}
              </div>
            )}
            {genResult.created_files.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-gray-600 dark:text-gray-300">Show file list</summary>
                <ul className="mt-1 max-h-40 overflow-auto pl-3 font-mono text-[11px] text-gray-500 dark:text-gray-400">
                  {genResult.created_files.map(f => <li key={f}>{f}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      {/* Reference collection picker — popup with search, instead of a plain dropdown */}
      {showReferenceModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setShowReferenceModal(false)}
        >
          <div
            className="flex max-h-[80vh] w-[95vw] max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-800"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
              <h3 className="text-[13px] font-semibold text-gray-900 dark:text-white">Select reference collection</h3>
              <button
                onClick={() => setShowReferenceModal(false)}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="border-b border-gray-100 p-3 dark:border-gray-700">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  autoFocus
                  value={referenceModalSearch}
                  onChange={e => setReferenceModalSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setShowReferenceModal(false) }}
                  placeholder="Search folders by name or path…"
                  className="w-full rounded-md border border-gray-200 bg-white py-1.5 pl-8 pr-2 text-[11px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
              </div>
            </div>

            <div className="flex-1 overflow-auto p-2">
              <div className="min-w-max">
                <button
                  onClick={() => { setSelectedReferenceFolder(''); setShowReferenceModal(false) }}
                  className={`mb-1 flex min-w-max items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] ${
                    !selectedReferenceFolder ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }`}
                >
                  — none (generate steps only) —
                </button>

                {filteredReferenceFolders.length === 0 ? (
                  <div className="p-4 text-center text-[11px] text-gray-400">No folders match your search.</div>
                ) : referenceModalSearch.trim() ? (
                  filteredReferenceFolders.map(f => {
                    const selectable = f.bru_count > 0
                    const isSelected = selectedReferenceFolder === f.id
                    const hasExpandableContent = f.files.length > 0 || f.has_children
                    const isExpanded = expandedSearchReferenceFolders.has(f.id)
                    return (
                      <div key={f.id} className="mb-1">
                        <div
                          className={`flex min-w-max items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] ${
                            isSelected ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                          }`}
                        >
                          {hasExpandableContent ? (
                            <button
                              onClick={() => toggleSearchReferenceFolder(f.id)}
                              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                              aria-label={isExpanded ? 'Collapse matched folder' : 'Expand matched folder'}
                            >
                              <ChevronRight size={11} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                          ) : (
                            <span className="w-[11px]" />
                          )}
                          <button
                            disabled={!selectable}
                            onClick={() => { setSelectedReferenceFolder(f.id); setShowReferenceModal(false) }}
                            title={f.id}
                            className="flex min-w-max items-center gap-1.5 text-left disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Folder size={12} className="shrink-0" />
                            <span className="font-mono whitespace-nowrap">{f.id}</span>
                            {selectable && (
                              <span className="shrink-0 rounded-full bg-gray-100 px-1.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                                {f.bru_count}
                              </span>
                            )}
                          </button>
                        </div>
                        {isExpanded && f.files.length > 0 && (
                          <ul className="mt-0.5 space-y-0.5">
                            {f.files.map(file => (
                              <li key={`${f.id}/${file}`}>
                                <div
                                  className="flex min-w-max items-center gap-1 rounded-md px-2 py-1 text-[10px] text-gray-500 dark:text-gray-400"
                                  style={{ paddingLeft: 24 }}
                                  title={`${f.id}/${file}`}
                                >
                                  <FileText size={10} className="shrink-0" />
                                  <span className="font-mono whitespace-nowrap">{file}</span>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )
                  })
                ) : (
                  <ReferenceFolderTree
                    nodes={referenceFolderTree}
                    selectedId={selectedReferenceFolder}
                    expanded={expandedReferenceFolders}
                    onSelect={(id) => { setSelectedReferenceFolder(id); setShowReferenceModal(false) }}
                    onToggle={toggleReferenceFolder}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface FolderListProps {
  nodes: FolderNode[]
  depth: number
  selectedId: string
  expanded: Set<string>
  onSelect: (id: string) => void
  onToggle: (id: string) => void
}

interface ReferenceFolderTreeProps {
  nodes: FolderNode[]
  selectedId: string
  expanded: Set<string>
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  depth?: number
}

function ReferenceFolderTree({ nodes, selectedId, expanded, onSelect, onToggle, depth = 0 }: ReferenceFolderTreeProps) {
  return (
    <ul className="space-y-0.5 text-[11px]">
      {nodes.map(node => {
        const hasChildren = node.children.length > 0
        const isOpen = expanded.has(node.id)
        const isSelected = selectedId === node.id
        const selectable = (node.count ?? 0) > 0
        return (
          <li key={node.id}>
            <div
              className={`flex items-center gap-1 rounded-md px-1 py-1 ${
                isSelected ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {hasChildren ? (
                <button
                  onClick={() => onToggle(node.id)}
                  className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  aria-label={isOpen ? 'Collapse' : 'Expand'}
                >
                  <ChevronRight size={11} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                </button>
              ) : (
                <span className="w-[11px]" />
              )}
              <button
                disabled={!selectable}
                onClick={() => onSelect(node.id)}
                title={node.id}
                className="flex min-w-max items-center gap-1 text-left disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Folder size={11} className="shrink-0" />
                <span className="font-mono whitespace-nowrap">{node.name}</span>
                {typeof node.count === 'number' && node.count > 0 && (
                  <span className="ml-auto shrink-0 rounded-full bg-gray-100 px-1.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                    {node.count}
                  </span>
                )}
              </button>
            </div>
            {isOpen && (node.files?.length || 0) > 0 && (
              <ul className="space-y-0.5">
                {(node.files || []).map(file => (
                  <li key={`${node.id}/${file}`}>
                    <div
                      className="flex min-w-max items-center gap-1 rounded-md px-1 py-1 text-[10px] text-gray-500 dark:text-gray-400"
                      style={{ paddingLeft: 24 + depth * 14 }}
                      title={`${node.id}/${file}`}
                    >
                      <FileText size={10} className="shrink-0" />
                      <span className="font-mono whitespace-nowrap">{file}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {isOpen && hasChildren && (
              <ReferenceFolderTree
                nodes={node.children}
                selectedId={selectedId}
                expanded={expanded}
                onSelect={onSelect}
                onToggle={onToggle}
                depth={depth + 1}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function FolderList({ nodes, depth, selectedId, expanded, onSelect, onToggle }: FolderListProps) {
  return (
    <ul className="space-y-0.5">
      {nodes.map(n => {
        const hasChildren = n.children.length > 0
        const isOpen = expanded.has(n.id)
        const isSelected = selectedId === n.id
        return (
          <li key={n.id}>
            <div
              className={`flex items-center gap-1 rounded-md px-1 py-1 ${
                isSelected ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
              style={{ paddingLeft: 4 + depth * 10 }}
            >
              {hasChildren ? (
                <button
                  onClick={() => onToggle(n.id)}
                  className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  aria-label={isOpen ? 'Collapse' : 'Expand'}
                >
                  <ChevronRight size={11} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                </button>
              ) : <span className="w-[11px]" />}
              <button onClick={() => onSelect(n.id)} className="flex flex-1 items-center gap-1 truncate">
                <Folder size={11} className="shrink-0" />
                <span className="truncate">{n.name}</span>
                {typeof n.count === 'number' && n.count > 0 && (
                  <span className="ml-auto shrink-0 rounded-full bg-gray-100 px-1.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                    {n.count}
                  </span>
                )}
              </button>
            </div>
            {isOpen && hasChildren && (
              <FolderList
                nodes={n.children}
                depth={depth + 1}
                selectedId={selectedId}
                expanded={expanded}
                onSelect={onSelect}
                onToggle={onToggle}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}
