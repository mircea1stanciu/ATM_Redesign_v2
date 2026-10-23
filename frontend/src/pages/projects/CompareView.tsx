import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  File,
  FileDiff,
  Folder,
  FolderOpen,
  GitCompare,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { apiService } from '@/services/api'
import type { Branch, LocalRepoStatus, RepoCompareFile, RepoCompareResult } from '@/types/domain'
import DiffViewer from './DiffViewer'

interface CompareViewProps {
  projectId: string
}

interface SourceOption {
  value: string
  label: string
}

interface CompareTreeFileNode {
  type: 'file'
  name: string
  path: string
  file: RepoCompareFile
}

interface CompareTreeDirNode {
  type: 'dir'
  name: string
  path: string
  children: CompareTreeNode[]
  fileCount: number
  additions: number
  deletions: number
}

type CompareTreeNode = CompareTreeFileNode | CompareTreeDirNode

const STATUS_STYLES: Record<string, { badge: string; label: string }> = {
  added: { badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', label: 'A' },
  modified: { badge: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300', label: 'M' },
  deleted: { badge: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300', label: 'D' },
  renamed: { badge: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300', label: 'R' },
  copied: { badge: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300', label: 'C' },
}

const COMPARE_SPLIT_STORAGE_KEY = 'projects.compare.leftPanelWidth'

export default function CompareView({ projectId }: CompareViewProps) {
  const [branches, setBranches] = useState<Branch[]>([])
  const [local, setLocal] = useState<LocalRepoStatus | null>(null)
  const [optionsError, setOptionsError] = useState<string | null>(null)

  const [base, setBase] = useState('main')
  const [head, setHead] = useState('local')

  const [result, setResult] = useState<RepoCompareResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return 32
    const raw = Number(window.localStorage.getItem(COMPARE_SPLIT_STORAGE_KEY) || '')
    return Number.isFinite(raw) ? Math.min(70, Math.max(18, raw)) : 32
  })
  const [isResizing, setIsResizing] = useState(false)
  const panelsRef = useRef<HTMLDivElement | null>(null)

  const loadOptions = useCallback(async () => {
    setOptionsError(null)
    try {
      const [b, l] = await Promise.all([
        apiService.listBranches(projectId).catch(() => [] as Branch[]),
        apiService.getLocalRepoStatus(projectId).catch(() => null),
      ])
      setBranches(b)
      setLocal(l)
    } catch (e: unknown) {
      setOptionsError(apiService.errorMessage(e))
    }
  }, [projectId])

  useEffect(() => {
    void loadOptions()
  }, [loadOptions])

  const sourceOptions = useMemo<SourceOption[]>(() => {
    const opts: SourceOption[] = [{ value: 'main', label: 'GitHub · main (default)' }]
    branches
      .filter(b => !b.is_default)
      .forEach(b => opts.push({ value: `branch:${b.name}`, label: `GitHub · ${b.name}` }))
    if (local?.is_git_repo) {
      opts.push({ value: 'local', label: `Local copy${local.current_branch ? ` · ${local.current_branch}` : ''}` })
    } else {
      opts.push({ value: 'local', label: 'Local copy (not cloned)' })
    }
    return opts
  }, [branches, local])

  const runCompare = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSelectedPath(null)
    try {
      const res = await apiService.compareRepoSources(projectId, base, head)
      setResult(res)
      setSelectedPath(res.files[0]?.path ?? null)
    } catch (e: unknown) {
      setError(apiService.errorMessage(e))
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [projectId, base, head])

  const swap = () => {
    setBase(head)
    setHead(base)
  }

  const selectedFile: RepoCompareFile | null = useMemo(
    () => result?.files.find(f => f.path === selectedPath) ?? null,
    [result, selectedPath],
  )

  const treeNodes = useMemo<CompareTreeNode[]>(
    () => buildCompareTree(result?.files ?? []),
    [result],
  )

  useEffect(() => {
    if (!treeNodes.length) {
      setExpandedDirs(new Set())
      return
    }
    const topLevel = new Set<string>()
    treeNodes.forEach(node => {
      if (node.type === 'dir') topLevel.add(node.path)
    })
    setExpandedDirs(topLevel)
  }, [treeNodes])

  useEffect(() => {
    if (!selectedPath) return
    setExpandedDirs(prev => {
      const next = new Set(prev)
      const parts = selectedPath.split('/')
      let acc = ''
      for (let i = 0; i < parts.length - 1; i += 1) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i]
        next.add(acc)
      }
      return next
    })
  }, [selectedPath])

  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  useEffect(() => {
    if (!isResizing) return

    const onMove = (event: MouseEvent) => {
      const container = panelsRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return

      const raw = ((event.clientX - rect.left) / rect.width) * 100
      const clamped = Math.min(70, Math.max(18, raw))
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
    window.localStorage.setItem(COMPARE_SPLIT_STORAGE_KEY, String(leftPanelWidth))
  }, [leftPanelWidth])

  const startResize = () => {
    setIsResizing(true)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Selector bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Base</span>
        <select
          value={base}
          onChange={e => setBase(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
        >
          {sourceOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <button
          onClick={swap}
          title="Swap base / compare"
          className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
        >
          <ArrowLeftRight size={13} />
        </button>

        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Compare</span>
        <select
          value={head}
          onChange={e => setHead(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
        >
          {sourceOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <button
          onClick={() => void runCompare()}
          disabled={loading || base === head}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <GitCompare size={13} />}
          Compare
        </button>
      </div>

      {optionsError && (
        <p className="text-xs text-amber-500">Could not load all sources: {optionsError}</p>
      )}
      {base === head && (
        <p className="text-xs text-gray-400">Pick two different sources to compare.</p>
      )}

      {/* Body */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-gray-400">
          <Loader2 size={18} className="animate-spin" /> Comparing… (fetching latest from GitHub)
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <FileDiff size={28} className="text-red-400" />
          <p className="max-w-md text-sm text-red-500 dark:text-red-400">{error}</p>
          <button
            onClick={() => void runCompare()}
            className="mt-1 flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      ) : !result ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <GitCompare size={28} className="text-gray-300 dark:text-gray-600" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Choose two sources and press “Compare”.</p>
          <p className="max-w-md text-xs text-gray-400">
            Compare the GitHub main branch, any GitHub branch, or your local copy against each
            other — like the “Changes” tab of a pull request.
          </p>
        </div>
      ) : result.files.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <FileDiff size={28} className="text-emerald-400" />
          <p className="text-sm text-gray-600 dark:text-gray-300">
            No differences between <b>{result.base_label}</b> and <b>{result.head_label}</b>.
          </p>
        </div>
      ) : (
        <div className={`flex flex-1 min-h-0 flex-col gap-2 ${isResizing ? 'select-none' : ''}`}>
          {/* Summary */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <span className="font-medium text-gray-700 dark:text-gray-200">{result.base_label}</span>
            <ArrowLeftRight size={12} />
            <span className="font-medium text-gray-700 dark:text-gray-200">{result.head_label}</span>
            <span className="mx-1 h-3 w-px bg-gray-300 dark:bg-gray-600" />
            <span>{result.total_files} file{result.total_files === 1 ? '' : 's'} changed</span>
            <span className="text-emerald-600 dark:text-emerald-400">+{result.total_additions}</span>
            <span className="text-red-600 dark:text-red-400">−{result.total_deletions}</span>
            {result.truncated && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                truncated to first {result.files.length} files
              </span>
            )}
          </div>

          <div ref={panelsRef} className="flex flex-1 min-h-0 flex-col gap-3 md:flex-row md:gap-0">
            {/* File list */}
            <div
              className="min-h-[180px] min-w-0 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 md:min-h-0 md:rounded-r-none"
              style={{ width: `clamp(220px, ${leftPanelWidth}%, 70%)` }}
            >
              <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {renderTreeNodes(treeNodes, {
                  depth: 0,
                  selectedPath,
                  expandedDirs,
                  onToggleDir: toggleDir,
                  onSelectFile: setSelectedPath,
                })}
              </div>
            </div>

            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize compare panels"
              onMouseDown={startResize}
              className="hidden w-2 cursor-col-resize items-stretch justify-center md:flex"
              title="Drag to resize panels"
            >
              <div className={`w-px rounded-full transition-colors ${isResizing ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-700'}`} />
            </div>

            {/* Diff panel */}
            <div className="min-h-[180px] min-w-0 flex-1 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 md:min-h-0 md:rounded-l-none">
              {!selectedFile ? (
                <div className="flex h-full items-center justify-center text-xs text-gray-400">
                  Select a file to view its diff.
                </div>
              ) : (
                <div>
                  <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/40 px-3 py-2">
                    <FileDiff size={13} className="shrink-0 text-gray-400" />
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-700 dark:text-gray-200">
                      {selectedFile.old_path && selectedFile.old_path !== selectedFile.path
                        ? `${selectedFile.old_path} → ${selectedFile.path}`
                        : selectedFile.path}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums">
                      <span className="text-emerald-600 dark:text-emerald-400">+{selectedFile.additions}</span>{' '}
                      <span className="text-red-600 dark:text-red-400">−{selectedFile.deletions}</span>
                    </span>
                  </div>
                  {selectedFile.binary ? (
                    <div className="p-4 text-xs text-gray-400 italic">Binary file — diff not shown.</div>
                  ) : selectedFile.patch ? (
                    <>
                      <DiffViewer patch={selectedFile.patch} />
                      {selectedFile.patch_truncated && (
                        <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-2 text-[10px] text-amber-600 dark:text-amber-400">
                          Diff truncated — file is too large to display in full.
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="p-4 text-xs text-gray-400 italic">No textual changes (e.g. rename or mode change only).</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function renderTreeNodes(
  nodes: CompareTreeNode[],
  params: {
    depth: number
    selectedPath: string | null
    expandedDirs: Set<string>
    onToggleDir: (path: string) => void
    onSelectFile: (path: string) => void
  },
): JSX.Element[] {
  const { depth, selectedPath, expandedDirs, onToggleDir, onSelectFile } = params
  const rows: JSX.Element[] = []

  nodes.forEach(node => {
    if (node.type === 'dir') {
      const expanded = expandedDirs.has(node.path)
      rows.push(
        <button
          key={`dir:${node.path}`}
          onClick={() => onToggleDir(node.path)}
          className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
          style={{ paddingLeft: `${10 + depth * 16}px` }}
        >
          {expanded ? <ChevronDown size={12} className="shrink-0 text-gray-400" /> : <ChevronRight size={12} className="shrink-0 text-gray-400" />}
          {expanded ? <FolderOpen size={12} className="shrink-0 text-blue-500" /> : <Folder size={12} className="shrink-0 text-gray-400" />}
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-700 dark:text-gray-300">{node.name}</span>
          <span className="shrink-0 text-[9px] text-gray-400">{node.fileCount}</span>
          <span className="shrink-0 text-[9px] tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">+{node.additions}</span>{' '}
            <span className="text-red-600 dark:text-red-400">−{node.deletions}</span>
          </span>
        </button>,
      )

      if (expanded) {
        rows.push(
          ...renderTreeNodes(node.children, {
            ...params,
            depth: depth + 1,
          }),
        )
      }
      return
    }

    const file = node.file
    const style = STATUS_STYLES[file.status] ?? STATUS_STYLES.modified
    const active = node.path === selectedPath
    rows.push(
      <button
        key={`file:${node.path}`}
        onClick={() => onSelectFile(node.path)}
        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
          active ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
        }`}
        style={{ paddingLeft: `${26 + depth * 16}px` }}
      >
        <span className={`grid h-4 w-4 shrink-0 place-items-center rounded text-[9px] font-bold ${style.badge}`}>
          {style.label}
        </span>
        <File size={11} className="shrink-0 text-gray-400" />
        <span className={`min-w-0 flex-1 truncate text-[11px] font-medium ${active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
          {node.name}
        </span>
        <span className="shrink-0 text-[9px] tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>{' '}
          <span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
        </span>
      </button>,
    )
  })

  return rows
}

function buildCompareTree(files: RepoCompareFile[]): CompareTreeNode[] {
  interface DirBuilder {
    name: string
    path: string
    dirs: Map<string, DirBuilder>
    files: RepoCompareFile[]
    fileCount: number
    additions: number
    deletions: number
  }

  const root: DirBuilder = {
    name: '',
    path: '',
    dirs: new Map(),
    files: [],
    fileCount: 0,
    additions: 0,
    deletions: 0,
  }

  files.forEach(file => {
    const parts = file.path.split('/').filter(Boolean)
    if (!parts.length) return

    let cursor = root
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i]
      const nextPath = cursor.path ? `${cursor.path}/${name}` : name
      let child = cursor.dirs.get(name)
      if (!child) {
        child = {
          name,
          path: nextPath,
          dirs: new Map(),
          files: [],
          fileCount: 0,
          additions: 0,
          deletions: 0,
        }
        cursor.dirs.set(name, child)
      }
      child.fileCount += 1
      child.additions += file.additions
      child.deletions += file.deletions
      cursor = child
    }

    cursor.files.push(file)
  })

  const toNodes = (dir: DirBuilder): CompareTreeNode[] => {
    const dirNodes: CompareTreeNode[] = [...dir.dirs.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map<CompareTreeNode>(child => ({
        type: 'dir',
        name: child.name,
        path: child.path,
        children: toNodes(child),
        fileCount: child.fileCount,
        additions: child.additions,
        deletions: child.deletions,
      }))

    const fileNodes: CompareTreeNode[] = [...dir.files]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map<CompareTreeNode>(file => ({
        type: 'file',
        name: file.path.split('/').pop() || file.path,
        path: file.path,
        file,
      }))

    return [...dirNodes, ...fileNodes]
  }

  return toNodes(root)
}
