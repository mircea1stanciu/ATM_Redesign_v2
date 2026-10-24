import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { AtSign, FileCode2, GitCompare, Loader2, RotateCcw, Save, X } from 'lucide-react'
import { apiService } from '@/services/api'
import type { ReviewData } from '@/ui/DiffReview'

// CodeMirror is loaded with the first open file, not with the page.
const CodeEditor = lazy(() => import('@/ui/CodeEditor'))
const DiffReview = lazy(() => import('@/ui/DiffReview'))

export interface OpenFile {
  path: string
  content: string
  original: string
  binary: boolean
  tooLarge: boolean
  loading: boolean
  error?: string
  /** Review tab of a change proposed by the assistant (old ↔ new). */
  review?: ReviewData & { messageId: string; conversationId: string; busy?: boolean }
}

/** Tab id of the review of a proposed change (a file can be open for editing and in review at once). */
export const reviewKey = (path: string) => `review:${path}`

/** Editor with one tab per open file (Ctrl/Cmd+S saves the active one). */
export default function FileTabsEditor({
  projectId,
  files,
  activePath,
  canEdit,
  onActivate,
  onClose,
  onChange,
  onSaved,
  onReference,
  onAcceptReview,
  onRejectReview,
  banner,
}: {
  projectId: string
  files: OpenFile[]
  activePath: string | null
  canEdit: boolean
  onActivate: (path: string) => void
  onClose: (path: string) => void
  onChange: (path: string, patch: Partial<OpenFile>) => void
  onSaved: (path: string) => void
  onReference: (path: string) => void
  onAcceptReview: (file: OpenFile, content: string) => void
  onRejectReview: (file: OpenFile) => void
  /** Shown above the editor of a file being edited (the standard hints). */
  banner?: ReactNode
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const file = files.find(f => f.path === activePath) ?? null
  const dirty = (f: OpenFile) => !f.review && !f.binary && f.content !== f.original
  const filePath = (f: OpenFile) => f.review?.path ?? f.path

  const save = useCallback(async () => {
    if (!file || file.review || !dirty(file) || !canEdit) return
    setSaving(true)
    setError(null)
    try {
      await apiService.saveLocalFile(projectId, file.path, file.content)
      onChange(file.path, { original: file.content })
      onSaved(file.path)
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setSaving(false)
    }
  }, [file, canEdit, projectId, onChange, onSaved])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && file) {
        e.preventDefault()
        if (!saving) void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [file, saving, save])

  useEffect(() => setError(null), [activePath])

  const close = (f: OpenFile) => {
    if (dirty(f) && !window.confirm(`Close ${f.path} without saving?`)) return
    onClose(f.path)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
      <div className="flex shrink-0 items-stretch overflow-x-auto border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
        {files.length === 0 && <span className="px-3 py-2 text-xs text-gray-400">No open files</span>}
        {files.map(f => (
          <div key={f.path}
            className={`group flex shrink-0 items-center gap-1.5 border-r border-gray-200 px-3 py-1.5 text-[12px] dark:border-gray-700 ${f.path === activePath
              ? 'bg-white text-gray-900 dark:bg-gray-800 dark:text-white'
              : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800/60'}`}>
            <button onClick={() => onActivate(f.path)} className="flex items-center gap-1.5" title={f.review ? `Review: ${f.review.path}` : f.path}>
              {f.review
                ? <><GitCompare size={12} className="text-amber-500" /><span className="italic">{filePath(f).split('/').pop()} (review)</span></>
                : <><FileCode2 size={12} className="text-gray-400" />{f.path.split('/').pop()}</>}
            </button>
            <button onClick={() => close(f)} className="rounded p-px text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-600" title="Close">
              {dirty(f) ? <span className="block h-2 w-2 rounded-full bg-gray-500 group-hover:hidden dark:bg-gray-300" /> : null}
              <X size={12} className={dirty(f) ? 'hidden group-hover:block' : ''} />
            </button>
          </div>
        ))}
      </div>

      {file && !file.review && (
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-3 py-1 dark:border-gray-700/60">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">{file.path}</span>
          {error && <span className="truncate text-[11px] text-red-500" title={error}>{error}</span>}
          <button onClick={() => onReference(file.path)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-700"
            title="Add this file as a reference in the chat">
            <AtSign size={11} /> Reference
          </button>
          {!file.binary && canEdit && (
            <>
              <button onClick={() => onChange(file.path, { content: file.original })} disabled={!dirty(file) || saving}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-700">
                <RotateCcw size={11} /> Revert
              </button>
              <button onClick={() => void save()} disabled={!dirty(file) || saving}
                className="flex items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40">
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
              </button>
            </>
          )}
        </div>
      )}
      {file && !file.review && banner && <div className="shrink-0 border-b border-line">{banner}</div>}

      <div className="min-h-0 flex-1 overflow-hidden">
        {!file ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-gray-400">
            <FileCode2 size={26} className="text-gray-300 dark:text-gray-600" />
            <p className="max-w-xs text-xs">Click a file in the explorer to open it here. It is also added as a reference to your next chat message.</p>
          </div>
        ) : file.loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-gray-400"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : file.error ? (
          <p className="p-4 text-xs text-red-500">{file.error}</p>
        ) : file.binary ? (
          <p className="p-4 text-xs text-gray-400">{file.tooLarge ? 'The file is too large to edit here.' : 'Binary file — it cannot be edited as text.'}</p>
        ) : (
          <Suspense fallback={<div className="flex h-full items-center justify-center gap-2 text-xs text-gray-400"><Loader2 size={14} className="animate-spin" /> Loading editor…</div>}>
            {file.review ? (
              <DiffReview key={file.path} data={file.review} busy={Boolean(file.review.busy)} canEdit={canEdit}
                onAccept={content => onAcceptReview(file, content)} onReject={() => onRejectReview(file)} />
            ) : (
              <CodeEditor key={file.path} path={file.path} value={file.content} readOnly={!canEdit}
                onChange={value => onChange(file.path, { content: value })} />
            )}
          </Suspense>
        )}
      </div>
    </div>
  )
}
