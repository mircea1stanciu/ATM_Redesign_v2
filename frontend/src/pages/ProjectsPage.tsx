import { FormEvent, useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bell, CheckCircle2, ChevronRight, File, Folder, FolderGit2,
  FolderOpen, Info, Loader2, Plus, Trash2, X, Zap,
} from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import type { GitHubTreeItem } from '@/types/domain'

type RightTab = 'details' | 'repo' | 'analyzer' | 'notifications'

export default function ProjectsPage() {
  const projects = useAppStore(s => s.projects)
  const selectedProjectId = useAppStore(s => s.selectedProjectId)
  const setSelectedProjectId = useAppStore(s => s.setSelectedProjectId)
  const projectForm = useAppStore(s => s.projectForm)
  const setProjectForm = useAppStore(s => s.setProjectForm)
  const createProject = useAppStore(s => s.createProject)
  const notificationsForm = useAppStore(s => s.notificationsForm)
  const setNotificationsForm = useAppStore(s => s.setNotificationsForm)
  const saveNotifications = useAppStore(s => s.saveNotifications)
  const savingNotifications = useAppStore(s => s.savingNotifications)
  const user = useAppStore(s => s.user)
  const deleteProject = useAppStore(s => s.deleteProject)
  const error = useAppStore(s => s.error)

  const canCreate = user?.role === 'admin' || user?.role === 'automation_lead' || user?.role === 'super_admin' || user?.role === 'org_admin'
  const canConfigure = user?.role === 'admin' || user?.role === 'automation_lead' || user?.role === 'super_admin' || user?.role === 'org_admin'

  const [showCreate, setShowCreate] = useState(false)
  const [carouselIndex, setCarouselIndex] = useState(0)
  const [rightTab, setRightTab] = useState<RightTab>('details')

  // Repo tree state
  const [repoTree, setRepoTree] = useState<GitHubTreeItem[]>([])
  const [repoPath, setRepoPath] = useState('')
  const [repoHistory, setRepoHistory] = useState<string[]>([])
  const [repoLoading, setRepoLoading] = useState(false)
  const [repoError, setRepoError] = useState<string | null>(null)

  // Analyzer state
  const [analyzerLoading, setAnalyzerLoading] = useState(false)
  const [analyzerError, setAnalyzerError] = useState<string | null>(null)
  const [analyzerResult, setAnalyzerResult] = useState<{ frameworks: string[]; projects: { path: string; environments: string[] }[]; files_count: number } | null>(null)

  const loadRepoTree = useCallback(async (projectId: string, path: string) => {
    setRepoLoading(true)
    setRepoError(null)
    try {
      const items = await apiService.getProjectRepoTree(projectId, path)
      // Sort: dirs first, then files, alphabetically
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      setRepoTree(items)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load repository'
      setRepoError(msg)
    } finally {
      setRepoLoading(false)
    }
  }, [])

  const loadAnalysis = useCallback(async (projectId: string) => {
    setAnalyzerLoading(true)
    setAnalyzerError(null)
    try {
      const result = await apiService.analyzeProjectRepo(projectId)
      setAnalyzerResult(result)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to analyze repository'
      setAnalyzerError(msg)
    } finally {
      setAnalyzerLoading(false)
    }
  }, [])

  useEffect(() => {
    if (rightTab === 'repo' && selectedProjectId) {
      setRepoTree([])
      setRepoPath('')
      setRepoHistory([])
      void loadRepoTree(selectedProjectId, '')
    }
  }, [rightTab, selectedProjectId, loadRepoTree])

  useEffect(() => {
    if (rightTab === 'analyzer' && selectedProjectId) {
      void loadAnalysis(selectedProjectId)
    }
  }, [rightTab, selectedProjectId, loadAnalysis])

  const navigateInto = (item: GitHubTreeItem) => {
    if (item.type !== 'dir' || !selectedProjectId) return
    setRepoHistory(h => [...h, repoPath])
    setRepoPath(item.path)
    void loadRepoTree(selectedProjectId, item.path)
  }

  const navigateBack = () => {
    if (!selectedProjectId) return
    const prev = repoHistory[repoHistory.length - 1] ?? ''
    setRepoHistory(h => h.slice(0, -1))
    setRepoPath(prev)
    void loadRepoTree(selectedProjectId, prev)
  }

  const selectedProject = projects.find(p => p.id === selectedProjectId) || null
  const totalSlides = 2

  const goPrevSlide = () => setCarouselIndex(prev => (prev - 1 + totalSlides) % totalSlides)
  const goNextSlide = () => setCarouselIndex(prev => (prev + 1) % totalSlides)

  const handleCreateProject = async (e: FormEvent) => {
    e.preventDefault()
    await createProject()
    setShowCreate(false)
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Create modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setShowCreate(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-lg rounded-3xl border border-gray-200/80 dark:border-gray-700/70 glass p-6 shadow-soft-lg"
            >
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">New Project</h2>
                <button onClick={() => setShowCreate(false)} className="rounded-lg p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700"><X size={16} /></button>
              </div>
              <form onSubmit={handleCreateProject} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Project name</label>
                  <input className="form-input" placeholder="My Test Suite" value={projectForm.name}
                    onChange={e => setProjectForm(p => ({ ...p, name: e.target.value }))} required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Repository URL</label>
                  <input className="form-input" placeholder="https://github.com/org/repo" value={projectForm.git_repo_url}
                    onChange={e => setProjectForm(p => ({ ...p, git_repo_url: e.target.value }))} required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Branch</label>
                    <input className="form-input" placeholder="main" value={projectForm.default_branch}
                      onChange={e => setProjectForm(p => ({ ...p, default_branch: e.target.value }))} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Framework</label>
                    <select className="form-input" value={projectForm.framework}
                      onChange={e => setProjectForm(p => ({ ...p, framework: e.target.value }))}>
                      <option value="pytest">pytest</option>
                      <option value="playwright">playwright</option>
                      <option value="appium">appium</option>
                      <option value="cypress">cypress</option>
                      <option value="robot">robot</option>
                      <option value="bruno">bruno</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Description</label>
                  <textarea className="form-input" placeholder="Optional..." value={projectForm.description}
                    onChange={e => setProjectForm(p => ({ ...p, description: e.target.value }))} rows={2} />
                </div>
                {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowCreate(false)} className="btn-ghost">Cancel</button>
                  <button type="submit" className="btn-primary"><Plus size={15} /> Add project</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Carousel wrapper (future-ready) */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex items-center justify-between rounded-2xl border border-gray-200/80 bg-white px-4 py-2 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
          <div className="section-title">GitHub Projects pages</div>
          <div className="flex items-center gap-2">
            <button onClick={goPrevSlide} className="btn-ghost !px-2 !py-1 text-xs" aria-label="Previous slide">
              <ChevronRight size={12} className="rotate-180" />
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400">{carouselIndex + 1}/{totalSlides}</span>
            <button onClick={goNextSlide} className="btn-ghost !px-2 !py-1 text-xs" aria-label="Next slide">
              <ChevronRight size={12} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <div
            className="flex h-full transition-transform duration-300 ease-in-out"
            style={{ width: `${totalSlides * 100}%`, transform: `translateX(-${(100 / totalSlides) * carouselIndex}%)` }}
          >
            <section className="h-full shrink-0" style={{ width: `${100 / totalSlides}%` }}>
              {/* Main grid */}
              <div className="grid min-h-0 h-full gap-4 lg:grid-cols-[340px_1fr]">
        {/* Left: project list */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft">
          <div className="flex shrink-0 items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
            <h3 className="section-title">
              GitHub Projects <span className="text-gray-400 dark:text-gray-500">({projects.length})</span>
            </h3>
            {canCreate && (
              <button onClick={() => setShowCreate(true)} className="btn-primary px-2.5 py-1.5 text-xs">
                <Plus size={13} />
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {projects.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center">
                <FolderGit2 size={28} className="mb-3 text-gray-300 dark:text-gray-600" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No projects yet</p>
                {canCreate && <button onClick={() => setShowCreate(true)} className="mt-2 text-xs text-yellow-600 dark:text-yellow-400 hover:underline font-medium">Add one →</button>}
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700/50 p-1">
                {projects.map(project => {
                  const isSelected = selectedProjectId === project.id
                  return (
                    <div key={project.id} className="group relative">
                      <button
                        onClick={() => setSelectedProjectId(project.id)}
                        className={`flex w-full items-start gap-3 rounded-xl p-3 text-left transition-all ${
                          isSelected
                            ? 'bg-yellow-50 dark:bg-yellow-500/10 ring-1 ring-yellow-200 dark:ring-yellow-500/30'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                        }`}
                      >
                        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                          isSelected
                            ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                        }`}>
                          <FolderGit2 size={14} />
                        </div>
                        <div className="min-w-0 flex-1 pr-6">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{project.name}</p>
                            {isSelected && <CheckCircle2 size={12} className="shrink-0 text-yellow-500" />}
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-gray-400">{project.git_repo_url}</p>
                          <div className="mt-1.5 flex items-center gap-2">
                            <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-400">{project.framework || '?'}</span>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">{project.default_branch}</span>
                          </div>
                        </div>
                      </button>
                      {canCreate && (
                        <button
                          title="Delete project"
                          onClick={() => {
                            if (window.confirm(`Delete project "${project.name}"? This will remove all suites and runs.`)) {
                              void deleteProject(project.id)
                            }
                          }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 transition-opacity"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: details / notifications */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft">
          {/* Tabs */}
          <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 dark:border-gray-700 px-4 py-2">
            {([
              { id: 'details' as RightTab, label: 'Details', icon: Info },
              { id: 'repo' as RightTab, label: 'Repository Structure', icon: FolderOpen },
              { id: 'analyzer' as RightTab, label: 'Repository Analyzer', icon: Zap },
              { id: 'notifications' as RightTab, label: 'Notifications', icon: Bell },
            ]).map(t => (
              <button
                key={t.id}
                onClick={() => setRightTab(t.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  rightTab === t.id
                    ? 'bg-yellow-50 dark:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                }`}
              >
                <t.icon size={13} />
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {!selectedProject ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <FolderGit2 size={28} className="mb-3 text-gray-300 dark:text-gray-600" />
                <p className="text-sm text-gray-500 dark:text-gray-400">Select a project from the left</p>
              </div>
            ) : rightTab === 'details' ? (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">{selectedProject.name}</h2>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{selectedProject.description || 'No description'}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: 'Provider', value: selectedProject.git_provider },
                    { label: 'Branch', value: selectedProject.default_branch },
                    { label: 'Framework', value: selectedProject.framework || 'unknown' },
                  ].map(item => (
                    <div key={item.label} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 p-4">
                      <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{item.label}</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{item.value}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 p-4">
                  <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Repository</p>
                  <p className="mt-1 truncate text-sm text-gray-700 dark:text-gray-300">{selectedProject.git_repo_url}</p>
                </div>
              </div>
            ) : rightTab === 'notifications' ? (
              <div className="space-y-3">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Notifications — {selectedProject.name}</h3>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Email and Slack alerts on failure</p>
                </div>
                {([
                  { label: 'Email enabled', key: 'emailEnabled' as const },
                  { label: 'Notify on failure', key: 'notifyOnFailed' as const },
                  { label: 'Notify on error', key: 'notifyOnError' as const },
                  { label: 'Slack enabled', key: 'slackEnabled' as const },
                ] as const).map(({ label, key }) => (
                  <label key={key} className="flex cursor-pointer items-center justify-between rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/20 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 transition hover:border-yellow-300 dark:hover:border-yellow-500/50">
                    {label}
                    <input type="checkbox" checked={notificationsForm[key]}
                      disabled={!canConfigure}
                      onChange={e => setNotificationsForm(p => ({ ...p, [key]: e.target.checked }))}
                      className="h-4 w-4 accent-yellow-600" />
                  </label>
                ))}
                {notificationsForm.emailEnabled && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Recipients</label>
                    <input className="form-input" placeholder="email1@x.com, email2@x.com"
                      disabled={!canConfigure}
                      value={notificationsForm.emailRecipients}
                      onChange={e => setNotificationsForm(p => ({ ...p, emailRecipients: e.target.value }))} />
                  </div>
                )}
                {notificationsForm.slackEnabled && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Slack Webhook</label>
                    <input className="form-input" placeholder="https://hooks.slack.com/services/..."
                      disabled={!canConfigure}
                      value={notificationsForm.slackWebhookUrl}
                      onChange={e => setNotificationsForm(p => ({ ...p, slackWebhookUrl: e.target.value }))} />
                  </div>
                )}
                <button onClick={() => void saveNotifications()} disabled={!canConfigure || savingNotifications} className="btn-primary w-full py-2.5 mt-2">
                  {savingNotifications && <Loader2 size={14} className="animate-spin" />}
                  {savingNotifications ? 'Saving...' : 'Save settings'}
                </button>
              </div>
            ) : rightTab === 'repo' ? (
              /* ── Repository Structure tab ── */
              <div className="flex h-full flex-col">
                {/* Breadcrumb */}
                <div className="mb-3 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                  <button
                    onClick={() => { setRepoHistory([]); setRepoPath(''); void loadRepoTree(selectedProjectId!, '') }}
                    className="font-medium text-yellow-600 dark:text-yellow-400 hover:underline"
                  >
                    root
                  </button>
                  {repoPath.split('/').filter(Boolean).map((seg, i, arr) => (
                    <span key={i} className="flex items-center gap-1">
                      <ChevronRight size={12} />
                      {i === arr.length - 1 ? (
                        <span className="text-gray-700 dark:text-gray-300 font-medium">{seg}</span>
                      ) : (
                        <button
                          className="text-yellow-600 dark:text-yellow-400 hover:underline"
                          onClick={() => {
                            const targetPath = arr.slice(0, i + 1).join('/')
                            const newHistory = repoHistory.slice(0, repoHistory.indexOf(targetPath) + 1)
                            setRepoHistory(newHistory)
                            setRepoPath(targetPath)
                            void loadRepoTree(selectedProjectId!, targetPath)
                          }}
                        >{seg}</button>
                      )}
                    </span>
                  ))}
                  {repoHistory.length > 0 && (
                    <button onClick={navigateBack} className="ml-auto text-[10px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5">
                      ← Back
                    </button>
                  )}
                </div>

                {repoLoading ? (
                  <div className="flex flex-1 items-center justify-center gap-2 text-gray-400">
                    <Loader2 size={18} className="animate-spin" /> Loading…
                  </div>
                ) : repoError ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                    <FolderGit2 size={28} className="text-red-400" />
                    <p className="text-sm text-red-500 dark:text-red-400">{repoError}</p>
                    <p className="text-xs text-gray-400">Make sure GitHub is connected and the token has repo access.</p>
                  </div>
                ) : repoTree.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                    <FolderGit2 size={28} className="text-gray-300 dark:text-gray-600" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">Empty directory</p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700/50">
                    {repoTree.map(item => (
                      <div
                        key={item.sha}
                        className={`group flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                          item.type === 'dir'
                            ? 'cursor-pointer hover:bg-yellow-50 dark:hover:bg-yellow-500/10'
                            : 'cursor-default'
                        }`}
                        onClick={() => navigateInto(item)}
                      >
                        {item.type === 'dir' ? (
                          <Folder size={15} className="shrink-0 text-amber-400" />
                        ) : (
                          <File size={15} className="shrink-0 text-gray-400 dark:text-gray-500" />
                        )}
                        <span className={`flex-1 truncate text-xs font-medium ${
                          item.type === 'dir'
                            ? 'text-gray-800 dark:text-gray-200 group-hover:text-yellow-600 dark:group-hover:text-yellow-400'
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
                          <ChevronRight size={12} className="shrink-0 text-gray-400 group-hover:text-yellow-500" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : rightTab === 'analyzer' ? (
              <div className="flex h-full flex-col gap-4">
                {analyzerLoading ? (
                  <div className="flex flex-1 items-center justify-center gap-2 text-gray-400">
                    <Loader2 size={18} className="animate-spin" /> Analyzing repository…
                  </div>
                ) : analyzerError ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                    <FolderGit2 size={28} className="text-red-400" />
                    <p className="text-sm text-red-500 dark:text-red-400">{analyzerError}</p>
                    <p className="text-xs text-gray-400">Make sure GitHub is connected and the token has repo access.</p>
                  </div>
                ) : analyzerResult ? (
                  <div className="space-y-4 overflow-y-auto">
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">Repository Info</p>
                      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 px-4 py-3">
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                          Total files: <span className="font-semibold">{analyzerResult.files_count}</span>
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">Detected Frameworks</p>
                      {analyzerResult.frameworks.length === 0 ? (
                        <p className="text-xs text-gray-400 dark:text-gray-500 italic">No frameworks detected</p>
                      ) : (
                        <div className="grid grid-cols-1 gap-2">
                          {analyzerResult.frameworks.map(fw => (
                            <div key={fw} className="flex items-center gap-2 rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2">
                              <span className="h-2 w-2 rounded-full bg-yellow-500" />
                              <span className="text-xs font-medium text-yellow-700 dark:text-yellow-300">{fw}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">Detected Projects and Collections</p>
                      {analyzerResult.projects.length === 0 ? (
                        <p className="text-xs text-gray-400 dark:text-gray-500 italic">No test suites detected</p>
                      ) : (
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700/50 overflow-hidden">
                          {analyzerResult.projects.map((project, i) => (
                            <div key={i} className="px-3 py-2.5">
                              <div className="flex items-start gap-2">
                                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                                <span className="break-all text-xs text-gray-600 dark:text-gray-400 font-mono">{project.path}</span>
                              </div>
                              {project.environments.length > 0 && (
                                <div className="mt-1.5 ml-3.5">
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Environments: </span>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                  {project.environments.map(env => (
                                    <span key={env} className="inline-flex items-center rounded-full bg-sky-100 dark:bg-sky-900/30 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300">
                                      {env}
                                    </span>
                                  ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <button onClick={() => void loadAnalysis(selectedProject!.id)} disabled={analyzerLoading}
                      className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-40 transition">
                      {analyzerLoading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Re-analyze
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Notifications — {selectedProject?.name}</h3>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Email and Slack alerts on failure</p>
                </div>
                {([
                  { label: 'Email enabled', key: 'emailEnabled' as const },
                  { label: 'Notify on failure', key: 'notifyOnFailed' as const },
                  { label: 'Notify on error', key: 'notifyOnError' as const },
                  { label: 'Slack enabled', key: 'slackEnabled' as const },
                ] as const).map(({ label, key }) => (
                  <label key={key} className="flex cursor-pointer items-center justify-between rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/20 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 transition hover:border-yellow-300 dark:hover:border-yellow-500/50">
                    {label}
                    <input type="checkbox" checked={notificationsForm[key]}
                      onChange={e => setNotificationsForm(p => ({ ...p, [key]: e.target.checked }))}
                      className="h-4 w-4 accent-yellow-600" />
                  </label>
                ))}
                {notificationsForm.emailEnabled && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Recipients</label>
                    <input className="form-input" placeholder="email1@x.com, email2@x.com"
                      value={notificationsForm.emailRecipients}
                      onChange={e => setNotificationsForm(p => ({ ...p, emailRecipients: e.target.value }))} />
                  </div>
                )}
                {notificationsForm.slackEnabled && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Slack Webhook</label>
                    <input className="form-input" placeholder="https://hooks.slack.com/services/..."
                      value={notificationsForm.slackWebhookUrl}
                      onChange={e => setNotificationsForm(p => ({ ...p, slackWebhookUrl: e.target.value }))} />
                  </div>
                )}
                <button onClick={() => void saveNotifications()} disabled={savingNotifications} className="btn-primary w-full py-2.5 mt-2">
                  {savingNotifications && <Loader2 size={14} className="animate-spin" />}
                  {savingNotifications ? 'Saving...' : 'Save settings'}
                </button>
              </div>
            )}
          </div>
        </div>
              </div>
            </section>

            <section className="h-full shrink-0" style={{ width: `${100 / totalSlides}%` }}>
              <div className="flex h-full min-h-0 flex-col rounded-2xl border border-dashed border-gray-300 bg-white p-6 shadow-soft dark:border-gray-600 dark:bg-gray-800/90">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Slide 2</h3>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  Placeholder for future GitHub Project sections.
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
