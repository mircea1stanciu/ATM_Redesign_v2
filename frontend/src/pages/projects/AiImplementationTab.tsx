import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { Bot, FlaskConical, FolderGit2, Loader2, ScanSearch, Sparkles } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import { runDisplayName } from '@/utils/runName'
import AiAnalysisPanel from '@/components/ai/AiAnalysisPanel'
import type { ChatPrompt } from '@/components/ai/AiChatPanel'
import AiWorkspace from '@/components/ai/AiWorkspace'
import { findTargetForFile, preselectFrameworkTarget } from '@/components/runs/FrameworkRunConfig'
import type { AiProjectAnalysis, AiSettings } from '@/types/domain'

const RunsPage = lazy(() => import('@/pages/RunsPage'))

type AiTab = 'analysis' | 'assistant' | 'test'
const TABS: { id: AiTab; label: string; icon: typeof Bot }[] = [
  { id: 'analysis', label: 'Analysis', icon: ScanSearch },
  { id: 'assistant', label: 'AI Assistant', icon: Bot },
  { id: 'test', label: 'Test', icon: FlaskConical },
]

function TestTab({ onAskAi }: { onAskAi: (prompt: ChatPrompt) => void }) {
  const runs = useAppStore(s => s.runs)
  const selectedRunId = useAppStore(s => s.selectedRunId)
  const run = runs.find(r => r.id === selectedRunId) ?? null
  const finished = run && !['running', 'pending'].includes(run.status)
  const failed = run && ['failed', 'error'].includes(run.status)
  const isLocal = run?.id.startsWith('manual-')

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-gray-200/80 bg-white px-4 py-2 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Run the files the assistant created or changed with the project's own runner. When a run fails, send it to the
          assistant: the failed tests, error messages and the end of the log are attached.
        </p>
        <button
          onClick={() => run && onAskAi({
            content: failed ? 'This test run failed. Find the cause and fix it.' : 'Review this test run and suggest improvements.',
            runId: run.id,
            runLabel: `${runDisplayName(run)} (${run.status})`,
          })}
          disabled={!finished || !isLocal}
          title={!run ? 'Select a run first' : !isLocal ? 'Only local runs can be sent' : !finished ? 'Wait for the run to finish' : undefined}
          className={failed ? 'btn-primary px-3 py-1.5 text-xs' : 'btn-secondary px-3 py-1.5 text-xs'}
        >
          <Sparkles size={13} /> {failed ? 'Ask AI to fix this run' : 'Send run to AI'}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>}>
          <RunsPage embedded />
        </Suspense>
      </div>
    </div>
  )
}

export default function AiImplementationTab() {
  const selectedProjectId = useAppStore(s => s.selectedProjectId)
  const canEdit = usePermission('code.edit')
  const [params, setParams] = useSearchParams()
  const tab: AiTab = (['analysis', 'assistant', 'test'] as AiTab[]).includes(params.get('tab') as AiTab) ? params.get('tab') as AiTab : 'analysis'
  const setTab = useCallback((next: AiTab) => setParams(p => { p.set('tab', next); return p }, { replace: true }), [setParams])

  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [analysis, setAnalysis] = useState<AiProjectAnalysis | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [noCheckout, setNoCheckout] = useState(false)
  const [prompt, setPrompt] = useState<ChatPrompt | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    apiService.getAiSettings().then(setSettings).catch(() => setSettings(null))
  }, [])

  const loadAnalysis = useCallback(async (refresh = false) => {
    if (!selectedProjectId) return
    setAnalysisLoading(true)
    setAnalysisError(null)
    try {
      setAnalysis(await apiService.getAiAnalysis(selectedProjectId, refresh))
      setNoCheckout(false)
    } catch (e) {
      setAnalysis(null)
      if (axios.isAxiosError(e) && e.response?.status === 400) setNoCheckout(true)
      else setAnalysisError(apiService.errorMessage(e))
    } finally {
      setAnalysisLoading(false)
    }
  }, [selectedProjectId])

  useEffect(() => {
    setAnalysis(null)
    setNoCheckout(false)
    void loadAnalysis()
  }, [loadAnalysis])

  const askAssistant = useCallback((request: ChatPrompt) => {
    setPrompt(request)
    setTab('assistant')
  }, [setTab])

  const consumePrompt = useCallback(() => setPrompt(null), [])

  const testFile = useCallback(async (path: string) => {
    if (!selectedProjectId) return
    setNotice(null)
    try {
      const detection = await apiService.getLocalFrameworks(selectedProjectId, true)
      const target = findTargetForFile(detection, path)
      if (target) preselectFrameworkTarget(selectedProjectId, detection, target.frameworkId, target.targetId)
      else setNotice(`'${path}' is not a runnable test target on its own; choose what to run in the Test tab.`)
    } catch (e) {
      setNotice(apiService.errorMessage(e))
    }
    setTab('test')
  }, [selectedProjectId, setTab])

  if (!selectedProjectId) {
    return <div className="flex h-full items-center justify-center text-sm text-gray-500">Select a project first.</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-1 rounded-2xl border border-gray-200/80 bg-white px-2 py-1.5 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${tab === id
              ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700/50'}`}>
            <Icon size={13} /> {label}
          </button>
        ))}
        {notice && (
          <span className="ml-auto flex items-center gap-2 rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            {notice}<button onClick={() => setNotice(null)} className="font-semibold">×</button>
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {noCheckout && tab !== 'test' ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <FolderGit2 size={28} className="text-gray-300 dark:text-gray-600" />
            <p className="max-w-md text-sm text-gray-500 dark:text-gray-400">
              The assistant works on the project's local copy. Import or link one first, or create a starter project from the Overview page.
            </p>
            <div className="flex gap-2">
              <Link to="/work/repository" className="btn-primary px-3 py-1.5 text-xs">Repository</Link>
              <Link to="/tests/project" className="btn-secondary px-3 py-1.5 text-xs">Project overview</Link>
            </div>
          </div>
        ) : tab === 'analysis' ? (
          <AiAnalysisPanel analysis={analysis} loading={analysisLoading} error={analysisError}
            onRefresh={() => void loadAnalysis(true)} onPrompt={askAssistant} />
        ) : tab === 'assistant' ? (
          <AiWorkspace
            key={selectedProjectId}
            projectId={selectedProjectId}
            settings={settings}
            files={analysis?.files ?? []}
            canEdit={canEdit}
            prompt={prompt}
            onPromptConsumed={consumePrompt}
            onTestFile={path => void testFile(path)}
            onProjectChanged={() => void loadAnalysis(true)}
            onSettingsChange={setSettings}
          />
        ) : (
          <TestTab onAskAi={askAssistant} />
        )}
      </div>
    </div>
  )
}
