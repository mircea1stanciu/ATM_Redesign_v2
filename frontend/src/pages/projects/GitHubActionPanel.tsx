import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, DownloadCloud, ExternalLink, Github, Loader2, PlayCircle, RefreshCcw, Rocket } from 'lucide-react'
import { apiService } from '@/services/api'
import { useAppStore } from '@/store/useAppStore'
import type { GitHubRun, GitHubTemplates, IssueTemplateItem, WorkflowItem } from '@/types/domain'

type Props = {
  projectId: string | null
  canExecute: boolean
}

type Feedback = { type: 'success' | 'error'; message: string } | null

// Colour + label for a GitHub run's real execution state (status/conclusion).
function runStateStyle(run: GitHubRun): { label: string; cls: string } {
  if (run.status !== 'completed') {
    const running = run.status === 'in_progress'
    return {
      label: running ? 'In progress' : (run.status || 'queued').replace('_', ' '),
      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    }
  }
  const c = (run.conclusion || '').toLowerCase()
  if (c === 'success') return { label: 'Success', cls: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300' }
  if (c === 'failure' || c === 'startup_failure') return { label: 'Failure', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' }
  if (c === 'cancelled') return { label: 'Cancelled', cls: 'bg-gray-200 text-gray-600 dark:bg-gray-600/40 dark:text-gray-300' }
  return { label: run.conclusion || 'Unknown', cls: 'bg-gray-200 text-gray-600 dark:bg-gray-600/40 dark:text-gray-300' }
}

export default function GitHubActionPanel({ projectId, canExecute }: Props) {
  const [templates, setTemplates] = useState<GitHubTemplates | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [ref, setRef] = useState('')
  const [inputValues, setInputValues] = useState<Record<string, string | boolean>>({})
  const [dispatching, setDispatching] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [syncing, setSyncing] = useState(false)
  const [ghRuns, setGhRuns] = useState<GitHubRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [runsError, setRunsError] = useState<string | null>(null)

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    setFeedback(null)
    try {
      const data = await apiService.getProjectTemplates(projectId)
      setTemplates(data)
      setRef(data.ref)
    } catch (e) {
      setTemplates(null)
      setError(apiService.errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const selectedWorkflow: WorkflowItem | undefined = useMemo(
    () => templates?.workflows.find(w => `wf:${w.id}` === selectedId),
    [templates, selectedId],
  )
  const selectedIssueTemplate: IssueTemplateItem | undefined = useMemo(
    () => templates?.issue_templates.find(t => `it:${t.id}` === selectedId),
    [templates, selectedId],
  )

  // Reset inputs whenever the selected workflow changes, seeding defaults.
  useEffect(() => {
    if (!selectedWorkflow) {
      setInputValues({})
      return
    }
    const seed: Record<string, string | boolean> = {}
    for (const input of selectedWorkflow.inputs) {
      if (input.type === 'boolean') {
        seed[input.name] = input.default === true || String(input.default) === 'true'
      } else {
        seed[input.name] = input.default != null ? String(input.default) : ''
      }
    }
    setInputValues(seed)
    setFeedback(null)
  }, [selectedWorkflow])

  const setInput = (name: string, value: string | boolean) => {
    setInputValues(prev => ({ ...prev, [name]: value }))
  }

  // Load the live GitHub run history for the selected workflow.
  const loadGhRuns = async (workflowId: string) => {
    if (!projectId || !workflowId) return
    setRunsLoading(true)
    setRunsError(null)
    try {
      const data = await apiService.getProjectWorkflowRuns(projectId, { workflow_id: workflowId, limit: 20 })
      setGhRuns(data)
      // Persist this workflow's runs in the background so they also feed the
      // DB-backed Dashboard & Analytics pages (idempotent upsert by GitHub run
      // id). Best-effort: the visible history already loaded straight from GitHub.
      void persistGhRuns(workflowId)
    } catch (e) {
      setGhRuns([])
      setRunsError(apiService.errorMessage(e))
    } finally {
      setRunsLoading(false)
    }
  }

  // Import the selected workflow's GitHub runs into the local DB (source=github_actions)
  // and refresh the store so Analytics/Dashboard reflect them, without blocking the UI.
  const persistGhRuns = async (workflowId: string) => {
    if (!projectId) return
    try {
      await apiService.syncProjectWorkflowRuns(projectId, { workflow_id: workflowId, limit: 200 })
      await useAppStore.getState().refreshProjectData(projectId)
    } catch {
      /* best-effort background sync; ignore errors */
    }
  }

  // Whenever a workflow is selected, fetch its real GitHub run history.
  useEffect(() => {
    setGhRuns([])
    setRunsError(null)
    if (selectedWorkflow) void loadGhRuns(selectedWorkflow.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkflow, projectId])

  const missingRequired = useMemo(() => {
    if (!selectedWorkflow) return false
    return selectedWorkflow.inputs.some(
      i => i.required && i.type !== 'boolean' && !String(inputValues[i.name] ?? '').trim(),
    )
  }, [selectedWorkflow, inputValues])

  const dispatch = async () => {
    if (!projectId || !selectedWorkflow) return
    setDispatching(true)
    setFeedback(null)
    try {
      // Prefer an input that clearly identifies which collection/suite is
      // being run (e.g. "collection", "suite", "tests"); fall back to the
      // workflow's own name so every dispatched run is still labeled.
      const collectionInput = selectedWorkflow.inputs.find(i => /collection|suite|tests?/i.test(i.name))
      const collection = (collectionInput ? String(inputValues[collectionInput.name] ?? '') : '').trim() || selectedWorkflow.name

      const result = await apiService.dispatchProjectWorkflow(projectId, {
        workflow_id: selectedWorkflow.id,
        ref: ref || undefined,
        inputs: inputValues,
        collection,
      })
      setFeedback({
        type: 'success',
        message: `Workflow "${selectedWorkflow.name}" dispatched on ${result.ref}. Tracking the run from GitHub…`,
      })
      if (projectId) await useAppStore.getState().refreshProjectData(projectId)
      await loadGhRuns(selectedWorkflow.id)
    } catch (e) {
      setFeedback({ type: 'error', message: apiService.errorMessage(e) })
    } finally {
      setDispatching(false)
    }
  }

  // Pull the real GitHub Actions run history into the app (Runs/Dashboard/Analytics).
  // Pass a workflowId to sync just that workflow's runs; omit it to sync all.
  const syncRuns = async (workflowId?: string) => {
    if (!projectId) return
    setSyncing(true)
    setFeedback(null)
    try {
      const result = await apiService.syncProjectWorkflowRuns(projectId, {
        workflow_id: workflowId,
        limit: 200,
      })
      setFeedback({
        type: 'success',
        message: `Synced ${result.synced} run${result.synced === 1 ? '' : 's'} from GitHub `
          + `(${result.created} new, ${result.updated} updated`
          + `${result.total_available ? ` of ${result.total_available} available` : ''}).`,
      })
      await useAppStore.getState().refreshProjectData(projectId)
      if (workflowId) await loadGhRuns(workflowId)
      else if (selectedWorkflow) await loadGhRuns(selectedWorkflow.id)
    } catch (e) {
      setFeedback({ type: 'error', message: apiService.errorMessage(e) })
    } finally {
      setSyncing(false)
    }
  }

  if (!projectId) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-2xl border border-gray-200/80 bg-white text-sm text-gray-500 dark:border-gray-700/70 dark:bg-gray-800/90 dark:text-gray-400">
        Select a project to trigger GitHub Actions.
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      {/* Left: template picker */}
      <div className="flex w-80 shrink-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-3 py-2.5 dark:border-gray-700">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-900 dark:text-white">
            <Github size={13} /> Actions & Templates
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void syncRuns()}
              disabled={syncing || loading}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700/50"
              title="Fetch the GitHub Actions run history into Runs / Dashboard / Analytics"
            >
              {syncing ? <Loader2 size={13} className="animate-spin" /> : <DownloadCloud size={13} />}
              Sync runs
            </button>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700/50"
              title="Rescan .github folder"
            >
              <RefreshCcw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Reading .github…
            </div>
          )}
          {!loading && error && (
            <div className="m-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-300">
              <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
          {!loading && !error && templates && (
            <>
              <div className="px-3 pt-3 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                Workflows ({templates.workflows.length})
              </div>
              {templates.workflows.length === 0 && (
                <p className="px-3 py-2 text-[11px] text-gray-400">No dispatchable workflows found in .github/workflows.</p>
              )}
              {templates.workflows.map(wf => (
                <button
                  key={`wf:${wf.id}`}
                  onClick={() => setSelectedId(`wf:${wf.id}`)}
                  className={`flex w-full flex-col items-start border-b border-gray-100 px-3 py-2 text-left transition dark:border-gray-700/50 ${
                    selectedId === `wf:${wf.id}`
                      ? 'bg-blue-50 dark:bg-blue-500/10'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                  }`}
                >
                  <span className="text-xs font-medium text-gray-900 dark:text-white">{wf.name}</span>
                  <span className="font-mono text-[10px] text-gray-400">{wf.id}</span>
                </button>
              ))}

              <div className="px-3 pt-4 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                Issue Templates ({templates.issue_templates.length})
              </div>
              {templates.issue_templates.length === 0 && (
                <p className="px-3 py-2 text-[11px] text-gray-400">No issue form templates found in .github/ISSUE_TEMPLATE.</p>
              )}
              {templates.issue_templates.map(t => (
                <button
                  key={`it:${t.id}`}
                  onClick={() => setSelectedId(`it:${t.id}`)}
                  className={`flex w-full flex-col items-start border-b border-gray-100 px-3 py-2 text-left transition dark:border-gray-700/50 ${
                    selectedId === `it:${t.id}`
                      ? 'bg-blue-50 dark:bg-blue-500/10'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                  }`}
                >
                  <span className="text-xs font-medium text-gray-900 dark:text-white">{t.name}</span>
                  <span className="font-mono text-[10px] text-gray-400">{t.id}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Right: configuration form */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        {!selectedWorkflow && !selectedIssueTemplate && (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-gray-500 dark:text-gray-400">
            Select a workflow to configure and trigger a GitHub Actions run.
          </div>
        )}

        {selectedWorkflow && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
                <Rocket size={14} /> {selectedWorkflow.name}
              </h3>
              <p className="mt-0.5 font-mono text-[11px] text-gray-400">.github/workflows/{selectedWorkflow.id}</p>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                  Branch / ref to run on
                </label>
                <input
                  type="text"
                  value={ref}
                  onChange={e => setRef(e.target.value)}
                  placeholder="main"
                  className="form-input w-full !py-1.5 !px-2 !text-xs"
                />
              </div>

              {selectedWorkflow.inputs.length === 0 && (
                <p className="text-xs text-gray-400">This workflow has no inputs. Just pick a branch and run.</p>
              )}

              {selectedWorkflow.inputs.map(input => (
                <div key={input.name}>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                    {input.name}
                    {input.required && <span className="ml-0.5 text-red-500">*</span>}
                  </label>
                  {input.description && (
                    <p className="mb-1 text-[11px] text-gray-400">{input.description}</p>
                  )}
                  {input.type === 'boolean' ? (
                    <label className="inline-flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={Boolean(inputValues[input.name])}
                        onChange={e => setInput(input.name, e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      Enabled
                    </label>
                  ) : input.type === 'choice' && input.options.length > 0 ? (
                    <select
                      value={String(inputValues[input.name] ?? '')}
                      onChange={e => setInput(input.name, e.target.value)}
                      className="form-input w-full !py-1.5 !px-2 !text-xs"
                    >
                      <option value="">Select…</option>
                      {input.options.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : input.options.length > 0 ? (
                    <>
                      <input
                        type="text"
                        list={`options-${input.name}`}
                        value={String(inputValues[input.name] ?? '')}
                        onChange={e => setInput(input.name, e.target.value)}
                        placeholder={input.example || input.options[0]}
                        className="form-input w-full !py-1.5 !px-2 !text-xs"
                      />
                      <datalist id={`options-${input.name}`}>
                        {input.options.map(opt => (
                          <option key={opt} value={opt} />
                        ))}
                      </datalist>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="text-[11px] text-gray-400">Supported values:</span>
                        {input.options.map(opt => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setInput(input.name, opt)}
                            className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <input
                      type={input.type === 'number' ? 'number' : 'text'}
                      value={String(inputValues[input.name] ?? '')}
                      onChange={e => setInput(input.name, e.target.value)}
                      placeholder={input.example || undefined}
                      className="form-input w-full !py-1.5 !px-2 !text-xs"
                    />
                  )}
                  {input.example && input.type !== 'boolean' && (
                    <p className="mt-1 text-[11px] italic text-gray-400">e.g. {input.example}</p>
                  )}
                </div>
              ))}

              {/* Live GitHub run history for this workflow */}
              <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200">
                    <Github size={12} /> GitHub run history
                  </h4>
                  <button
                    onClick={() => void loadGhRuns(selectedWorkflow.id)}
                    disabled={runsLoading}
                    className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700/50"
                    title="Refresh run status from GitHub"
                  >
                    <RefreshCcw size={12} className={runsLoading ? 'animate-spin' : ''} />
                  </button>
                </div>

                {runsLoading && ghRuns.length === 0 && (
                  <div className="flex items-center gap-2 py-3 text-[11px] text-gray-400">
                    <Loader2 size={12} className="animate-spin" /> Loading runs from GitHub…
                  </div>
                )}
                {runsError && (
                  <div className="flex items-start gap-1.5 rounded-lg bg-red-50 p-2 text-[11px] text-red-600 dark:bg-red-900/20 dark:text-red-300">
                    <AlertCircle size={12} className="mt-0.5 shrink-0" /> {runsError}
                  </div>
                )}
                {!runsLoading && !runsError && ghRuns.length === 0 && (
                  <p className="py-2 text-[11px] text-gray-400">No runs found on GitHub for this workflow yet.</p>
                )}
                {ghRuns.length > 0 && (
                  <ul className="space-y-1.5">
                    {ghRuns.map(run => {
                      const st = runStateStyle(run)
                      const when = run.run_started_at || run.created_at
                      return (
                        <li
                          key={run.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 dark:border-gray-700/50"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
                              {run.run_number != null && (
                                <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">#{run.run_number}</span>
                              )}
                              {run.branch && (
                                <span className="truncate font-mono text-[10px] text-gray-400">{run.branch}</span>
                              )}
                            </div>
                            <div className="mt-0.5 truncate text-[10px] text-gray-400">
                              {run.actor ? `${run.actor} · ` : ''}{when ? new Date(when).toLocaleString() : ''}
                            </div>
                          </div>
                          {run.html_url && (
                            <a
                              href={run.html_url}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700/50 dark:hover:text-gray-200"
                              title="Open run on GitHub"
                            >
                              <ExternalLink size={12} />
                            </a>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>

            <div className="shrink-0 space-y-2 border-t border-gray-200 p-4 dark:border-gray-700">
              {feedback && (
                <div
                  className={`flex items-start gap-2 rounded-lg p-2.5 text-xs ${
                    feedback.type === 'success'
                      ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                      : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300'
                  }`}
                >
                  {feedback.type === 'error' && <AlertCircle size={14} className="mt-0.5 shrink-0" />}
                  {feedback.message}
                </div>
              )}
              {!canExecute && (
                <p className="text-[11px] text-gray-400">You do not have permission to trigger runs.</p>
              )}
              <button
                onClick={() => void dispatch()}
                disabled={!canExecute || dispatching || missingRequired}
                className="btn-primary w-full justify-center !py-2 text-xs"
                title={missingRequired ? 'Fill in all required inputs' : 'Trigger this workflow on GitHub Actions'}
              >
                {dispatching ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={13} />}
                {dispatching ? 'Dispatching…' : 'Run on GitHub Actions'}
              </button>
              <button
                onClick={() => void syncRuns(selectedWorkflow.id)}
                disabled={syncing}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700/40 dark:text-gray-200 dark:hover:bg-gray-700"
                title="Import this workflow's past GitHub Actions runs into Runs / Dashboard / Analytics"
              >
                {syncing ? <Loader2 size={13} className="animate-spin" /> : <DownloadCloud size={13} />}
                {syncing ? 'Syncing…' : 'Import past runs from GitHub'}
              </button>
            </div>
          </div>
        )}

        {selectedIssueTemplate && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{selectedIssueTemplate.name}</h3>
              {selectedIssueTemplate.description && (
                <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{selectedIssueTemplate.description}</p>
              )}
              <p className="mt-0.5 font-mono text-[11px] text-gray-400">.github/ISSUE_TEMPLATE/{selectedIssueTemplate.id}</p>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <p className="rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                This is an issue-form template (read-only preview). It defines the fields below; runnable
                automation is triggered from the <strong>Workflows</strong> list.
              </p>
              {selectedIssueTemplate.fields.map((field, idx) => (
                <div key={`${field.id}-${idx}`}>
                  {field.type === 'markdown' ? (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{field.description}</p>
                  ) : (
                    <>
                      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                        {field.label}
                        {field.required && <span className="ml-0.5 text-red-500">*</span>}
                      </label>
                      {field.description && (
                        <p className="mb-1 text-[11px] text-gray-400">{field.description}</p>
                      )}
                      {field.type === 'dropdown' && field.options.length > 0 ? (
                        <select disabled className="form-input w-full !py-1.5 !px-2 !text-xs opacity-70">
                          {field.options.map(opt => <option key={opt}>{opt}</option>)}
                        </select>
                      ) : field.type === 'textarea' ? (
                        <textarea disabled rows={3} placeholder={field.placeholder} className="form-input w-full !py-1.5 !px-2 !text-xs opacity-70" />
                      ) : (
                        <input disabled type="text" placeholder={field.placeholder} className="form-input w-full !py-1.5 !px-2 !text-xs opacity-70" />
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
