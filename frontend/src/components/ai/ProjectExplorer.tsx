import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, Loader2, RefreshCw } from 'lucide-react'
import { apiService } from '@/services/api'
import type { GitHubTreeItem } from '@/types/domain'

/** VS Code-like explorer of the linked local checkout: folders expand in place, files open on click. */
export default function ProjectExplorer({
  projectId,
  reloadKey,
  activePath,
  onOpenFile,
  header,
}: {
  projectId: string
  reloadKey: number
  activePath: string | null
  onOpenFile: (path: string) => void
  /** Shown under the title (e.g. the branch picker). */
  header?: ReactNode
}) {
  const [children, setChildren] = useState<Record<string, GitHubTreeItem[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (path: string) => {
    setLoading(s => new Set(s).add(path))
    try {
      const items = await apiService.getLocalRepoTree(projectId, path)
      items.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)))
      setChildren(c => ({ ...c, [path]: items }))
      if (!path) setError(null)
    } catch (e) {
      if (!path) setError(apiService.errorMessage(e))
    } finally {
      setLoading(s => {
        const next = new Set(s)
        next.delete(path)
        return next
      })
    }
  }, [projectId])

  // Reload the root and every open folder (after the assistant applied files, or on refresh).
  const reloadAll = useCallback(() => {
    void load('')
    expanded.forEach(path => void load(path))
  }, [expanded, load])

  useEffect(() => {
    setChildren({})
    setExpanded(new Set())
    void load('')
  }, [load])

  useEffect(() => {
    if (reloadKey) reloadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  const toggle = (item: GitHubTreeItem) => {
    if (item.type !== 'dir') {
      onOpenFile(item.path)
      return
    }
    setExpanded(s => {
      const next = new Set(s)
      if (next.has(item.path)) next.delete(item.path)
      else {
        next.add(item.path)
        if (!children[item.path]) void load(item.path)
      }
      return next
    })
  }

  const renderLevel = (path: string, depth: number) => (children[path] ?? []).map(item => {
    const open = expanded.has(item.path)
    const dir = item.type === 'dir'
    return (
      <div key={item.path}>
        <button
          onClick={() => toggle(item)}
          className={`flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[12px] ${item.path === activePath
            ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200'
            : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/50'}`}
          style={{ paddingLeft: 6 + depth * 12 }}
          title={dir ? item.path : `${item.path} — open and add as a chat reference`}
        >
          {dir ? (open ? <ChevronDown size={12} className="shrink-0 text-gray-400" /> : <ChevronRight size={12} className="shrink-0 text-gray-400" />) : <span className="w-3 shrink-0" />}
          {dir
            ? (open ? <FolderOpen size={13} className="shrink-0 text-amber-400" /> : <Folder size={13} className="shrink-0 text-amber-400" />)
            : <File size={13} className="shrink-0 text-gray-400" />}
          <span className="truncate">{item.name}</span>
          {loading.has(item.path) && <Loader2 size={11} className="ml-auto shrink-0 animate-spin text-gray-400" />}
        </button>
        {dir && open && renderLevel(item.path, depth + 1)}
      </div>
    )
  })

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Explorer</span>
        <button onClick={reloadAll} className="rounded p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="Refresh">
          <RefreshCw size={12} className={loading.has('') ? 'animate-spin' : ''} />
        </button>
      </div>
      {header && <div className="shrink-0 border-b border-gray-200 px-3 py-1.5 dark:border-gray-700">{header}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {error ? <p className="px-3 py-2 text-xs text-red-500">{error}</p>
          : !children[''] ? <p className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400"><Loader2 size={12} className="animate-spin" /> Loading…</p>
            : children[''].length === 0 ? <p className="px-3 py-2 text-xs text-gray-400">Empty project.</p>
              : renderLevel('', 0)}
      </div>
    </div>
  )
}
