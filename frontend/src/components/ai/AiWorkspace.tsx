import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bot } from 'lucide-react'
import { apiService } from '@/services/api'
import { GENERAL_TIPS, hintsFor } from '@/features/workspace/hints'
import { learningApi, learningKeys } from '@/features/learning/api'
import { Hint, SplitPane, buttonStyles } from '@/ui'
import type { AiChange, AiMessage, AiSettings } from '@/types/domain'
import AiChatPanel, { type ChatPrompt } from './AiChatPanel'
import BranchPicker from './BranchPicker'
import FileTabsEditor, { reviewKey, type OpenFile } from './FileTabsEditor'
import ProjectExplorer from './ProjectExplorer'

const PANES_KEY = 'atm.workspace.panes'
// Same rule as the backend (ai_project_service._SENSITIVE_NAME): these files are never sent to the AI.
const SENSITIVE_NAME = /(^\.env(\..*)?$|\.(pem|key|p12|pfx|jks|keystore|der|crt|cer)$|^id_(rsa|dsa|ecdsa|ed25519)|^\.npmrc$|^\.netrc$|^credentials(\.json)?$|^settings-security\.xml$)/i

function NoAiHelp({ hints }: { hints: string[] }) {
  return (
    <div className="mb-3 space-y-2 rounded-xl border border-line bg-surface p-3 text-[13px]">
      <p className="flex items-center gap-2 font-semibold text-fg"><Bot size={14} aria-hidden /> No AI assistant connected</p>
      <p className="text-xs text-fg-muted">The workspace works without AI. Connect a provider to get proposed changes you can review.</p>
      <Link to="/settings/mcp/ai" className={buttonStyles('secondary', 'sm')}>Connect a provider</Link>
      <ul className="list-disc space-y-1 pl-4 text-xs text-fg-muted" aria-label="Tips">
        {hints.map(hint => <li key={hint}>{hint}</li>)}
      </ul>
    </div>
  )
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
  showExplorer = true,
  showAssistant = true,
  hintsEnabled = true,
  onFilesChanged,
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
  showExplorer?: boolean
  showAssistant?: boolean
  /** Standard hints above the editor (Workspace › Hints). */
  hintsEnabled?: boolean
  /** Files changed on disk (saved, applied by the assistant, another branch checked out). */
  onFilesChanged?: () => void
}) {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [reference, setReference] = useState<{ path: string; seq: number } | null>(null)
  const [treeKey, setTreeKey] = useState(0)
  const [chatRefresh, setChatRefresh] = useState(0)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const openRef = useRef(openFiles)
  openRef.current = openFiles

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
    onFilesChanged?.()
  }, [loadFile, onProjectChanged, onFilesChanged])

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
        onFilesChanged?.()
      }
    } catch (e) {
      patchFile(file.path, { review: { ...review, busy: false } })
      setReviewError(e instanceof Error && !('isAxiosError' in e) ? e.message : apiService.errorMessage(e))
    }
  }, [projectId, patchFile, closeFile, loadFile, onProjectChanged, onFilesChanged])

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
    onFilesChanged?.()
  }, [loadFile, onProjectChanged, onFilesChanged])

  const active = openFiles.find(f => f.path === activePath)
  const library = useQuery({ queryKey: learningKeys.hints, queryFn: learningApi.hints, staleTime: 10 * 60_000, enabled: hintsEnabled })
  const hints = useMemo(
    () => (hintsEnabled && active && !active.review && !active.binary ? hintsFor(active.path, active.content, library.data) : []),
    [hintsEnabled, active, library.data],
  )
  const aiConnected = settings?.configured !== false

  const explorer = (
    <ProjectExplorer projectId={projectId} reloadKey={treeKey} activePath={activePath} onOpenFile={openFile}
      header={<BranchPicker projectId={projectId} canEdit={canEdit} onSwitched={branchSwitched} confirmSwitch={confirmBranchSwitch} />} />
  )
  const editor = (
    <div className="relative h-[28rem] lg:h-full">
      {reviewError && (
        <div role="alert" className="absolute inset-x-3 bottom-3 z-10 flex items-start justify-between gap-2 rounded-lg border border-danger/30 bg-surface px-3 py-2 text-xs text-danger shadow-float">
          <span className="break-words">{reviewError}</span>
          <button onClick={() => setReviewError(null)} aria-label="Dismiss" className="font-semibold">×</button>
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
        onSaved={() => { setTreeKey(k => k + 1); onFilesChanged?.() }}
        onReference={path => addReference(path.replace(/^review:/, ''))}
        onAcceptReview={(file, content) => void finishReview(file, 'accept', content)}
        onRejectReview={file => void finishReview(file, 'reject')}
        banner={hints.length > 0 && (
          <div className="space-y-1.5 px-3 py-2" role="region" aria-label="Editor hints">
            {hints.map(hint => (
              <Hint key={`${active?.path}:${hint.id}`} id={`${active?.path}:${hint.id}`}>
                {hint.text} <Link to={`/learning/hints#hint-${hint.id}`} className="font-semibold text-accent hover:underline">Learn more</Link>
              </Hint>
            ))}
          </div>
        )}
      />
    </div>
  )
  const assistant = (
    <div className="flex h-[36rem] flex-col lg:h-full">
      {!aiConnected && <NoAiHelp hints={hints.length ? hints.map(h => h.text) : GENERAL_TIPS} />}
      <div className="min-h-0 flex-1">
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

  return (
    <SplitPane
      storageKey={PANES_KEY}
      panes={[
        { id: 'explorer', label: 'Explorer', initial: 260, min: 180, collapsed: !showExplorer, content: explorer },
        { id: 'editor', label: 'Editor', content: editor },
        { id: 'assistant', label: 'Assistant', initial: 460, min: 340, collapsed: !showAssistant, content: assistant },
      ]}
    />
  )
}
