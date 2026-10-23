import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ChevronRight, File, Folder, FolderGit2, Loader2 } from 'lucide-react'
import type { GitHubTreeItem } from '@/types/domain'

interface RepoTreePanelProps {
  title: string
  icon?: ReactNode
  /** Extra content rendered in the header (e.g. a branch selector). */
  headerControls?: ReactNode
  /** Buttons rendered on the right of the header (e.g. a sync button). */
  headerActions?: ReactNode
  /** Loads the directory listing for a given path from the repo root. */
  loadTree: (path: string) => Promise<GitHubTreeItem[]>
  /** When this value changes, the panel resets to root and reloads. */
  reloadKey?: string | number
  /** When true, the tree is not loaded and the disabled message is shown. */
  disabled?: boolean
  disabledMessage?: ReactNode
  accentClassName?: string
  /** Called when a file (not a directory) is clicked. */
  onFileClick?: (item: GitHubTreeItem) => void
  /** Path of the currently-selected file, for highlighting. */
  activePath?: string | null
}

export default function RepoTreePanel({
  title,
  icon,
  headerControls,
  headerActions,
  loadTree,
  reloadKey,
  disabled = false,
  disabledMessage,
  accentClassName = 'text-gray-500 dark:text-gray-400',
  onFileClick,
  activePath,
}: RepoTreePanelProps) {
  const [tree, setTree] = useState<GitHubTreeItem[]>([])
  const [path, setPath] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (targetPath: string) => {
    setLoading(true)
    setError(null)
    try {
      const items = await loadTree(targetPath)
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      setTree(items)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load repository')
      setTree([])
    } finally {
      setLoading(false)
    }
  }, [loadTree])

  useEffect(() => {
    setPath('')
    setHistory([])
    if (disabled) {
      setTree([])
      setError(null)
      setLoading(false)
      return
    }
    void load('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, disabled])

  const navigateInto = (item: GitHubTreeItem) => {
    if (item.type !== 'dir') {
      onFileClick?.(item)
      return
    }
    setHistory(h => [...h, path])
    setPath(item.path)
    void load(item.path)
  }

  const navigateBack = () => {
    const prev = history[history.length - 1] ?? ''
    setHistory(h => h.slice(0, -1))
    setPath(prev)
    void load(prev)
  }

  const goRoot = () => {
    setHistory([])
    setPath('')
    void load('')
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-200 dark:border-gray-700 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={accentClassName}>{icon}</span>
          <span className="truncate text-xs font-semibold text-gray-800 dark:text-gray-100">{title}</span>
          <div className="ml-auto flex items-center gap-1">{headerActions}</div>
        </div>
        {headerControls && <div className="mt-2">{headerControls}</div>}
      </div>

      {/* Breadcrumb */}
      {!disabled && (
        <div className="flex shrink-0 items-center gap-1 border-b border-gray-100 dark:border-gray-700/50 px-3 py-1.5 text-[11px] text-gray-500 dark:text-gray-400">
          <button onClick={goRoot} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">root</button>
          {path.split('/').filter(Boolean).map((seg, i, arr) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight size={11} />
              <span className={i === arr.length - 1 ? 'font-medium text-gray-700 dark:text-gray-300' : ''}>{seg}</span>
            </span>
          ))}
          {history.length > 0 && (
            <button onClick={navigateBack} className="ml-auto rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-gray-700 dark:border-gray-600 dark:hover:text-gray-200">
              ← Back
            </button>
          )}
        </div>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {disabled ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <FolderGit2 size={24} className="text-gray-300 dark:text-gray-600" />
            <div className="text-xs text-gray-500 dark:text-gray-400">{disabledMessage}</div>
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-gray-400">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <FolderGit2 size={24} className="text-red-400" />
            <p className="text-xs text-red-500 dark:text-red-400 break-words">{error}</p>
          </div>
        ) : tree.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <FolderGit2 size={24} className="text-gray-300 dark:text-gray-600" />
            <p className="text-xs text-gray-500 dark:text-gray-400">Empty directory</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {tree.map(item => (
              <div
                key={item.path}
                className={`group flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
                  item.type === 'dir'
                    ? 'cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-500/10'
                    : onFileClick
                      ? 'cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-500/10'
                      : 'cursor-default'
                } ${activePath && item.path === activePath ? 'bg-blue-50 dark:bg-blue-500/10' : ''}`}
                onClick={() => navigateInto(item)}
              >
                {item.type === 'dir' ? (
                  <Folder size={14} className="shrink-0 text-amber-400" />
                ) : (
                  <File size={14} className="shrink-0 text-gray-400 dark:text-gray-500" />
                )}
                <span className={`flex-1 truncate text-[11px] font-medium ${
                  item.type === 'dir'
                    ? 'text-gray-800 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400'
                    : 'text-gray-600 dark:text-gray-400'
                }`}>
                  {item.name}
                </span>
                {item.type === 'file' && item.size != null && (
                  <span className="shrink-0 text-[10px] text-gray-400">
                    {item.size < 1024 ? `${item.size} B` : `${(item.size / 1024).toFixed(1)} KB`}
                  </span>
                )}
                {item.type === 'dir' && (
                  <ChevronRight size={11} className="shrink-0 text-gray-400 group-hover:text-blue-500" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
