import { create } from 'zustand'
import { apiService, setAccessToken } from '@/services/api'
import type {
  JiraProject,
  Project,
  TestResult,
  TestRun,
  TestRunDetails,
  TestSuite,
  UserResponse,
} from '@/types/domain'

const LAST_ACTIVITY_KEY = 'tm_last_activity_at'

export interface AppiumRunSelection {
  projectId: string
  target: string
  label: string
  appEnv: string
  deviceRunOption: string
}
export interface FrameworkRunSelection {
  projectId: string
  target: string
  label: string
  extraArgs: string
}
// Per-user so a shared browser doesn't leak one user's selection to another.
const SELECTED_PROJECT_KEY_PREFIX = 'atm:selectedProjectId:'

function selectedProjectKey(userId: string | null | undefined): string | null {
  return userId ? `${SELECTED_PROJECT_KEY_PREFIX}${userId}` : null
}

function readStoredProjectId(userId: string | null | undefined): string | null {
  const key = selectedProjectKey(userId)
  if (!key) return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStoredProjectId(userId: string | null | undefined, projectId: string | null) {
  const key = selectedProjectKey(userId)
  if (!key) return
  try {
    if (projectId) localStorage.setItem(key, String(projectId))
    else localStorage.removeItem(key)
  } catch {
    // Ignore storage quota / privacy-mode errors.
  }
}

// Local runs belong to a suite; use the selected one or create a default suite.
async function resolveRunSuiteId(
  selectedSuiteId: string | null,
  suites: TestSuite[],
  projectId: string,
  onCreated: (suite: TestSuite) => void,
): Promise<string> {
  // The store can still hold the previous project's suites right after switching projects;
  // a run filed under another project's suite would execute in that project's checkout.
  const isOwnSuite = (suite: TestSuite) => !suite.id.startsWith('allure-suite-') && String(suite.project_id) === String(projectId)
  let suiteId = suites.some(suite => suite.id === selectedSuiteId && isOwnSuite(suite)) ? selectedSuiteId : null
  if (!suiteId) {
    suiteId = suites.find(isOwnSuite)?.id || null
  }
  if (!suiteId) {
    suiteId = (await apiService.listSuites(projectId)).find(isOwnSuite)?.id || null
  }
  if (!suiteId) {
    // Needs only run.execute: trainees may run tests without managing suites.
    const autoSuite = await apiService.defaultSuite(projectId)
    onCreated(autoSuite)
    suiteId = autoSuite.id
  }
  return suiteId
}

// ─── Derived types ───────────────────────────────────────────────────────────

type CompareStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error' | 'skipped' | 'cancelled' | 'missing'

export interface RunComparisonItem {
  key: string
  testName: string
  className: string | null
  statusA: CompareStatus
  statusB: CompareStatus
  kind: 'regression' | 'fix' | 'changed' | 'added' | 'removed' | 'unchanged'
}

export interface RunComparisonSummary {
  totalCompared: number
  changed: number
  regressions: number
  fixes: number
  added: number
  removed: number
}

export interface FlakyTestInsight {
  key: string
  testName: string
  className: string | null
  executions: number
  passed: number
  failed: number
  instability: number
}

// ─── Store shape ─────────────────────────────────────────────────────────────

interface AppState {
  // Auth
  token: string | null
  user: UserResponse | null
  loading: boolean
  error: string | null

  // Data
  projects: Project[]
  selectedProjectId: string | null
  suites: TestSuite[]
  selectedSuiteId: string | null
  branches: string[]
  collections: string[]
  detectedProjects: string[]
  projectCollections: Record<string, string[]>
  // Project the collections above were loaded for (they lag behind a project switch).
  collectionsProjectId: string | null
  collectionEnvironments: Record<string, string[]>
  runs: TestRun[]
  selectedRunId: string | null
  selectedRunDetails: TestRunDetails | null
  runDetailsLoading: boolean
  expandedResultId: string | null
  runBranch: string
  runProject: string
  runCollection: string
  runEnvironment: string
  // Optional display name for the next run created from the form.
  runName: string
  // Current Appium form selection in Test Run › Local (used by Run and Execute).
  appiumRunSelection: AppiumRunSelection | null
  frameworkRunSelection: FrameworkRunSelection | null
  /** Error from the last run action (start / execute), shown in the run form. */
  runError: string | null

  // Forms
  projectForm: { name: string; git_repo_url: string; description: string; default_branch: string; framework: string }
  suiteForm: { name: string; tags: string }

  // Analytics
  flakyTests: FlakyTestInsight[]
  flakyLoading: boolean
  compareRunAId: string | null
  compareRunBId: string | null
  compareLoading: boolean
  runComparisonSummary: RunComparisonSummary | null
  runComparisonItems: RunComparisonItem[]

  // Connection status (GitHub is per active project; Jira/Confluence are global).
  // Only refreshed on login (loadInitialData) or when a connection is
  // saved/tested/removed in Settings (see notifyConnectionStatusChanged) —
  // never on plain page navigation.
  ghStatus: 'none' | 'ok' | 'error'
  jiraStatus: 'none' | 'ok' | 'error'
  confluenceStatus: 'none' | 'ok' | 'error'
  jiraProjects: JiraProject[]
  activeJiraProjectKey: string
  activeConfluenceProjectLabel: string

  // Actions
  authenticate: (token: string) => void
  logout: () => void
  setUser: (user: UserResponse | null) => void
  setError: (error: string | null) => void
  setSelectedProjectId: (id: string | null) => void
  setSelectedSuiteId: (id: string | null) => void
  setSelectedRunId: (id: string | null) => void
  setExpandedResultId: (id: string | null) => void
  setRunBranch: (branch: string) => void
  setRunProject: (project: string) => void
  setRunCollection: (collection: string) => void
  setRunEnvironment: (environment: string) => void
  setRunName: (name: string) => void
  renameRun: (runId: string, name: string | null) => Promise<void>
  setAppiumRunSelection: (selection: AppiumRunSelection | null) => void
  setFrameworkRunSelection: (selection: FrameworkRunSelection | null) => void
  setProjectForm: (fn: (prev: AppState['projectForm']) => AppState['projectForm']) => void
  setSuiteForm: (fn: (prev: AppState['suiteForm']) => AppState['suiteForm']) => void
  setCompareRunAId: (id: string | null) => void
  setCompareRunBId: (id: string | null) => void

  // Async actions
  loadInitialData: () => Promise<void>
  loadProjectData: (projectId: string) => Promise<void>
  refreshProjectData: (projectId: string) => Promise<void>
  loadRunDetails: (runId: string) => Promise<void>
  createProject: () => Promise<Project | null>
  deleteProject: (projectId: string) => Promise<void>
  createSuite: () => Promise<void>
  createRun: () => Promise<void>
  createAppiumRun: (params: { target: string; label: string; appEnv: string; deviceRunOption: string }) => Promise<void>
  createFrameworkRun: (params: { target: string; label: string; extraArgs: string }) => Promise<void>
  /** Bruno run of only some requests/folders of a collection (e.g. the changed ones). */
  createBrunoSubsetRun: (params: { collection: string; environment: string; requests: string[]; label: string }) => Promise<void>
  executeRun: () => Promise<void>
  cancelRun: (runId: string) => Promise<void>
  deleteRun: (runId: string) => Promise<void>
  computeFlakyTests: () => Promise<void>
  loadComparison: () => Promise<void>
  refreshGithubStatus: (projectId?: string | null) => Promise<void>
  refreshJiraAndConfluenceStatus: () => Promise<void>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildRunComparison(resultsA: TestResult[], resultsB: TestResult[]) {
  const mapA = new Map<string, TestResult>()
  const mapB = new Map<string, TestResult>()
  for (const r of resultsA) mapA.set(`${r.class_name || '__'}::${r.test_name}`, r)
  for (const r of resultsB) mapB.set(`${r.class_name || '__'}::${r.test_name}`, r)

  const allKeys = new Set([...mapA.keys(), ...mapB.keys()])
  const items: RunComparisonItem[] = []

  for (const key of allKeys) {
    const a = mapA.get(key)
    const b = mapB.get(key)
    const statusA: CompareStatus = a?.status || 'missing'
    const statusB: CompareStatus = b?.status || 'missing'
    let kind: RunComparisonItem['kind'] = 'unchanged'
    if (!a && b) kind = 'added'
    else if (a && !b) kind = 'removed'
    else if (statusA === 'passed' && (statusB === 'failed' || statusB === 'error')) kind = 'regression'
    else if ((statusA === 'failed' || statusA === 'error') && statusB === 'passed') kind = 'fix'
    else if (statusA !== statusB) kind = 'changed'
    items.push({ key, testName: b?.test_name || a?.test_name || 'unknown', className: b?.class_name || a?.class_name || null, statusA, statusB, kind })
  }

  const changed = items.filter(i => i.kind !== 'unchanged')
  const summary: RunComparisonSummary = {
    totalCompared: items.length,
    changed: changed.length,
    regressions: changed.filter(i => i.kind === 'regression').length,
    fixes: changed.filter(i => i.kind === 'fix').length,
    added: changed.filter(i => i.kind === 'added').length,
    removed: changed.filter(i => i.kind === 'removed').length,
  }
  const priority: Record<RunComparisonItem['kind'], number> = { regression: 0, fix: 1, changed: 2, added: 3, removed: 4, unchanged: 5 }
  const changedItems = [...changed].sort((a, b) => priority[a.kind] - priority[b.kind] || a.testName.localeCompare(b.testName))
  return { summary, changedItems }
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>((set, get) => ({
  // Auth
  token: localStorage.getItem('tm_access_token') || localStorage.getItem('token'),
  user: null,
  loading: false,
  error: null,

  // Data
  projects: [],
  selectedProjectId: null,
  suites: [],
  selectedSuiteId: null,
  branches: [],
  collections: [],
  detectedProjects: [],
  projectCollections: {},
  collectionsProjectId: null,
  collectionEnvironments: {},
  runs: [],
  selectedRunId: null,
  selectedRunDetails: null,
  runDetailsLoading: false,
  expandedResultId: null,
  runBranch: 'main',
  runProject: '',
  runCollection: '',
  runEnvironment: '',
  runName: '',
  appiumRunSelection: null,
  frameworkRunSelection: null,
  runError: null,

  // Forms
  projectForm: { name: '', git_repo_url: '', description: '', default_branch: 'main', framework: 'pytest' },
  suiteForm: { name: '', tags: '' },

  // Analytics
  flakyTests: [],
  flakyLoading: false,
  compareRunAId: null,
  compareRunBId: null,
  compareLoading: false,
  runComparisonSummary: null,
  runComparisonItems: [],

  // Connection status
  ghStatus: 'none',
  jiraStatus: 'none',
  confluenceStatus: 'none',
  jiraProjects: [],
  activeJiraProjectKey: '',
  activeConfluenceProjectLabel: 'No Confluence project selected',

  // Simple setters
  setUser: (user) => set({ user }),
  setError: (error) => set({ error }),
  setSelectedProjectId: (id) => set({ selectedProjectId: id }),
  setSelectedSuiteId: (id) => set({ selectedSuiteId: id }),
  setSelectedRunId: (id) => set({ selectedRunId: id, expandedResultId: null }),
  setExpandedResultId: (id) => set({ expandedResultId: id }),
  setRunBranch: (branch) => set({ runBranch: branch }),
  setRunProject: (project) => set({ runProject: project }),
  setRunCollection: (collection) => set({ runCollection: collection }),
  setRunEnvironment: (environment) => set({ runEnvironment: environment }),
  setAppiumRunSelection: (selection) => set({ appiumRunSelection: selection }),
  setFrameworkRunSelection: (selection) => set({ frameworkRunSelection: selection }),
  setRunName: (name) => set({ runName: name }),

  renameRun: async (runId, name) => {
    try {
      const updated = await apiService.renameRun(runId, name)
      set(s => ({
        runs: s.runs.map(r => (r.id === runId ? { ...r, name: updated.name ?? null } : r)),
        selectedRunDetails: s.selectedRunDetails?.id === runId
          ? { ...s.selectedRunDetails, name: updated.name ?? null }
          : s.selectedRunDetails,
      }))
    } catch (e) {
      set({ error: apiService.errorMessage(e) })
    }
  },
  setProjectForm: (fn) => set(s => ({ projectForm: fn(s.projectForm) })),
  setSuiteForm: (fn) => set(s => ({ suiteForm: fn(s.suiteForm) })),
  setCompareRunAId: (id) => set({ compareRunAId: id }),
  setCompareRunBId: (id) => set({ compareRunBId: id }),

  authenticate: (token) => {
    localStorage.setItem('tm_access_token', token)
    localStorage.setItem('token', token)
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()))
    setAccessToken(token)
    set({ token })
  },

  logout: () => {
    localStorage.removeItem('tm_access_token')
    localStorage.removeItem('token')
    localStorage.removeItem(LAST_ACTIVITY_KEY)
    setAccessToken(null)
    set({
      token: null, user: null, projects: [], suites: [], runs: [],
      selectedProjectId: null, selectedSuiteId: null, selectedRunId: null,
      selectedRunDetails: null,
      collections: [],
      detectedProjects: [],
      projectCollections: {},
      collectionsProjectId: null,
      collectionEnvironments: {},
      runProject: '',
      runCollection: '',
      runEnvironment: '',
      runName: '',
      appiumRunSelection: null,
  frameworkRunSelection: null,
  runError: null,
      ghStatus: 'none',
      jiraStatus: 'none',
      confluenceStatus: 'none',
      jiraProjects: [],
      activeJiraProjectKey: '',
      activeConfluenceProjectLabel: 'No Confluence project selected',
    })
  },

  loadInitialData: async () => {
    const { token } = get()
    if (!token) return
    setAccessToken(token)
    set({ loading: true, error: null })
    try {
      const u = await apiService.me()
      const ps = await apiService.listProjects().catch(() => [])
      set({ user: u, projects: ps })
      // Keep the current selection if still valid, else restore the user's last
      // selected project (survives browser restarts), else the first project.
      const current = get().selectedProjectId
      const stored = readStoredProjectId(u.id)
      const nextProjectId = [current, stored].find(id => id && ps.some(p => String(p.id) === String(id)))
        ?? (ps[0]?.id ?? null)
      if (nextProjectId !== current) {
        set({ selectedProjectId: nextProjectId })
      }
      void get().refreshJiraAndConfluenceStatus()
      void get().refreshGithubStatus()
    } catch (e) {
      set({ error: apiService.errorMessage(e) })
    } finally {
      set({ loading: false })
    }
  },

  // GitHub is connected per-project (Settings → per-project GitHub PAT). Only
  // called on login or after a Settings save/test/disconnect — never on route
  // navigation — so it always reflects the currently selected project.
  refreshGithubStatus: async (projectId) => {
    const targetId = projectId !== undefined ? projectId : get().selectedProjectId
    if (!targetId) {
      set({ ghStatus: 'none' })
      return
    }
    try {
      const projectGithub = await apiService.getProjectGithub(targetId)
      if (!projectGithub.github_token_set) {
        set({ ghStatus: 'none' })
        return
      }
      set({ ghStatus: 'error' })
      try {
        const result = await apiService.testProjectGithub(targetId)
        set({ ghStatus: result.ok ? 'ok' : 'error' })
      } catch {
        set({ ghStatus: 'error' })
      }
    } catch {
      set({ ghStatus: 'none' })
    }
  },

  refreshJiraAndConfluenceStatus: async () => {
    try {
      const [jiraSettings, confluenceSettings] = await Promise.all([
        apiService.getJiraSettings(),
        apiService.getConfluenceSettings(),
      ])

      const jiraConfigured = jiraSettings.jira_token_set || Boolean(jiraSettings.jira_mcp_base_url)
      const jiraFullyConfigured = jiraSettings.jira_token_set && Boolean(jiraSettings.jira_mcp_base_url)
      const confluenceConfigured = confluenceSettings.confluence_token_set || Boolean(confluenceSettings.confluence_mcp_base_url)
      const confluenceFullyConfigured = confluenceSettings.confluence_token_set && Boolean(confluenceSettings.confluence_mcp_base_url)

      const confSpace = confluenceSettings.confluence_space_key || ''
      const confSpaceName = confluenceSettings.confluence_space_name || ''

      set({
        jiraStatus: jiraConfigured ? 'error' : 'none',
        confluenceStatus: confluenceConfigured ? 'error' : 'none',
        activeJiraProjectKey: jiraSettings.jira_project_key || '',
        activeConfluenceProjectLabel: confSpace
          ? `${confSpace}${confSpaceName ? ` - ${confSpaceName}` : ''}`
          : 'No Confluence project selected',
      })

      if (jiraFullyConfigured) {
        try {
          const jiraConnection = await apiService.testJiraConnection()
          set({ jiraStatus: jiraConnection.ok ? 'ok' : 'error' })
        } catch {
          set({ jiraStatus: 'error' })
        }
        try {
          const items = await apiService.listJiraProjects()
          set({ jiraProjects: items })
        } catch {
          set({ jiraProjects: [] })
        }
      } else {
        set({ jiraProjects: [] })
      }

      if (confluenceFullyConfigured) {
        try {
          const confluenceConnection = await apiService.testConfluenceConnection()
          set({ confluenceStatus: confluenceConnection.ok ? 'ok' : 'error' })
        } catch {
          set({ confluenceStatus: 'error' })
        }
      }
    } catch {
      set({ jiraStatus: 'error', confluenceStatus: 'error', jiraProjects: [] })
    }
  },

  loadProjectData: async (projectId) => {
    const { token } = get()
    if (!token) return
    try {
      const [ss, rs, bs, analysis] = await Promise.all([
        apiService.listSuites(projectId),
        apiService.listRunsByProject(projectId),
        apiService.listBranches(projectId),
        apiService.analyzeLocalProjectRepo(projectId)
          .catch(() => apiService.analyzeProjectRepo(projectId))
          .catch(() => ({ frameworks: [], projects: [], files_count: 0 })),
      ])
      const detectedCollections = analysis.projects.map(p => p.path)
      const projectCollections: Record<string, string[]> = {}
      const collectionEnvironments: Record<string, string[]> = {}
      for (const projectEntry of analysis.projects) {
        const path = projectEntry.path.trim()
        if (!path) continue
        collectionEnvironments[path] = [...new Set(projectEntry.environments || [])].sort((a, b) => a.localeCompare(b))
      }
      for (const path of detectedCollections) {
        const normalized = path.trim()
        if (!normalized) continue
        const projectName = normalized.includes('/') ? normalized.split('/')[0] : normalized
        if (!projectCollections[projectName]) projectCollections[projectName] = []
        projectCollections[projectName].push(normalized)
      }
      const detectedProjects = Object.keys(projectCollections).sort((a, b) => a.localeCompare(b))
      for (const key of detectedProjects) {
        projectCollections[key] = [...new Set(projectCollections[key])].sort((a, b) => a.localeCompare(b))
      }

      const currentRunProject = get().runProject
      const runProject = detectedProjects.includes(currentRunProject) ? currentRunProject : (detectedProjects[0] || '')
      const filteredCollections = runProject ? (projectCollections[runProject] || []) : detectedCollections
      const currentRunCollection = get().runCollection
      const runCollection = filteredCollections.includes(currentRunCollection)
        ? currentRunCollection
        : (filteredCollections[0] || '')
      const availableEnvironments = runCollection ? (collectionEnvironments[runCollection] || []) : []
      const currentRunEnvironment = get().runEnvironment
      const runEnvironment = availableEnvironments.includes(currentRunEnvironment)
        ? currentRunEnvironment
        : (availableEnvironments[0] || '')

      set({
        suites: ss,
        runs: rs,
        branches: bs.map(b => b.name),
        collections: detectedCollections,
        detectedProjects,
        projectCollections,
        collectionsProjectId: projectId,
        collectionEnvironments,
        runProject,
        runCollection,
        runEnvironment,
      })
      if (ss.length > 0) set(s => ({ selectedSuiteId: s.selectedSuiteId || ss[0].id }))
      if (rs.length === 0) {
        set({ selectedRunId: null, selectedRunDetails: null })
      } else {
        set(s => ({ selectedRunId: (s.selectedRunId && rs.some(r => r.id === s.selectedRunId)) ? s.selectedRunId : rs[0].id }))
      }
      // Init comparison run IDs
      const sorted = [...rs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      if (sorted.length > 0) {
        set(s => ({
          compareRunAId: s.compareRunAId || sorted[0].id,
          compareRunBId: s.compareRunBId || sorted[1]?.id || sorted[0].id,
        }))
      }
    } catch (e) {
      set({ error: apiService.errorMessage(e) })
    }
  },

  refreshProjectData: async (projectId) => {
    const [ss, rs] = await Promise.all([apiService.listSuites(projectId), apiService.listRunsByProject(projectId)])
    set({ suites: ss, runs: rs })
    if (ss.length > 0) set({ selectedSuiteId: ss[0].id })
    if (rs.length === 0) { set({ selectedRunId: null, selectedRunDetails: null }); return }
    set(s => ({ selectedRunId: (s.selectedRunId && rs.some(r => r.id === s.selectedRunId)) ? s.selectedRunId : rs[0].id }))
  },

  loadRunDetails: async (runId) => {
    set({ runDetailsLoading: true, expandedResultId: null })
    try {
      const d = await apiService.getRunDetails(runId)
      set(s => ({
        selectedRunDetails: d,
        runs: s.runs.map(r => r.id === d.id ? {
          ...r, status: d.status, started_at: d.started_at, finished_at: d.finished_at,
          total_tests: d.total_tests, passed_tests: d.passed_tests,
          failed_tests: d.failed_tests, skipped_tests: d.skipped_tests,
        } : r),
      }))
    } catch (e) {
      set({ error: apiService.errorMessage(e) })
    } finally {
      set({ runDetailsLoading: false })
    }
  },

  createProject: async () => {
    const { projectForm } = get()
    set({ error: null })
    try {
      // Only name and description are asked for; the repository is connected
      // afterwards in Settings › Project GitHub.
      const p = await apiService.createProject({
        name: projectForm.name.trim(),
        description: projectForm.description.trim() || undefined,
        git_repo_url: projectForm.git_repo_url.trim() || undefined,
      })
      set(s => ({
        projects: [p, ...s.projects],
        selectedProjectId: p.id,
        projectForm: { name: '', git_repo_url: '', description: '', default_branch: 'main', framework: 'pytest' },
      }))
      // Best-effort: sync the local working copy, then install framework/workflow
      // dependencies in order so the project can be run locally right away.
      if (p.git_repo_url) {
        void (async () => {
          try {
            await apiService.syncLocalRepo(p.id)
            await apiService.installSetupPlan(p.id)
          } catch {
            // Ignored — the user can install manually from the Library page.
          }
        })()
      }
      return p
    } catch (e) {
      set({ error: apiService.errorMessage(e) })
      return null
    }
  },

  deleteProject: async (projectId) => {
    try {
      await apiService.deleteProject(projectId)
      set(s => {
        const remaining = s.projects.filter(p => p.id !== projectId)
        const nextId = s.selectedProjectId === projectId ? (remaining[0]?.id ?? null) : s.selectedProjectId
        return {
          projects: remaining,
          selectedProjectId: nextId,
          suites: s.selectedProjectId === projectId ? [] : s.suites,
          runs: s.selectedProjectId === projectId ? [] : s.runs,
          selectedSuiteId: s.selectedProjectId === projectId ? null : s.selectedSuiteId,
          selectedRunId: s.selectedProjectId === projectId ? null : s.selectedRunId,
          selectedRunDetails: s.selectedProjectId === projectId ? null : s.selectedRunDetails,
        }
      })
    } catch (e) {
      set({ error: apiService.errorMessage(e) })
    }
  },

  createSuite: async () => {
    const { selectedProjectId, suiteForm } = get()
    if (!selectedProjectId) return
    try {
      const tags = suiteForm.tags.split(',').map(t => t.trim()).filter(Boolean)
      const s = await apiService.createSuite(selectedProjectId, { name: suiteForm.name, tags })
      set(prev => ({
        suites: [s, ...prev.suites],
        selectedSuiteId: s.id,
        suiteForm: { name: '', tags: '' },
      }))
    } catch (e) {
      set({ error: apiService.errorMessage(e) })
    }
  },


  createRun: async () => {
    set({ error: null, runError: null })
    const {
      selectedSuiteId,
      suites,
      user,
      runBranch,
      projects,
      selectedProjectId,
      runProject,
      runCollection,
      runEnvironment,
    } = get()
    if (!selectedProjectId || !user?.email) {
      set({ error: 'Select a project and make sure you are signed in.' })
      return
    }

    const project = projects.find(p => p.id === selectedProjectId)
    try {
      const suiteIdToUse = await resolveRunSuiteId(selectedSuiteId, suites, selectedProjectId, autoSuite => set(s => ({
        suites: [autoSuite, ...s.suites],
        selectedSuiteId: autoSuite.id,
      })))
      const r = await apiService.createRun({
        suite_id: suiteIdToUse,
        branch: runBranch || project?.default_branch || 'main',
        triggered_by: user.email,
        collection: runCollection || undefined,
        name: get().runName.trim() || undefined,
      })
      set(s => ({ runs: [r, ...s.runs], selectedRunId: r.id, runName: '' }))
      await apiService.executeRun(r.id, {
        run_project: runProject || undefined,
        run_collection: runCollection || undefined,
        run_environment: runEnvironment || undefined,
      })
      if (selectedProjectId) await get().refreshProjectData(selectedProjectId)
    } catch (e) {
      const message = apiService.errorMessage(e)
      set({ error: message, runError: message })
    }
  },

  createAppiumRun: async ({ target, label, appEnv, deviceRunOption }) => {
    set({ error: null, runError: null })
    const { selectedSuiteId, suites, user, runBranch, projects, selectedProjectId } = get()
    if (!selectedProjectId || !user?.email) {
      set({ error: 'Select a project and make sure you are signed in.' })
      return
    }
    const project = projects.find(p => p.id === selectedProjectId)
    try {
      const suiteId = await resolveRunSuiteId(selectedSuiteId, suites, selectedProjectId, autoSuite => set(s => ({
        suites: [autoSuite, ...s.suites],
        selectedSuiteId: autoSuite.id,
      })))
      const r = await apiService.createRun({
        suite_id: suiteId,
        branch: runBranch || project?.default_branch || 'main',
        triggered_by: user.email,
        collection: label,
        name: get().runName.trim() || undefined,
      })
      set(s => ({ runs: [r, ...s.runs], selectedRunId: r.id, runName: '' }))
      await apiService.executeRun(r.id, {
        run_type: 'appium',
        appium_target: target,
        app_env: appEnv,
        device_run_option: deviceRunOption,
      })
      await get().refreshProjectData(selectedProjectId)
    } catch (e) {
      const message = apiService.errorMessage(e)
      set({ error: message, runError: message })
    }
  },

  createFrameworkRun: async ({ target, label, extraArgs }) => {
    set({ error: null, runError: null })
    const { selectedSuiteId, suites, user, runBranch, projects, selectedProjectId } = get()
    if (!selectedProjectId || !user?.email) {
      set({ error: 'Select a project and make sure you are signed in.' })
      return
    }
    const project = projects.find(p => p.id === selectedProjectId)
    try {
      const suiteId = await resolveRunSuiteId(selectedSuiteId, suites, selectedProjectId, autoSuite => set(s => ({
        suites: [autoSuite, ...s.suites],
        selectedSuiteId: autoSuite.id,
      })))
      const r = await apiService.createRun({
        suite_id: suiteId,
        branch: runBranch || project?.default_branch || 'main',
        triggered_by: user.email,
        collection: label,
        name: get().runName.trim() || undefined,
      })
      set(s => ({ runs: [r, ...s.runs], selectedRunId: r.id, runName: '' }))
      await apiService.executeRun(r.id, {
        run_type: 'framework',
        framework_target: target,
        extra_args: extraArgs.trim() || undefined,
      })
      await get().refreshProjectData(selectedProjectId)
    } catch (e) {
      const message = apiService.errorMessage(e)
      set({ error: message, runError: message })
    }
  },

  createBrunoSubsetRun: async ({ collection, environment, requests, label }) => {
    set({ error: null, runError: null })
    const { selectedSuiteId, suites, user, runBranch, projects, selectedProjectId } = get()
    if (!selectedProjectId || !user?.email) {
      set({ error: 'Select a project and make sure you are signed in.' })
      return
    }
    const project = projects.find(p => p.id === selectedProjectId)
    try {
      const suiteId = await resolveRunSuiteId(selectedSuiteId, suites, selectedProjectId, autoSuite => set(s => ({
        suites: [autoSuite, ...s.suites],
        selectedSuiteId: autoSuite.id,
      })))
      const r = await apiService.createRun({
        suite_id: suiteId,
        branch: runBranch || project?.default_branch || 'main',
        triggered_by: user.email,
        collection,
        name: get().runName.trim() || label,
      })
      set(s => ({ runs: [r, ...s.runs], selectedRunId: r.id, runName: '' }))
      await apiService.executeRun(r.id, { run_collection: collection, run_environment: environment, run_requests: requests })
      await get().refreshProjectData(selectedProjectId)
    } catch (e) {
      const message = apiService.errorMessage(e)
      set({ error: message, runError: message })
    }
  },

  executeRun: async () => {
    set({ error: null, runError: null })
    const {
      selectedRunId, selectedProjectId, runProject, runCollection, runEnvironment, appiumRunSelection,
      frameworkRunSelection,
    } = get()
    if (!selectedRunId || !selectedProjectId) return
    // Like Bruno, Execute uses what is currently selected in the form.
    const appium = appiumRunSelection?.projectId === selectedProjectId && appiumRunSelection.target
      ? appiumRunSelection
      : null
    const framework = frameworkRunSelection?.projectId === selectedProjectId && frameworkRunSelection.target
      ? frameworkRunSelection
      : null
    try {
      await apiService.executeRun(selectedRunId, framework
        ? {
            run_type: 'framework',
            framework_target: framework.target,
            extra_args: framework.extraArgs.trim() || undefined,
          }
        : appium
        ? {
            run_type: 'appium',
            appium_target: appium.target,
            app_env: appium.appEnv || undefined,
            device_run_option: appium.deviceRunOption || undefined,
          }
        : {
            run_project: runProject || undefined,
            run_collection: runCollection || undefined,
            run_environment: runEnvironment || undefined,
          })
      await get().refreshProjectData(selectedProjectId)
      const d = await apiService.getRunDetails(selectedRunId)
      set({ selectedRunDetails: d })
    } catch (e) {
      const message = apiService.errorMessage(e)
      set({ error: message, runError: message })
    }
  },

  cancelRun: async (runId) => {
    const { selectedProjectId } = get()
    try {
      await apiService.cancelRun(runId)
      set(s => ({
        runs: s.runs.map(r => r.id === runId ? { ...r, status: 'cancelled' as const } : r),
        selectedRunDetails: s.selectedRunDetails?.id === runId
          ? { ...s.selectedRunDetails, status: 'cancelled' as const }
          : s.selectedRunDetails,
      }))
      if (selectedProjectId) await get().refreshProjectData(selectedProjectId)
    } catch (e) {
      set({ error: apiService.errorMessage(e) })
    }
  },

  deleteRun: async (runId) => {
    const { selectedProjectId } = get()
    try {
      await apiService.deleteRun(runId)
      set(s => {
        const remaining = s.runs.filter(r => r.id !== runId)
        return {
          runs: remaining,
          selectedRunId: s.selectedRunId === runId ? (remaining[0]?.id ?? null) : s.selectedRunId,
          selectedRunDetails: s.selectedRunDetails?.id === runId ? null : s.selectedRunDetails,
        }
      })
      if (selectedProjectId) await get().refreshProjectData(selectedProjectId)
    } catch (e) {
      set({ error: apiService.errorMessage(e) })
    }
  },

  computeFlakyTests: async () => {
    const { runs } = get()
    if (runs.length === 0) { set({ flakyTests: [] }); return }
    set({ flakyLoading: true })
    try {
      const recent = [...runs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 20)
      const results = await Promise.allSettled(recent.map(r => apiService.getRunDetails(r.id)))
      const agg = new Map<string, FlakyTestInsight>()
      for (const res of results) {
        if (res.status !== 'fulfilled') continue
        for (const tr of res.value.results) {
          const key = `${tr.class_name || '__'}::${tr.test_name}`
          const ex = agg.get(key) || { key, testName: tr.test_name, className: tr.class_name, executions: 0, passed: 0, failed: 0, instability: 0 }
          ex.executions++
          if (tr.status === 'passed') ex.passed++
          if (tr.status === 'failed' || tr.status === 'error') ex.failed++
          agg.set(key, ex)
        }
      }
      const computed = Array.from(agg.values())
        .filter(i => i.passed > 0 && i.failed > 0)
        .map(i => ({ ...i, instability: Number(((Math.min(i.passed, i.failed) / (i.passed + i.failed)) * 100).toFixed(2)) }))
        .sort((a, b) => b.instability - a.instability || b.executions - a.executions)
        .slice(0, 8)
      set({ flakyTests: computed })
    } finally {
      set({ flakyLoading: false })
    }
  },

  loadComparison: async () => {
    const { compareRunAId, compareRunBId } = get()
    if (!compareRunAId || !compareRunBId || compareRunAId === compareRunBId) {
      set({ runComparisonSummary: null, runComparisonItems: [] })
      return
    }
    set({ compareLoading: true })
    try {
      const [a, b] = await Promise.all([apiService.getRunDetails(compareRunAId), apiService.getRunDetails(compareRunBId)])
      const cmp = buildRunComparison(a.results, b.results)
      set({ runComparisonSummary: cmp.summary, runComparisonItems: cmp.changedItems })
    } catch (e) {
      set({ error: apiService.errorMessage(e), runComparisonSummary: null, runComparisonItems: [] })
    } finally {
      set({ compareLoading: false })
    }
  },
}))

// Persist every project switch (selector, create, delete) for the signed-in user.
useAppStore.subscribe((state, prev) => {
  if (state.selectedProjectId === prev.selectedProjectId || !state.user) return
  writeStoredProjectId(state.user.id, state.selectedProjectId)
})
