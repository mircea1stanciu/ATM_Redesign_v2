import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { apiService } from '@/services/api'
import type { AiChange, AiMessage, AiSettings } from '@/types/domain'
import AiChatPanel, { type ChatPrompt } from './AiChatPanel'
import BranchPicker from './BranchPicker'
import FileTabsEditor, { reviewKey, type OpenFile } from './FileTabsEditor'
import ProjectExplorer from './ProjectExplorer'

const SIZES_KEY = 'atm.aiWorkspace.sizes'
const MIN_EXPLORER = 180
const MIN_CHAT = 340
// Same rule as the backend (ai_project_service._SENSITIVE_NAME): these files are never sent to the AI.
const SENSITIVE_NAME = /(^\.env(\..*)?$|\.(pem|key|p12|pfx|jks|keystore|der|crt|cer)$|^id_(rsa|dsa|ecdsa|ed25519)|^\.npmrc$|^\.netrc$|^credentials(\.json)?$|^settings-security\.xml$)/i

function savedSizes(): { explorer: number; chat: number } {
  try {
    const data = JSON.parse(localStorage.getItem(SIZES_KEY) || '{}')
    return { explorer: Number(data.explorer) || 260, chat: Number(data.chat) || 460 }
  } catch {
    return { explorer: 260, chat: 460 }
  }
}

/** VS Code-like workspace: project explorer, file editor with tabs and the assistant chat on the side. */
export default function AiWorkspace({
  projectId,
  settings,
  files,
  canEdit,
  prompt,
  onPromptConsumed,
  onTestFile,
  onProjectChanged,
  onSettingsChange,
  workItemId = null,
}: {
  projectId: string
  settings: AiSettings | null
  files: string[]
  canEdit: boolean
  prompt: ChatPrompt | null
  onPromptConsumed: () => void
  onTestFile: (path: string) => void
  onProjectChanged: () => void
  onSettingsChange: (settings: AiSettings) => void
  /** The story being worked on (Work › Start work); the assistant gets it as context. */
  workItemId?: number | null
}) {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [reference, setReference] = useState<{ path: string; seq: number } | null>(null)
  const [treeKey, setTreeKey] = useState(0)
  const [chatRefresh, setChatRefresh] = useState(0)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [sizes, setSizes] = useState(savedSizes)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const openRef = useRef(openFiles)
  openRef.current = openFiles

  useEffect(() => {
    localStorage.setItem(SIZES_KEY, JSON.stringify(sizes))
  }, [sizes])

  const patchFile = useCallback((path: string, patch: Partial<OpenFile>) => {
    setOpenFiles(list => list.map(f => (f.path === path ? { ...f, ...patch } : f)))
  }, [])

  const loadFile = useCallback(async (path: string): Promise<boolean> => {
    try {
      const data = await apiService.getLocalFile(projectId, path)
      const text = data.content ?? ''
      patchFile(path, { content: text, original: text, binary: data.binary, tooLarge: data.too_large, loading: false, error: undefined })
      return !data.binary
    } catch (e) {
      patchFile(path, { loading: false, error: apiService.errorMessage(e) })
      return false
    }
  }, [projectId, patchFile])

  const addReference = useCallback((path: string) => {
    if (SENSITIVE_NAME.test(path.split('/').pop() ?? '')) return
    setReference(r => ({ path, seq: (r?.seq ?? 0) + 1 }))
  }, [])

  // Opening a text file also adds it as a chat reference (binary files are never referenced).
  const openFile = useCallback((path: string) => {
    setActivePath(path)
    const open = openRef.current.find(f => f.path === path)
    if (open) {
      if (!open.binary && !open.error && !open.loading) addReference(path)
      return
    }
    setOpenFiles(list => [...list, { path, content: '', original: '', binary: false, tooLarge: false, loading: true }])
    void loadFile(path).then(text => { if (text) addReference(path) })
  }, [addReference, loadFile])

  const closeFile = useCallback((path: string) => {
    setOpenFiles(list => {
      const index = list.findIndex(f => f.path === path)
      const next = list.filter(f => f.path !== path)
      setActivePath(current => (current === path ? next[Math.min(index, next.length - 1)]?.path ?? null : current))
      return next
    })
  }, [])

  // After the assistant applied or undid files: refresh the tree and the open files without local edits.
  const projectChanged = useCallback(() => {
    setTreeKey(k => k + 1)
    openRef.current.filter(f => !f.review && f.content === f.original).forEach(f => void loadFile(f.path))
    onProjectChanged()
  }, [loadFile, onProjectChanged])

  // Old ↔ new review of a change proposed by the assistant, in its own editor tab.
  const reviewChange = useCallback(async (conversationId: string, message: AiMessage, change: AiChange) => {
    const key = reviewKey(change.path)
    setReviewError(null)
    setActivePath(key)
    setOpenFiles(list => [...list.filter(f => f.path !== key),
      { path: key, content: '', original: '', binary: false, tooLarge: false, loading: true }])
    try {
      const data = await apiService.getAiChangeContent(projectId, conversationId, message.id, change.path)
      patchFile(key, { loading: false, review: { ...data, messageId: message.id, conversationId } })
    } catch (e) {
      patchFile(key, { loading: false, error: apiService.errorMessage(e) })
    }
  }, [projectId, patchFile])

  const finishReview = useCallback(async (file: OpenFile, kind: 'accept' | 'reject', content?: string) => {
    const review = file.review
    if (!review) return
    patchFile(file.path, { review: { ...review, busy: true } })
    setReviewError(null)
    try {
      const payload = { message_id: review.messageId, path: review.path }
      if (kind === 'accept') {
        const fresh = await apiService.getAiChangeContent(projectId, review.conversationId, review.messageId, review.path)
        if (fresh.original !== review.original) throw new Error(`'${review.path}' changed on disk since the review opened. Open the review again.`)
        await apiService.applyAiChange(projectId, review.conversationId, { ...payload, expected_sha: fresh.current_sha, content })
      } else {
        await apiService.rejectAiChange(projectId, review.conversationId, payload)
      }
      closeFile(file.path)
      setChatRefresh(k => k + 1)
      if (kind === 'accept') {
        setTreeKey(k => k + 1)
        openRef.current.filter(f => f.path === review.path && f.content === f.original).forEach(f => void loadFile(f.path))
        onProjectChanged()
      }
    } catch (e) {
      patchFile(file.path, { review: { ...review, busy: false } })
      setReviewError(e instanceof Error && !('isAxiosError' in e) ? e.message : apiService.errorMessage(e))
    }
  }, [projectId, patchFile, closeFile, loadFile, onProjectChanged])

  const confirmBranchSwitch = useCallback((branch: string) => {
    const unsaved = openRef.current.filter(f => !f.binary && f.content !== f.original)
    return !unsaved.length || window.confirm(
      `Switch to '${branch}'? Unsaved edits in ${unsaved.map(f => f.path).join(', ')} are discarded.`)
  }, [])

  // Another branch is checked out: reload the tree and every open file from it.
  const branchSwitched = useCallback(() => {
    setTreeKey(k => k + 1)
    setOpenFiles(list => list.filter(f => !f.review))
    openRef.current.filter(f => !f.review).forEach(f => void loadFile(f.path))
    onProjectChanged()
  }, [loadFile, onProjectChanged])

  const startDrag = (side: 'explorer' | 'chat') => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const box = containerRef.current?.getBoundingClientRect()
    if (!box) return
    const move = (e: PointerEvent) => {
      setSizes(current => {
        const maxExplorer = box.width - current.chat - 240
        const maxChat = box.width - current.explorer - 240
        return side === 'explorer'
          ? { ...current, explorer: Math.round(Math.max(MIN_EXPLORER, Math.min(maxExplorer, e.clientX - box.left))) }
          : { ...current, chat: Math.round(Math.max(MIN_CHAT, Math.min(maxChat, box.right - e.clientX))) }
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const splitter = (side: 'explorer' | 'chat') => (
    <div onPointerDown={startDrag(side)} role="separator" aria-orientation="vertical"
      className="group hidden w-2 shrink-0 cursor-col-resize items-center justify-center lg:flex" title="Drag to resize">
      <div className="h-10 w-0.5 rounded bg-gray-200 group-hover:bg-blue-400 dark:bg-gray-700" />
    </div>
  )

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col gap-3 lg:flex-row lg:gap-0">
      <div className="h-64 shrink-0 lg:h-auto" style={{ flexBasis: sizes.explorer }}>
        <ProjectExplorer projectId={projectId} reloadKey={treeKey} activePath={activePath} onOpenFile={openFile}
          header={<BranchPicker projectId={projectId} canEdit={canEdit} onSwitched={branchSwitched} confirmSwitch={confirmBranchSwitch} />} />
      </div>
      {splitter('explorer')}
      <div className="relative h-[28rem] min-w-0 flex-1 lg:h-auto">
        {reviewError && (
          <div className="absolute inset-x-3 bottom-3 z-10 flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 shadow dark:border-red-900 dark:bg-red-900/40 dark:text-red-200">
            <span className="break-words">{reviewError}</span>
            <button onClick={() => setReviewError(null)} className="font-semibold">×</button>
          </div>
        )}
        <FileTabsEditor
          projectId={projectId}
          files={openFiles}
          activePath={activePath}
          canEdit={canEdit}
          onActivate={setActivePath}
          onClose={closeFile}
          onChange={patchFile}
          onSaved={() => setTreeKey(k => k + 1)}
          onReference={path => addReference(path.replace(/^review:/, ''))}
          onAcceptReview={(file, content) => void finishReview(file, 'accept', content)}
          onRejectReview={file => void finishReview(file, 'reject')}
        />
      </div>
      {splitter('chat')}
      <div className="h-[36rem] shrink-0 lg:h-auto" style={{ flexBasis: sizes.chat }}>
        <AiChatPanel
          projectId={projectId}
          settings={settings}
          files={files}
          canEdit={canEdit}
          prompt={prompt}
          onPromptConsumed={onPromptConsumed}
          onTestFile={onTestFile}
          onProjectChanged={projectChanged}
          onSettingsChange={onSettingsChange}
          reference={reference}
          onReviewChange={(conversationId, message, change) => void reviewChange(conversationId, message, change)}
          refreshKey={chatRefresh}
          workItemId={workItemId}
          compact
        />
      </div>
    </div>
  )
}
