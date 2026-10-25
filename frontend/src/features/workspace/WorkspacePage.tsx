import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { useQuery } from '@tanstack/react-query'
import { Columns3, FileCode2, FlaskConical, FolderGit2, GitCompare, ScanSearch, Sparkles } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import { usePermission } from '@/hooks/usePermission'
import AiAnalysisPanel from '@/components/ai/AiAnalysisPanel'
import type { ChatPrompt } from '@/components/ai/AiChatPanel'
import AiWorkspace from '@/components/ai/AiWorkspace'
import { findTargetForFile, preselectFrameworkTarget } from '@/components/runs/FrameworkRunConfig'
import StoryContextBar from '@/features/work/StoryContextBar'
import { workApi, workKeys } from '@/features/work/api'
import { Button, EmptyState, Skeleton, Tabs, buttonStyles } from '@/ui'
import { runDisplayName } from '@/utils/runName'
import type { AiProjectAnalysis, AiSettings } from '@/types/domain'
import ActionBar from './ActionBar'
import { useRefreshWorkspace, useRepoStatus } from './queries'
import RepositoryAnalyzer from './RepositoryAnalyzer'

const RunsPage = lazy(() => import('@/pages/RunsPage'))
const ParallelRepoView = lazy(() => import('@/pages/projects/ParallelRepoView'))
const CompareView = lazy(() => import('@/pages/projects/CompareView'))

const VIEWS = ['editor', 'three-panel', 'compare', 'analysis', 'runs'] as const
type View = typeof VIEWS[number]
// Links from before phase 07 used ?tab=assistant|analysis|test.
const LEGACY_TABS: Record<string, View> = { assistant: 'editor', analysis: 'analysis', test: 'runs' }

const LAYOUT_KEY = 'atm.workspace.layout'
type Layout = { explorer: boolean; assistant: boolean; hints: boolean }

function readLayout(): Layout {
  try {
    return { explorer: true, assistant: true, hints: true, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') }
  } catch {
    return { explorer: true, assistant: true, hints: true }
  }
}

function RunsView({ onAskAi }: { onAskAi: (prompt: ChatPrompt) => void }) {
  const runs = useAppStore(s => s.runs)
  const selectedRunId = useAppStore(s => s.selectedRunId)
  const run = runs.find(r => r.id === selectedRunId) ?? null
  const finished = run && !['running', 'pending'].includes(run.status)
  const failed = run && ['failed', 'error'].includes(run.status)
  const isLocal = run?.id.startsWith('manual-')
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-2">
        <p className="text-xs text-fg-muted">
          Run tests with the project's own runner. When a run fails, send it to the assistant: the failed tests, error
          messages and the end of the log are attached.
        </p>
        <Button size="sm" variant={failed ? 'primary' : 'secondary'} icon={<Sparkles size={13} />}
          disabled={!finished || !isLocal}
          title={!run ? 'Select a run first' : !isLocal ? 'Only local runs can be sent' : !finished ? 'Wait for the run to finish' : undefined}
          onClick={() => run && onAskAi({
            content: failed ? 'This test run failed. Find the cause and fix it.' : 'Review this test run and suggest improvements.',
            runId: run.id,
            runLabel: `${runDisplayName(run)} (${run.status})`,
          })}>
          {failed ? 'Ask AI to fix this run' : 'Send run to AI'}
        </Button>
      </div>
      <div className="min-h-0 flex-1"><RunsPage embedded /></div>
    </div>
  )
}

/**
 * Work › Workspace: the editor (explorer, tabs, review, assistant) with the action bar, plus the repository views
 * (3-Panel, Compare), the analysis and the runs. The view is in the URL (?view=…).
 */
export default function WorkspacePage() {
  const projectId = useAppStore(s => s.selectedProjectId)
  const loadProjectData = useAppStore(s => s.loadProjectData)
  const canEdit = usePermission('code.edit')
  const [params, setParams] = useSearchParams()
  const legacy = LEGACY_TABS[params.get('tab') ?? '']
  const requested = params.get('view') as View | null
  const view: View = requested && VIEWS.includes(requested) ? requested : legacy ?? 'editor'
  const setView = useCallback((next: View) => setParams(p => { p.set('view', next); p.delete('tab'); return p }, { replace: true }), [setParams])
  const itemId = Number(params.get('item')) || null

  const [layout, setLayoutState] = useState<Layout>(readLayout)
  const setLayout = (next: Layout) => {
    setLayoutState(next)
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next))
    } catch {
      // Storage unavailable: the layout lasts for this page.
    }
  }
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [prompt, setPrompt] = useState<ChatPrompt | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Bumped when the action bar switches branch, so the editor reloads the tree and the open files.
  const [editorKey, setEditorKey] = useState(0)
  const refreshWorkspace = useRefreshWorkspace(projectId ?? '')

  useEffect(() => {
    if (legacy && !requested) setView(legacy)
  }, [legacy, requested, setView])
  useEffect(() => {
    apiService.getAiSettings().then(setSettings).catch(() => setSettings(null))
  }, [])
  useEffect(() => {
    if (projectId) void loadProjectData(projectId)
  }, [projectId, loadProjectData])

  const analysis = useQuery<AiProjectAnalysis>({
    queryKey: ['workspace', projectId, 'ai-analysis'],
    queryFn: () => apiService.getAiAnalysis(projectId!, false),
    enabled: Boolean(projectId),
    retry: false,
  })
  const noCheckout = analysis.isError && axios.isAxiosError(analysis.error) && analysis.error.response?.status === 400
  const status = useRepoStatus(projectId ?? '')
  const items = useQuery({
    queryKey: workKeys.items(projectId ?? ''),
    queryFn: () => workApi.items(projectId!),
    enabled: Boolean(projectId),
  })
  // The story of the workspace: the one Start work opened, else the work item of the current branch.
  const workItem = items.data?.find(i => i.id === itemId)
    ?? items.data?.find(i => i.branch && i.branch === status.data?.current_branch) ?? null

  const askAssistant = useCallback((request: ChatPrompt) => {
    setPrompt(request)
    setView('editor')
  }, [setView])

  const testFile = useCallback(async (path: string) => {
    if (!projectId) return
    setNotice(null)
    try {
      const detection = await apiService.getLocalFrameworks(projectId, true)
      const target = findTargetForFile(detection, path)
      if (target) preselectFrameworkTarget(projectId, detection, target.frameworkId, target.targetId)
      else setNotice(`'${path}' is not a runnable test target on its own; choose what to run in Runs.`)
    } catch (e) {
      setNotice(apiService.errorMessage(e))
    }
    setView('runs')
  }, [projectId, setView])

  if (!projectId) {
    return <EmptyState icon={FileCode2} title="Choose a project">Pick a project in the top bar to open its workspace.</EmptyState>
  }

  const fallback = <Skeleton className="h-full min-h-[20rem]" />
  return (
    <div className="flex h-full min-h-[560px] flex-col gap-3">
      {workItem && <StoryContextBar projectId={projectId} itemId={workItem.id} />}
      <div className="flex shrink-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <Tabs label="Workspace views" param="view" items={[
            { to: 'editor', label: 'Editor', icon: FileCode2 },
            { to: 'three-panel', label: 'Repository', icon: Columns3 }, // the GitHub tree, the file and the changes
            { to: 'compare', label: 'Compare', icon: GitCompare },
            { to: 'analysis', label: 'Analysis', icon: ScanSearch },
            { to: 'runs', label: 'Runs', icon: FlaskConical },
          ]} />
        </div>
        {notice && (
          <span role="status" className="flex items-center gap-2 rounded-lg bg-warning/10 px-2 py-1 text-xs text-fg">
            {notice}<button onClick={() => setNotice(null)} aria-label="Dismiss" className="font-semibold">×</button>
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {/* Without a checkout only Runs and Repository open: Repository is where one is cloned or linked. */}
        {noCheckout && view !== 'runs' && view !== 'three-panel' ? (
          <EmptyState icon={FolderGit2} title="No local copy of the repository yet"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => setView('three-panel')}>Clone or link the repository</Button>
                <Link to="/tests/project" className={buttonStyles('secondary')}>Create a starter project</Link>
              </div>
            }>
            The workspace works on the project's local copy. Clone the GitHub repository, or link a folder already
            cloned on the server, in the Repository view. A new project can start from a starter project instead.
          </EmptyState>
        ) : (
          <Suspense fallback={fallback}>
            {view === 'editor' ? (
              <AiWorkspace
                key={`${projectId}:${editorKey}`}
                projectId={projectId}
                settings={settings}
                files={analysis.data?.files ?? []}
                canEdit={canEdit}
                prompt={prompt}
                onPromptConsumed={() => setPrompt(null)}
                onTestFile={path => void testFile(path)}
                onProjectChanged={() => void analysis.refetch()}
                onSettingsChange={setSettings}
                workItemId={workItem?.id ?? null}
                showExplorer={layout.explorer}
                showAssistant={layout.assistant}
                hintsEnabled={layout.hints}
                onFilesChanged={() => void refreshWorkspace()}
              />
            ) : view === 'three-panel' ? (
              <div className="h-full overflow-hidden rounded-xl border border-line bg-surface p-3"><ParallelRepoView projectId={projectId} onCheckoutChanged={() => void refreshWorkspace()} /></div>
            ) : view === 'compare' ? (
              <div className="h-full overflow-hidden rounded-xl border border-line bg-surface p-3"><CompareView projectId={projectId} /></div>
            ) : view === 'analysis' ? (
              <div className="grid h-full gap-3 overflow-y-auto xl:grid-cols-[2fr_1fr]">
                <AiAnalysisPanel analysis={analysis.data ?? null} loading={analysis.isFetching}
                  error={analysis.isError && !noCheckout ? apiService.errorMessage(analysis.error) : null}
                  onRefresh={() => void apiService.getAiAnalysis(projectId, true).then(() => analysis.refetch())}
                  onPrompt={askAssistant} />
                <div><RepositoryAnalyzer projectId={projectId} /></div>
              </div>
            ) : (
              <RunsView onAskAi={askAssistant} />
            )}
          </Suspense>
        )}
      </div>

      {!noCheckout && (
        <ActionBar projectId={projectId} workItem={workItem} layout={layout} onLayoutChange={setLayout}
          onBranchChanged={() => setEditorKey(k => k + 1)} />
      )}
    </div>
  )
}
