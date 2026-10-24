import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Columns2, Loader2, Rows2, X } from 'lucide-react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers, highlightActiveLineGutter, drawSelection } from '@codemirror/view'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { MergeView, getChunks, goToNextChunk, goToPreviousChunk, unifiedMergeView } from '@codemirror/merge'
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode'
import { editorFont, useDarkMode, useLanguage } from './CodeEditor'

export interface ReviewData {
  path: string
  exists: boolean
  original: string
  proposed: string
}

type Layout = 'split' | 'inline'

const reviewTheme = EditorView.theme({
  '&': { height: '100%' },
  '.cm-mergeView': { height: '100%' },
  '.cm-merge-revert button, .cm-chunkButtons button': { cursor: 'pointer' },
  '.cm-chunkButtons button[name=accept]': { background: '#2ea043', color: '#fff', border: 'none', borderRadius: '3px', padding: '0 6px', marginRight: '4px' },
  '.cm-chunkButtons button[name=reject]': { background: '#da3633', color: '#fff', border: 'none', borderRadius: '3px', padding: '0 6px' },
})

/**
 * VS Code-like review of a change proposed by the assistant: the current file (left / red) and the
 * proposal (right / green). Each change can be rejected on its own (arrow in the middle, or Reject in the
 * inline view); "Accept" writes what is left on the right, "Reject" discards the whole proposal.
 */
export default function DiffReview({
  data,
  busy,
  canEdit,
  onAccept,
  onReject,
}: {
  data: ReviewData
  busy: boolean
  canEdit: boolean
  onAccept: (content: string) => void
  onReject: () => void
}) {
  const dark = useDarkMode()
  const language = useLanguage(data.path)
  const [layout, setLayout] = useState<Layout>(() => (localStorage.getItem('atm.diffLayout') as Layout) || 'split')
  const [chunks, setChunks] = useState(0)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<{ result: () => string; focus: EditorView; destroy: () => void } | null>(null)
  // The proposal as currently reviewed (kept when switching layout or theme).
  const draftRef = useRef(data.proposed)

  useEffect(() => { draftRef.current = data.proposed }, [data.proposed])
  useEffect(() => { localStorage.setItem('atm.diffLayout', layout) }, [layout])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const common: Extension[] = [
      lineNumbers(), highlightActiveLineGutter(), drawSelection(), dark ? vscodeDark : vscodeLight,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }), ...language, editorFont, reviewTheme,
      EditorView.editable.of(canEdit),
    ]
    const track = EditorView.updateListener.of(update => {
      draftRef.current = update.state.doc.toString()
      setChunks(getChunks(update.state)?.chunks.length ?? 0)
    })
    if (layout === 'split') {
      const view = new MergeView({
        parent: host,
        a: { doc: data.original, extensions: [...common, EditorState.readOnly.of(true), EditorView.editable.of(false)] },
        b: { doc: draftRef.current, extensions: [...common, track] },
        revertControls: canEdit ? 'a-to-b' : undefined,
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: { margin: 4, minSize: 8 },
      })
      viewRef.current = { result: () => view.b.state.doc.toString(), focus: view.b, destroy: () => view.destroy() }
      setChunks(getChunks(view.b.state)?.chunks.length ?? 0)
    } else {
      const view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: draftRef.current,
          extensions: [...common, track, unifiedMergeView({
            original: data.original, mergeControls: canEdit, highlightChanges: true, gutter: true,
            collapseUnchanged: { margin: 4, minSize: 8 },
          })],
        }),
      })
      viewRef.current = { result: () => view.state.doc.toString(), focus: view, destroy: () => view.destroy() }
      setChunks(getChunks(view.state)?.chunks.length ?? 0)
    }
    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
      host.innerHTML = ''
    }
  }, [layout, dark, language, data.original, canEdit])

  const jump = (next: boolean) => {
    const view = viewRef.current?.focus
    if (!view) return
    ;(next ? goToNextChunk : goToPreviousChunk)(view)
    view.focus()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 px-3 py-1 text-[11px] dark:border-gray-700/60">
        <span className="font-mono text-gray-500 dark:text-gray-400">
          {data.exists ? <><span className="text-rose-500">{data.path}</span> ↔ <span className="text-emerald-500">proposed</span></> : <>New file <span className="text-emerald-500">{data.path}</span></>}
        </span>
        <span className="text-gray-400">{chunks} {chunks === 1 ? 'change' : 'changes'}</span>
        <button onClick={() => jump(false)} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700" title="Previous change"><ChevronUp size={13} /></button>
        <button onClick={() => jump(true)} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700" title="Next change"><ChevronDown size={13} /></button>
        <div className="flex overflow-hidden rounded border border-gray-200 dark:border-gray-600">
          <button onClick={() => setLayout('split')} className={`flex items-center gap-1 px-1.5 py-0.5 ${layout === 'split' ? 'bg-gray-200 dark:bg-gray-600' : ''}`} title="Side by side">
            <Columns2 size={11} /> Side by side
          </button>
          <button onClick={() => setLayout('inline')} className={`flex items-center gap-1 px-1.5 py-0.5 ${layout === 'inline' ? 'bg-gray-200 dark:bg-gray-600' : ''}`} title="Inline">
            <Rows2 size={11} /> Inline
          </button>
        </div>
        <span className="hidden text-gray-400 xl:inline">
          {canEdit ? (layout === 'split' ? 'Use the arrows to reject single changes; you can also edit the right side.' : 'Accept or reject each change, then Accept.') : 'Viewers cannot apply changes.'}
        </span>
        {canEdit && (
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={onReject} disabled={busy} className="flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">
              <X size={11} /> Reject
            </button>
            <button onClick={() => viewRef.current && onAccept(viewRef.current.result())} disabled={busy}
              className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Accept
            </button>
          </div>
        )}
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 overflow-auto [&_.cm-mergeView]:h-full [&_.cm-editor]:h-full" />
    </div>
  )
}
