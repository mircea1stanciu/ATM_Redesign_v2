import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import {
  AlertTriangle, Bot, CheckCircle2, ChevronDown, ChevronRight, FilePlus2, FileText, FlaskConical, GitCompare, Loader2, MessageSquarePlus,
  Paperclip, PlayCircle, Plug, Save, Send, Settings2, Square, Trash2, Undo2, User, X, XCircle,
} from 'lucide-react'
import { apiService } from '@/services/api'
import { Markdown } from '@/components/community/Markdown'
import type { AiChange, AiConversation, AiConversationSummary, AiMessage, AiSettings } from '@/types/domain'
import type { PromptRequest } from './AiAnalysisPanel'
import OpenInIdeMenu from './OpenInIdeMenu'

export interface ChatPrompt extends PromptRequest {
  runLabel?: string
}

const FILE_FENCE = /^(`{3,}|~{3,})\s*file:\s*(\S+?)\s*$/

/** Replace ```file:<path> blocks with a short note; the change cards below show the files. */
function displayText(text: string, streaming: boolean): string {
  const out: string[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const match = FILE_FENCE.exec(lines[i].trim())
    if (!match) {
      out.push(lines[i])
      continue
    }
    const fence = match[1]
    let closed = false
    let count = 0
    for (i += 1; i < lines.length; i += 1) {
      const line = lines[i].trim()
      if (line.startsWith(fence[0].repeat(fence.length)) && line.replace(new RegExp(`\\${fence[0]}`, 'g'), '') === '') {
        closed = true
        break
      }
      count += 1
    }
    out.push(closed || !streaming
      ? `> 📄 Proposed file **\`${match[2]}\`** (${count} lines) — review it below.`
      : `> ✍️ Writing **\`${match[2]}\`**… (${count} lines so far)`)
  }
  return out.join('\n')
}

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-lg bg-gray-950 p-2 font-mono text-[11px] leading-relaxed">
      {diff.split('\n').map((line, i) => {
        const color = line.startsWith('+++') || line.startsWith('---') ? 'text-gray-400'
          : line.startsWith('+') ? 'text-emerald-400' : line.startsWith('-') ? 'text-rose-400'
            : line.startsWith('@@') ? 'text-sky-400' : 'text-gray-300'
        return <div key={i} className={color}>{line || ' '}</div>
      })}
    </pre>
  )
}

function ChangeCard({
  projectId, change, busy, canEdit, onApply, onUndo, onTest, onReview, onReject,
}: {
  projectId: string
  change: AiChange
  busy: boolean
  canEdit: boolean
  onApply: () => void
  onUndo: () => void
  onTest: () => void
  onReview?: () => void
  onReject: () => void
}) {
  const [open, setOpen] = useState(false)
  const badge = change.state === 'invalid' ? ['invalid', 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300']
    : change.state === 'applied' ? ['applied', 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300']
      : change.state === 'rejected' ? ['rejected', 'bg-gray-100 text-gray-500 line-through dark:bg-gray-700 dark:text-gray-400']
      : change.state === 'undone' ? ['undone', 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300']
        : change.status === 'create' ? ['new file', 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300']
          : change.status === 'unchanged' ? ['no changes', 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300']
            : ['modified', 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300']
  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen(o => !o)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" disabled={!change.diff}>
          {change.diff ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <FileText size={13} />}
          <span className="truncate font-mono text-xs font-medium text-gray-800 dark:text-gray-100" title={change.path}>{change.path}</span>
          <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase ${badge[1]}`}>{badge[0]}</span>
          {(change.added || change.removed) ? (
            <span className="shrink-0 text-[11px]"><span className="text-emerald-600">+{change.added}</span> <span className="text-rose-600">−{change.removed}</span></span>
          ) : null}
        </button>
        {canEdit && change.state !== 'invalid' && (
          <div className="flex items-center gap-1.5">
            {change.state === 'applied' ? (
              <>
                <OpenInIdeMenu projectId={projectId} targets={[{ label: change.path, path: change.path }]} compact />
                <button onClick={onTest} className="btn-secondary !px-2 !py-1 text-[11px]" title="Open the Test tab with this file selected">
                  <FlaskConical size={12} /> Test it
                </button>
                <button onClick={onUndo} disabled={busy} className="btn-ghost !px-2 !py-1 text-[11px]">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />} Undo
                </button>
              </>
            ) : change.state !== 'rejected' && change.status !== 'unchanged' && (
              <>
                {onReview && (
                  <button onClick={onReview} className="btn-secondary !px-2 !py-1 text-[11px]" title="Compare the current file with the proposal and accept or reject each change">
                    <GitCompare size={12} /> Review
                  </button>
                )}
                {change.state === 'proposed' && (
                  <button onClick={onReject} disabled={busy} className="btn-ghost !px-2 !py-1 text-[11px]" title="Discard this proposal">
                    <X size={12} /> Reject
                  </button>
                )}
                <button onClick={onApply} disabled={busy} className="btn-primary !px-2.5 !py-1 text-[11px]" title="Apply the whole proposal">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Accept
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {change.error && <p className="border-t border-gray-100 px-3 py-1.5 text-[11px] text-red-600 dark:border-gray-700">{change.error}</p>}
      {open && change.diff && (
        <div className="border-t border-gray-100 p-2 dark:border-gray-700">
          <DiffView diff={change.diff} />
          {change.diff_truncated && <p className="mt-1 text-[10px] text-gray-400">Diff truncated.</p>}
        </div>
      )}
    </div>
  )
}

function MessageView({
  projectId, message, streaming, canEdit, busyKey, onApply, onUndo, onTest, onReview, onReject,
}: {
  projectId: string
  message: AiMessage
  streaming?: boolean
  canEdit: boolean
  busyKey: string | null
  onApply: (message: AiMessage, change: AiChange) => void
  onUndo: (message: AiMessage, change: AiChange) => void
  onTest: (path: string) => void
  onReview?: (message: AiMessage, change: AiChange) => void
  onReject?: (message: AiMessage, change: AiChange) => void
}) {
  const user = message.role === 'user'
  const files = message.attachments?.files ?? []
  const run = message.attachments?.run
  return (
    <div className={`flex gap-3 ${user ? 'flex-row-reverse' : ''}`}>
      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${user ? 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200' : 'bg-blue-600 text-white'}`}>
        {user ? <User size={14} /> : <Bot size={14} />}
      </div>
      <div className={`min-w-0 max-w-[85%] space-y-2 ${user ? 'items-end text-right' : ''}`}>
        <div className={`inline-block rounded-2xl px-4 py-2.5 text-left text-sm ${user
          ? 'bg-blue-600 text-white'
          : 'border border-gray-200 bg-white text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'}`}>
          {user ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : message.content ? (
            <Markdown content={displayText(message.content, Boolean(streaming))} className="text-sm" />
          ) : (
            <span className="inline-flex items-center gap-2 text-gray-500"><Loader2 size={14} className="animate-spin" /> Thinking…</span>
          )}
          {streaming && message.content && <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-gray-400 align-middle" />}
        </div>
        {(files.length > 0 || run) && (
          <div className={`flex flex-wrap gap-1 ${user ? 'justify-end' : ''}`}>
            {files.map(file => (
              <span key={file} className="inline-flex max-w-[260px] items-center gap-1 truncate rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-300" title={file}>
                <Paperclip size={10} />{file.split('/').pop()}
              </span>
            ))}
            {run && (
              <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">
                <PlayCircle size={10} />{run.name || run.id} · {run.status} ({run.passed}✓ {run.failed}✗)
              </span>
            )}
          </div>
        )}
        {message.error && (
          <div className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
            <AlertTriangle size={13} className="mt-px shrink-0" /><span className="break-words">{message.error}</span>
          </div>
        )}
        {message.stopped && <p className="text-[11px] text-gray-400">Stopped before the answer was complete.</p>}
        {(message.changes?.length ?? 0) > 0 && (
          <div className="space-y-1.5 text-left">
            {message.changes!.map(change => (
              <ChangeCard
                key={change.path}
                projectId={projectId}
                change={change}
                busy={busyKey === `${message.id}:${change.path}`}
                canEdit={canEdit}
                onApply={() => onApply(message, change)}
                onUndo={() => onUndo(message, change)}
                onTest={() => onTest(change.path)}
                onReview={onReview ? () => onReview(message, change) : undefined}
                onReject={() => onReject?.(message, change)}
              />
            ))}
          </div>
        )}
        {!user && !streaming && message.model && (
          <p className="text-[10px] text-gray-400">{message.model}{message.context_files?.length ? ` · ${message.context_files.length} project files as context` : ''}</p>
        )}
      </div>
    </div>
  )
}

export default function AiChatPanel({
  projectId,
  settings,
  files,
  canEdit,
  prompt,
  onPromptConsumed,
  onTestFile,
  onProjectChanged,
  onSettingsChange,
  reference,
  compact = false,
  onReviewChange,
  refreshKey = 0,
}: {
  projectId: string
  settings: AiSettings | null
  /** Called when the model is switched from the chat (the saved connection changed). */
  onSettingsChange?: (settings: AiSettings) => void
  /** A file to add as a reference to the next message (e.g. clicked in the explorer). */
  reference?: { path: string; seq: number } | null
  /** Side-panel layout: the conversation list becomes a drop-down. */
  compact?: boolean
  /** Open the old ↔ new review of a proposed change (in the workspace editor). */
  onReviewChange?: (conversationId: string, message: AiMessage, change: AiChange) => void
  /** Reload the conversation when this changes (a change was accepted/rejected from the review). */
  refreshKey?: number
  files: string[]
  canEdit: boolean
  prompt: ChatPrompt | null
  onPromptConsumed: () => void
  onTestFile: (path: string) => void
  onProjectChanged: () => void
}) {
  const [conversations, setConversations] = useState<AiConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [conversation, setConversation] = useState<AiConversation | null>(null)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [run, setRun] = useState<{ id: string; label: string } | null>(null)
  const [streamingText, setStreamingText] = useState<string | null>(null)
  const [pendingUser, setPendingUser] = useState<AiMessage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [model, setModel] = useState('')
  const [modelsBusy, setModelsBusy] = useState(false)
  const [modelStatus, setModelStatus] = useState<'idle' | 'testing' | 'saving' | 'connected' | 'failed'>('idle')
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const streaming = streamingText !== null

  const loadList = useCallback(async () => {
    const list = await apiService.listAiConversations(projectId)
    setConversations(list)
    return list
  }, [projectId])

  useEffect(() => {
    setConversation(null)
    setActiveId(null)
    loadList().then(list => setActiveId(list[0]?.id ?? null)).catch(e => setError(apiService.errorMessage(e)))
  }, [loadList])

  const loadedId = conversation?.id
  useEffect(() => {
    if (!activeId) {
      setConversation(null)
      return
    }
    if (loadedId === activeId) return
    apiService.getAiConversation(projectId, activeId).then(setConversation).catch(e => setError(apiService.errorMessage(e)))
  }, [projectId, activeId, loadedId])

  // Requests coming from the Analysis / Test tabs.
  useEffect(() => {
    if (!prompt) return
    setDraft(prompt.content)
    setAttachments(prompt.attachments ?? [])
    setRun(prompt.runId ? { id: prompt.runId, label: prompt.runLabel ?? prompt.runId } : null)
    onPromptConsumed()
    window.setTimeout(() => inputRef.current?.focus(), 50)
  }, [prompt, onPromptConsumed])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [conversation?.messages.length, streamingText, pendingUser])

  // The saved connection (from Settings › AI Assistant): test it, list its models, choose and save one here.
  const savedModel = settings?.model ?? ''
  const multiModel = Boolean(settings?.configured) && settings?.provider !== 'microsoft_copilot'
  const connectionPayload = useCallback((nextModel: string) => ({
    provider: settings?.provider ?? '',
    model: nextModel,
    ...(settings?.provider === 'azure_openai' && settings.endpoint ? { endpoint: settings.endpoint } : {}),
  }), [settings?.provider, settings?.endpoint])

  const saveModel = useCallback(async (next: string) => {
    setModel(next)
    setModelStatus('saving')
    setConnectionMessage(null)
    try {
      let saved: AiSettings
      try {
        saved = await apiService.switchAiModel(next)
      } catch (e) {
        // Backends without the model switch endpoint: save through the settings endpoint (keeps the sign-in/key).
        if (!axios.isAxiosError(e) || e.response?.status !== 404) throw e
        saved = await apiService.saveAiSettings(connectionPayload(next))
      }
      onSettingsChange?.(saved)
      setModelStatus('connected')
      setConnectionMessage(`Saved: the assistant now uses ${next}.`)
    } catch (e) {
      setModel(savedModel)
      setModelStatus('failed')
      setConnectionMessage(apiService.errorMessage(e))
    }
  }, [connectionPayload, onSettingsChange, savedModel])

  /** Test the saved connection and list its models (also used when the tab opens). */
  const testConnection = useCallback(async (silent = false) => {
    setModelsBusy(true)
    setModelStatus('testing')
    if (!silent) setConnectionMessage(null)
    try {
      const response = await apiService.testAiSettings(connectionPayload(savedModel))
      if (response.models.length) setModels(response.models)
      setModelStatus(response.ok ? 'connected' : 'failed')
      if (!silent || !response.ok) setConnectionMessage(response.ok ? `${response.message} ${response.models.length} models available.` : response.message)
      return response.ok ? response.models : []
    } catch (e) {
      setModelStatus('failed')
      setConnectionMessage(apiService.errorMessage(e))
      return []
    } finally {
      setModelsBusy(false)
    }
  }, [connectionPayload, savedModel])

  useEffect(() => {
    setModel(savedModel)
    setConnectionMessage(null)
    if (!multiModel) {
      setModels([])
      setModelStatus('idle')
      return
    }
    void testConnection(true).then(found => {
      // The saved model is no longer available: connect to an available one automatically.
      if (found.length && savedModel && !found.some(m => m.id === savedModel)) void saveModel(found[0].id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiModel, settings?.provider])

  useEffect(() => setModel(savedModel), [savedModel])

  useEffect(() => {
    if (!reference) return
    setAttachments(list => list.includes(reference.path) ? list : [...list, reference.path].slice(-12))
  }, [reference])

  const pickerResults = useMemo(() => {
    const needle = pickerQuery.trim().toLowerCase()
    return files.filter(f => !attachments.includes(f) && (!needle || f.toLowerCase().includes(needle))).slice(0, 60)
  }, [files, attachments, pickerQuery])

  const newConversation = async () => {
    if (streaming) return
    setActiveId(null)
    setConversation(null)
    setError(null)
    inputRef.current?.focus()
  }

  const deleteConversation = async (id: string) => {
    if (!window.confirm('Delete this conversation? Files that were applied stay in the project.')) return
    await apiService.deleteAiConversation(projectId, id)
    const list = await loadList()
    if (id === activeId) setActiveId(list[0]?.id ?? null)
  }

  const send = async () => {
    const content = draft.trim()
    if ((!content && !run) || streaming || !settings?.configured) return
    setError(null)
    let conversationId = activeId
    try {
      if (!conversationId) {
        const created = await apiService.createAiConversation(projectId)
        conversationId = created.id
        setConversation(created)
        setActiveId(created.id)
      }
    } catch (e) {
      setError(apiService.errorMessage(e))
      return
    }
    const payload = { content, attachments, run_id: run?.id ?? null }
    setPendingUser({
      id: 'pending', role: 'user', content: content || 'Analyse this run and fix the failure.', created_at: new Date().toISOString(),
      attachments: { files: attachments, run: run ? { id: run.id, name: run.label, status: 'failed', passed: 0, failed: 0, skipped: 0 } : null },
    })
    setDraft('')
    setAttachments([])
    setRun(null)
    setStreamingText('')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await apiService.streamAiMessage(projectId, conversationId, payload, event => {
        if (event.type === 'delta') setStreamingText(text => (text ?? '') + event.text)
        if (event.type === 'done') {
          setConversation(event.conversation)
          if (event.conversation.messages.some(m => m.changes?.length)) onProjectChanged()
        }
      }, controller.signal)
    } catch (e) {
      if (controller.signal.aborted) {
        // The server stores the partial answer when the stream is closed.
        await new Promise(resolve => window.setTimeout(resolve, 800))
        setConversation(await apiService.getAiConversation(projectId, conversationId))
      } else {
        setError(e instanceof Error ? e.message : apiService.errorMessage(e))
        setDraft(content)
        setAttachments(payload.attachments)
      }
    } finally {
      abortRef.current = null
      setStreamingText(null)
      setPendingUser(null)
      void loadList()
    }
  }

  const stop = () => abortRef.current?.abort()

  useEffect(() => {
    if (refreshKey && activeId) apiService.getAiConversation(projectId, activeId).then(setConversation).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const changeAction = async (kind: 'apply' | 'undo' | 'reject', message: AiMessage, change: AiChange) => {
    if (!conversation) return
    setBusyKey(`${message.id}:${change.path}`)
    setError(null)
    try {
      const payload = { message_id: message.id, path: change.path }
      const updated = kind === 'apply'
        ? await apiService.applyAiChange(projectId, conversation.id, { ...payload, expected_sha: change.current_sha ?? null })
        : kind === 'undo'
          ? await apiService.undoAiChange(projectId, conversation.id, payload)
          : await apiService.rejectAiChange(projectId, conversation.id, payload)
      setConversation(updated)
      if (kind !== 'reject') onProjectChanged()
    } catch (e) {
      setError(apiService.errorMessage(e))
      setConversation(await apiService.getAiConversation(projectId, conversation.id))
    } finally {
      setBusyKey(null)
    }
  }

  const messages = conversation?.messages ?? []
  const providerName = settings?.providers.find(p => p.id === settings.provider)?.name.split(' (')[0]

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* Conversations */}
      <aside className={`${compact ? 'hidden' : 'hidden lg:flex'} w-60 shrink-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90`}>
        <div className="border-b border-gray-200 p-2 dark:border-gray-700">
          <button onClick={() => void newConversation()} disabled={streaming} className="btn-primary w-full justify-center !py-1.5 text-xs">
            <MessageSquarePlus size={13} /> New conversation
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {conversations.length === 0 && <p className="px-3 py-4 text-xs text-gray-400">No conversations yet.</p>}
          {conversations.map(c => (
            <div key={c.id} className={`group flex items-start gap-1 px-2 py-1.5 ${c.id === activeId ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'}`}>
              <button onClick={() => !streaming && setActiveId(c.id)} className="min-w-0 flex-1 text-left">
                <p className={`truncate text-xs font-medium ${c.id === activeId ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200'}`}>{c.title}</p>
                <p className="text-[10px] text-gray-400">{new Date(c.updated_at).toLocaleString()} · {c.messages} messages</p>
              </button>
              <button onClick={() => void deleteConversation(c.id)} className="invisible rounded p-0.5 text-gray-400 hover:text-red-500 group-hover:visible" title="Delete">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Chat */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-gray-50/60 shadow-soft dark:border-gray-700/70 dark:bg-gray-900/40">
        <div className={`flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-800/90 ${compact ? 'flex-wrap' : ''}`}>
          {compact ? (
            <div className="flex min-w-0 items-center gap-1">
              <select value={activeId ?? ''} onChange={e => !streaming && setActiveId(e.target.value || null)} disabled={streaming}
                className="form-input min-w-0 !py-0.5 !pl-2 !pr-7 !text-[12px] font-semibold" title="Conversations">
                <option value="">New conversation</option>
                {conversations.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
              <button onClick={() => void newConversation()} disabled={streaming} className="rounded p-1 text-gray-400 hover:text-blue-600" title="New conversation">
                <MessageSquarePlus size={14} />
              </button>
              {activeId && (
                <button onClick={() => void deleteConversation(activeId)} disabled={streaming} className="rounded p-1 text-gray-400 hover:text-red-500" title="Delete conversation">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ) : (
            <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{conversation?.title ?? 'New conversation'}</p>
          )}
          {settings?.configured ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <Link to="/settings/mcp/ai" className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300">
                <Bot size={11} /> {providerName}{multiModel && models.length ? '' : settings.provider === 'microsoft_copilot' ? '' : ` · ${settings.model || 'default model'}`}
              </Link>
              {multiModel && (
                models.length > 0 ? (
                  <select value={model} onChange={e => setModel(e.target.value)} disabled={streaming || modelStatus === 'saving'}
                    className="form-input !w-auto max-w-[14rem] !py-0.5 !pl-2 !pr-7 font-mono !text-[11px]"
                    title={`${models.length} models available to your connection`}>
                    {!models.some(m => m.id === model) && <option value={model}>{model || 'Choose a model'}</option>}
                    {models.map(m => <option key={m.id} value={m.id}>{m.id}{m.id === savedModel ? ' (saved)' : ''}</option>)}
                  </select>
                ) : (
                  <input value={model} onChange={e => setModel(e.target.value)} disabled={streaming || modelStatus === 'saving'}
                    className="form-input !w-36 !py-0.5 !px-2 font-mono !text-[11px]" placeholder="model name"
                    title="Test the connection to list the models you can use" />
                )
              )}
              {multiModel && (
                <button onClick={() => void testConnection()} disabled={modelsBusy || streaming || modelStatus === 'saving'}
                  className="btn-secondary !px-2 !py-0.5 text-[11px]" title="Test the connection and list the models it allows">
                  {modelStatus === 'testing' ? <Loader2 size={11} className="animate-spin" /> : <Plug size={11} />} Test
                </button>
              )}
              {multiModel && (
                <button onClick={() => void saveModel(model.trim())}
                  disabled={!model.trim() || model.trim() === savedModel || streaming || modelStatus === 'saving' || modelStatus === 'testing'}
                  className="btn-primary !px-2 !py-0.5 text-[11px]" title="Use this model for the assistant (saved to your connection)">
                  {modelStatus === 'saving' ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
                </button>
              )}
              {multiModel && (modelStatus === 'connected' || modelStatus === 'failed') && (
                modelStatus === 'connected'
                  ? <span title={connectionMessage ?? 'Connected'}><CheckCircle2 size={13} className="text-emerald-500" /></span>
                  : <span title={connectionMessage ?? 'Connection failed'}><XCircle size={13} className="text-red-500" /></span>
              )}
            </div>
          ) : null}
        </div>

        {connectionMessage && (
          <div className={`flex items-start justify-between gap-2 border-b px-4 py-1.5 text-[11px] ${modelStatus === 'failed'
            ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200'}`}>
            <span className="break-words">{connectionMessage}</span>
            <button onClick={() => setConnectionMessage(null)} className="shrink-0"><X size={11} /></button>
          </div>
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {!settings?.configured && (
            <div className="mx-auto max-w-xl rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm dark:border-blue-500/30 dark:bg-blue-500/10">
              <p className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white"><Settings2 size={15} /> Connect an AI provider first</p>
              <p className="mt-1 text-gray-600 dark:text-gray-300">Connect GitHub Copilot, Claude or Microsoft 365 Copilot in Settings (a setup guide is included).</p>
              <Link to="/settings/mcp/ai" className="btn-primary mt-3 inline-flex px-3 py-1.5 text-xs">Open Settings › AI Assistant</Link>
            </div>
          )}
          {settings?.configured && messages.length === 0 && !pendingUser && (
            <div className="mx-auto max-w-xl pt-6 text-center text-sm text-gray-500 dark:text-gray-400">
              <Bot size={28} className="mx-auto mb-2 text-blue-500" />
              Describe the test or feature to implement. The assistant knows the project analysis, its configuration and an
              example test; attach more files with <Paperclip size={12} className="inline" />. Proposed files appear as cards you
              review and apply, then run them in the <b>Test</b> tab.
            </div>
          )}
          {messages.map(message => (
            <MessageView key={message.id} projectId={projectId} message={message} canEdit={canEdit} busyKey={busyKey}
              onApply={(m, c) => void changeAction('apply', m, c)} onUndo={(m, c) => void changeAction('undo', m, c)} onTest={onTestFile}
              onReject={(m, c) => void changeAction('reject', m, c)}
              onReview={onReviewChange && conversation ? (m, c) => onReviewChange(conversation.id, m, c) : undefined} />
          ))}
          {pendingUser && <MessageView projectId={projectId} message={pendingUser} canEdit={false} busyKey={null} onApply={() => undefined} onUndo={() => undefined} onTest={() => undefined} />}
          {streaming && (
            <MessageView projectId={projectId} message={{ id: 'streaming', role: 'assistant', content: streamingText ?? '', created_at: '' }} streaming canEdit={false}
              busyKey={null} onApply={() => undefined} onUndo={() => undefined} onTest={() => undefined} />
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/90">
          {error && (
            <div className="mb-2 flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
              <span className="break-words">{error}</span>
              <button onClick={() => setError(null)}><X size={12} /></button>
            </div>
          )}
          {(attachments.length > 0 || run) && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map(file => (
                <span key={file} className="inline-flex max-w-[280px] items-center gap-1 rounded-lg bg-gray-100 px-2 py-0.5 font-mono text-[11px] text-gray-700 dark:bg-gray-700 dark:text-gray-200" title={file}>
                  <Paperclip size={11} /><span className="truncate">{file}</span>
                  <button onClick={() => setAttachments(list => list.filter(f => f !== file))}><X size={11} /></button>
                </span>
              ))}
              {run && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">
                  <PlayCircle size={11} /> {run.label} (results and log end attached)
                  <button onClick={() => setRun(null)}><X size={11} /></button>
                </span>
              )}
            </div>
          )}
          <div className="relative flex items-end gap-2">
            <div className="relative">
              <button onClick={() => setPickerOpen(o => !o)} disabled={!settings?.configured} className="btn-secondary !px-2 !py-2" title="Attach project files">
                <FilePlus2 size={15} />
              </button>
              {pickerOpen && (
                <div className="absolute bottom-11 left-0 z-20 w-[28rem] max-w-[80vw] rounded-xl border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-700 dark:bg-gray-800">
                  <input autoFocus value={pickerQuery} onChange={e => setPickerQuery(e.target.value)} placeholder="Search project files…"
                    className="form-input mb-2 !py-1.5 !text-xs" />
                  <div className="max-h-64 overflow-y-auto">
                    {pickerResults.length === 0 && <p className="px-2 py-2 text-xs text-gray-400">No matching files.</p>}
                    {pickerResults.map(file => (
                      <button key={file} onClick={() => { setAttachments(list => [...list, file].slice(0, 12)); setPickerOpen(false); setPickerQuery('') }}
                        className="block w-full truncate rounded px-2 py-1 text-left font-mono text-[11px] text-gray-700 hover:bg-blue-50 dark:text-gray-200 dark:hover:bg-blue-500/10" title={file}>
                        {file}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 px-1 text-[10px] text-gray-400">Up to 12 files. Secret/key files are never sent.</p>
                </div>
              )}
            </div>
            <textarea
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              disabled={!settings?.configured}
              rows={Math.min(8, Math.max(2, draft.split('\n').length))}
              placeholder={settings?.configured ? 'Ask the assistant to write or fix a test… (Enter to send, Shift+Enter for a new line)' : 'Connect an AI provider in Settings first'}
              className="form-input min-h-[44px] flex-1 resize-none !text-sm"
            />
            {streaming ? (
              <button onClick={stop} className="btn-secondary !px-3 !py-2 text-red-600" title="Stop generating"><Square size={15} /></button>
            ) : (
              <button onClick={() => void send()} disabled={!settings?.configured || (!draft.trim() && !run)} className="btn-primary !px-3 !py-2" title="Send">
                <Send size={15} />
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
