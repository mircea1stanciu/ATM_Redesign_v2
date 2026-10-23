import { useCallback, useEffect, useRef, useState } from 'react'
import { FileCode2, HardDrive, Loader2, RotateCcw, Save } from 'lucide-react'
import { apiService } from '@/services/api'
import type { GitHubTreeItem, LocalFileContent } from '@/types/domain'
import RepoTreePanel from './RepoTreePanel'

interface LocalFileEditorProps {
  projectId: string
}

export default function LocalFileEditor({ projectId }: LocalFileEditorProps) {
  const [file, setFile] = useState<LocalFileContent | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const originalRef = useRef('')

  const dirty = file != null && !file.binary && content !== originalRef.current

  const loadTree = useCallback(
    (path: string): Promise<GitHubTreeItem[]> => apiService.getLocalRepoTree(projectId, path),
    [projectId],
  )

  const openFile = useCallback(async (item: GitHubTreeItem) => {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const f = await apiService.getLocalFile(projectId, item.path)
      setFile(f)
      const text = f.content ?? ''
      setContent(text)
      originalRef.current = text
    } catch (e: unknown) {
      setError(apiService.errorMessage(e))
      setFile(null)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const save = useCallback(async () => {
    if (!file || file.binary) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const f = await apiService.saveLocalFile(projectId, file.path, content)
      setFile(f)
      originalRef.current = content
      setNotice('Saved')
      window.setTimeout(() => setNotice(null), 2000)
    } catch (e: unknown) {
      setError(apiService.errorMessage(e))
    } finally {
      setSaving(false)
    }
  }, [projectId, file, content])

  // Ctrl/Cmd+S to save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirty && !saving) void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, saving, save])

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 md:grid-cols-[minmax(240px,320px)_1fr]">
      {/* File tree */}
      <RepoTreePanel
        title="Local files"
        icon={<HardDrive size={14} />}
        accentClassName="text-emerald-500"
        loadTree={loadTree}
        onFileClick={item => void openFile(item)}
        activePath={file?.path ?? null}
        disabledMessage="No local checkout. Clone it from the 3-Panel tab first."
      />

      {/* Editor */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60">
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 dark:border-gray-700 px-3 py-2">
          <FileCode2 size={14} className="shrink-0 text-gray-400" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-700 dark:text-gray-200">
            {file ? file.path : 'Select a file to edit'}
          </span>
          {dirty && <span className="shrink-0 text-[10px] text-amber-500">● unsaved</span>}
          {notice && <span className="shrink-0 text-[10px] text-emerald-500">{notice}</span>}
          {file && !file.binary && (
            <>
              <button
                onClick={() => { setContent(originalRef.current); setError(null) }}
                disabled={!dirty || saving}
                title="Revert changes"
                className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[10px] text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <RotateCcw size={11} /> Revert
              </button>
              <button
                onClick={() => void save()}
                disabled={!dirty || saving}
                className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              >
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
              </button>
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-gray-400">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
              <FileCode2 size={24} className="text-red-400" />
              <p className="text-xs text-red-500 dark:text-red-400 break-words">{error}</p>
            </div>
          ) : !file ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-gray-400">
              <FileCode2 size={24} className="text-gray-300 dark:text-gray-600" />
              <p className="text-xs">Pick a file from the tree to view and edit it.</p>
            </div>
          ) : file.binary ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-gray-400">
              <FileCode2 size={24} className="text-gray-300 dark:text-gray-600" />
              <p className="text-xs">
                {file.too_large ? 'File is too large to edit here.' : 'Binary file — cannot edit as text.'}
              </p>
            </div>
          ) : (
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              spellCheck={false}
              wrap="off"
              className="h-full w-full resize-none bg-transparent p-3 font-mono text-[12px] leading-[1.55] text-gray-800 outline-none dark:text-gray-200"
            />
          )}
        </div>
      </div>
    </div>
  )
}
