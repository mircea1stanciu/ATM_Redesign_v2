import { useCallback, useEffect, useState } from 'react'
import {
  ChevronRight, Columns3, File, FileCode2, Folder, FolderGit2, FolderOpen, GitCompare, GitPullRequest, Loader2, Terminal, Zap,
} from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import type { GitHubTreeItem } from '@/types/domain'
import ParallelRepoView from './ParallelRepoView'
import CompareView from './CompareView'
import LocalFileEditor from './LocalFileEditor'
import LocalScriptsPanel from './LocalScriptsPanel'
import PublishPanel from './PublishPanel'

type SubTab = 'parallel' | 'compare' | 'editor' | 'scripts' | 'publish' | 'structure' | 'analyzer'

export default function RepositoryTab() {
  const selectedProjectId = useAppStore(s => s.selectedProjectId)
  const [subTab, setSubTab] = useState<SubTab>('parallel')

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
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      setRepoTree(items)
    } catch (e: unknown) {
      setRepoError(e instanceof Error ? e.message : 'Failed to load repository')
    } finally {
      setRepoLoading(false)
    }
  }, [])

  const loadAnalysis = useCallback(async (projectId: string) => {
    setAnalyzerLoading(true)
    setAnalyzerError(null)
    try {
      setAnalyzerResult(await apiService.analyzeProjectRepo(projectId))
    } catch (e: unknown) {
      setAnalyzerError(e instanceof Error ? e.message : 'Failed to analyze repository')
    } finally {
      setAnalyzerLoading(false)
    }
  }, [])

  useEffect(() => {
    if (subTab === 'structure' && selectedProjectId) {
      setRepoTree([])
      setRepoPath('')
      setRepoHistory([])
      void loadRepoTree(selectedProjectId, '')
    }
  }, [subTab, selectedProjectId, loadRepoTree])

  useEffect(() => {
    if (subTab === 'analyzer' && selectedProjectId) {
      void loadAnalysis(selectedProjectId)
    }
  }, [subTab, selectedProjectId, loadAnalysis])

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

  if (!selectedProjectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <FolderGit2 size={28} className="mb-3 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-500 dark:text-gray-400">Select a project to browse its repository</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft">
      {/* Sub-tabs */}
      <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 dark:border-gray-700 px-4 py-2">
        {([
          { id: 'parallel' as SubTab, label: '3-Panel', icon: Columns3 },
          { id: 'compare' as SubTab, label: 'Compare', icon: GitCompare },
          { id: 'editor' as SubTab, label: 'Editor', icon: FileCode2 },
          { id: 'scripts' as SubTab, label: 'Scripts', icon: Terminal },
          { id: 'publish' as SubTab, label: 'Publish', icon: GitPullRequest },
          { id: 'structure' as SubTab, label: 'Structure', icon: FolderOpen },
          { id: 'analyzer' as SubTab, label: 'Analyzer', icon: Zap },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              subTab === t.id
                ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700/50'
            }`}
          >
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden p-5">
        {subTab === 'parallel' ? (
          <ParallelRepoView key={selectedProjectId} projectId={selectedProjectId} />
        ) : subTab === 'compare' ? (
          <CompareView projectId={selectedProjectId} />
        ) : subTab === 'editor' ? (
          <LocalFileEditor projectId={selectedProjectId} />
        ) : subTab === 'scripts' ? (
          <LocalScriptsPanel projectId={selectedProjectId} />
        ) : subTab === 'publish' ? (
          <PublishPanel projectId={selectedProjectId} />
        ) : subTab === 'structure' ? (
          <div className="flex h-full flex-col overflow-y-auto">
            {/* Breadcrumb */}
            <div className="mb-3 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <button
                onClick={() => { setRepoHistory([]); setRepoPath(''); void loadRepoTree(selectedProjectId, '') }}
                className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
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
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                      onClick={() => {
                        const targetPath = arr.slice(0, i + 1).join('/')
                        const newHistory = repoHistory.slice(0, repoHistory.indexOf(targetPath) + 1)
                        setRepoHistory(newHistory)
                        setRepoPath(targetPath)
                        void loadRepoTree(selectedProjectId, targetPath)
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
                      item.type === 'dir' ? 'cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-500/10' : 'cursor-default'
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
                        ? 'text-gray-800 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400'
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
                      <ChevronRight size={12} className="shrink-0 text-gray-400 group-hover:text-blue-500" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
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
                        <div key={fw} className="flex items-center gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2">
                          <span className="h-2 w-2 rounded-full bg-blue-500" />
                          <span className="text-xs font-medium text-blue-700 dark:text-blue-300">{fw}</span>
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

                <button onClick={() => void loadAnalysis(selectedProjectId)} disabled={analyzerLoading}
                  className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-40 transition">
                  {analyzerLoading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Re-analyze
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
