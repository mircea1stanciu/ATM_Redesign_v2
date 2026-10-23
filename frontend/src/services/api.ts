import axios from 'axios'
import type {
  Branch,
  ExecuteRunResponse,
  GitHubCommitInfo,
  GitHubTemplates,
  GitHubTreeItem,
  JiraProject,
  AppiumProjectAnalysis,
  PropertiesFileSummary,
  ProjectGithubOverview,
  LocalFolderInspection,
  ScaffoldCatalog,
  FrameworkDetection,
  AiSettings,
  MicrosoftSignIn,
  StationIde,
  AiProjectAnalysis,
  AiConversationSummary,
  AiConversation,
  AiStreamEvent,
  ScaffoldInfo,
  ScaffoldVerifyJob,
  PropertiesFileView,
  MobileDevicesResponse,
  MobilePlatform,
  ConfluenceSpace,
  ConfluencePageItem,
  ConfluenceReleasePage,
  ReleaseAnalysisResponse,
  LibraryManifest,
  LibraryInstallResult,
  SetupPlan,
  SetupInstallResult,
  LocalRepoStatus,
  LocalChanges,
  RepoCompareResult,
  LocalScript,
  LocalScriptRunResult,
  LocalFileContent,
  WorkflowDispatchResult,
  WorkflowRunsSyncResult,
  GitHubRun,
  LocalPushResult,
  PullRequestResult,
  AllureReport,
  Project,
  Task,
  TestRun,
  TestRunDetails,
  TestSuite,
  TokenResponse,
  UserResponse,
  ForumPost,
  ForumPostList,
  ForumComment,
  ForumAttachment,
  ForumReactionResponse,
} from '@/types/domain'

const AUTH_EXPIRED_EVENT = 'atm:auth-expired'

function notifyAuthExpired(reason: 'unauthorized' | 'session_expired' = 'unauthorized') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { reason } }))
}

// Fired whenever a GitHub/Jira/Confluence connection is saved, tested or
// disconnected from the Settings page, so other parts of the app (e.g. the
// top nav connection badges) can refresh without polling on every render.
export const CONNECTION_STATUS_CHANGED_EVENT = 'atm:connection-status-changed'
export const LOCAL_REPO_CHANGED_EVENT = 'atm:local-repo-changed'

export function notifyConnectionStatusChanged(kind: 'github' | 'jira' | 'confluence') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CONNECTION_STATUS_CHANGED_EVENT, { detail: { kind } }))
}

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

api.interceptors.response.use(
  (response) => {
    // Linking, importing, creating or removing a project's local copy changes what "Open in IDE" opens.
    const method = (response.config.method || 'get').toLowerCase()
    const match = /\/projects\/([^/]+)\/(?:local(?:\/(?:config|import|link-existing))?|scaffold)$/.exec(response.config.url || '')
    if (method !== 'get' && match && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(LOCAL_REPO_CHANGED_EVENT, { detail: { projectId: match[1] } }))
    }
    return response
  },
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const requestUrl = error.config?.url || ''
      const isSessionValidationEndpoint = /(^|\/)me$/.test(requestUrl)
      if (isSessionValidationEndpoint) {
        notifyAuthExpired('unauthorized')
      }
    }
    return Promise.reject(error)
  },
)

// Ensure authenticated calls work even right after page refresh,
// before store hydration effects run.
const initialToken = typeof window !== 'undefined'
  ? (localStorage.getItem('tm_access_token') || localStorage.getItem('token'))
  : null
if (initialToken) {
  api.defaults.headers.common.Authorization = `Bearer ${initialToken}`
}

export function setAccessToken(token: string | null) {
  if (token) {
    // Keep both keys in sync while legacy screens still read `token`.
    if (typeof window !== 'undefined') {
      localStorage.setItem('tm_access_token', token)
      localStorage.setItem('token', token)
    }
    api.defaults.headers.common.Authorization = `Bearer ${token}`
  } else {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('tm_access_token')
      localStorage.removeItem('token')
    }
    delete api.defaults.headers.common.Authorization
  }
}

function extractErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    if (error instanceof Error && error.message) {
      return error.message
    }
    return 'Unexpected error occurred.'
  }
  const detail = error.response?.data?.detail
  if (typeof detail === 'string') {
    return detail
  }
  return error.message || 'Request failed.'
}

export interface UserUpdatePayload {
  email?: string
  full_name?: string
  password?: string
  role?: string
  scope_tag?: string | null
  assigned_lead_id?: string | null
  project_ids?: string[]
  is_active?: boolean
}

export interface UserCreatePayload extends UserUpdatePayload {
  email: string
  password: string
  full_name: string
}

// The backend takes numeric ids; the UI keeps them as strings.
function toUserPayload(data: UserUpdatePayload): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...data }
  if ('assigned_lead_id' in data) payload.assigned_lead_id = data.assigned_lead_id ? Number(data.assigned_lead_id) : null
  if (data.project_ids) payload.project_ids = data.project_ids.map(Number)
  return payload
}

function normalizeUserResponse(user: any): UserResponse {
  return {
    ...user,
    id: String(user?.id ?? ''),
    assigned_lead_id: user?.assigned_lead_id != null ? String(user.assigned_lead_id) : null,
  }
}

export const apiService = {
  async login(email: string, password: string): Promise<TokenResponse> {
    const response = await api.post<TokenResponse>('/auth/login', {
      username: email,
      password,
    })
    return response.data
  },

  async register(email: string, password: string, fullName: string): Promise<TokenResponse> {
    const response = await api.post<TokenResponse>('/auth/register', {
      username: email,
      email,
      password,
      full_name: fullName,
    })
    return response.data
  },

  async me(): Promise<UserResponse> {
    const response = await api.get<UserResponse>('/me')
    return normalizeUserResponse(response.data)
  },

  async listProjects(): Promise<Project[]> {
    const response = await api.get<Project[]>('/projects/')
    return response.data
  },

  async createProject(payload: { name: string; description?: string; git_repo_url?: string }): Promise<Project> {
    const response = await api.post<Project>('/projects/', payload)
    return response.data
  },

  async deleteProject(projectId: string): Promise<void> {
    await api.delete(`/projects/${projectId}`)
  },

  async listBranches(projectId: string): Promise<Branch[]> {
    const response = await api.get<Branch[]>(`/projects/${projectId}/branches`)
    return response.data
  },

  async listSuites(projectId: string): Promise<TestSuite[]> {
    const response = await api.get<TestSuite[]>(`/suites/projects/${projectId}`)
    return response.data
  },

  async createSuite(projectId: string, payload: { name: string; tags?: string[] }): Promise<TestSuite> {
    const response = await api.post<TestSuite>(`/suites/projects/${projectId}/suites`, {
      active: true,
      ...payload,
    })
    return response.data
  },

  async listRunsByProject(projectId: string): Promise<TestRun[]> {
    const response = await api.get<TestRun[]>(`/runs/projects/${projectId}`)
    return response.data
  },

  async createRun(payload: {
    suite_id: string
    branch?: string
    commit_sha?: string
    triggered_by?: string
    collection?: string
    name?: string
  }): Promise<TestRun> {
    const response = await api.post<TestRun>('/runs', payload)
    return response.data
  },

  async renameRun(runId: string, name: string | null): Promise<TestRun> {
    const response = await api.patch<TestRun>(`/runs/${runId}`, { name })
    return response.data
  },

  async executeRun(
    runId: string,
    payload?: {
      run_project?: string
      run_collection?: string
      run_environment?: string
      run_type?: 'appium' | 'framework'
      appium_target?: string
      app_env?: string
      device_run_option?: string
      framework_target?: string
      extra_args?: string
      run_requests?: string[]
    },
  ): Promise<ExecuteRunResponse> {
    const response = await api.post<ExecuteRunResponse>(`/runs/${runId}/execute`, payload || {})
    return response.data
  },

  async cancelRun(runId: string): Promise<void> {
    await api.post(`/runs/${runId}/cancel`)
  },

  async deleteRun(runId: string): Promise<void> {
    await api.delete(`/runs/${runId}`)
  },

  async getRunDetails(runId: string): Promise<TestRunDetails> {
    const response = await api.get<TestRunDetails>(`/runs/${runId}`)
    return response.data
  },

  async getRunReportFile(runId: string, file: string): Promise<Blob> {
    const response = await api.get(`/runs/${runId}/reports/${encodeURIComponent(file)}`, { responseType: 'blob' })
    return response.data
  },

  async getAllureReport(runId: string): Promise<Blob> {
    const response = await api.get(`/runs/${runId}/allure-report`, { responseType: 'blob' })
    return response.data
  },

  async getImportedAllureReport(projectId: string, reportId: number): Promise<Blob> {
    const response = await api.get(`/projects/${projectId}/allure/reports/${reportId}/html`, { responseType: 'blob' })
    return response.data
  },

  // User management: role, scope tag, lead and projects.
  async listUsers(): Promise<UserResponse[]> {
    const response = await api.get<any[]>('/users')
    return response.data.map(normalizeUserResponse)
  },

  async createUser(payload: UserCreatePayload): Promise<UserResponse> {
    const response = await api.post<any>('/users', toUserPayload(payload))
    return normalizeUserResponse(response.data)
  },

  async updateUser(userId: string, data: UserUpdatePayload): Promise<UserResponse> {
    const response = await api.patch<any>(`/users/${userId}`, toUserPayload(data))
    return normalizeUserResponse(response.data)
  },

  async deleteUser(userId: string): Promise<void> {
    await api.delete(`/users/${userId}`)
  },

  // Admin: settings
  async getSettings(): Promise<{ github_token_set: boolean; github_token_preview: string; github_mcp_base_url: string }> {
    const response = await api.get('/settings')
    return response.data
  },

  async saveGithubSettings(payload: { github_token?: string; github_mcp_base_url?: string }): Promise<{ github_token_set: boolean; github_token_preview: string; github_mcp_base_url: string }> {
    const response = await api.patch('/settings/github', payload)
    return response.data
  },

  async testGithubConnection(): Promise<{ ok: boolean; login?: string; name?: string; plan?: string; error?: string }> {
    const response = await api.post('/settings/github/test')
    return response.data
  },

  async getRequirementsFilters(): Promise<{
    epic_status_view: { search: string; status: string; team: string }
    automation_status_management: { search: string; filter: string; team: string }
  }> {
    const response = await api.get('/settings/requirements-filters')
    return response.data
  },

  async saveRequirementsFilters(payload: {
    epic_status_view?: { search: string; status: string; team: string }
    automation_status_management?: { search: string; filter: string; team: string }
  }): Promise<{
    epic_status_view: { search: string; status: string; team: string }
    automation_status_management: { search: string; filter: string; team: string }
  }> {
    const response = await api.put('/settings/requirements-filters', payload)
    return response.data
  },

  async getJiraSettings(): Promise<{ jira_token_set: boolean; jira_token_preview: string; jira_mcp_base_url: string; jira_project_key?: string | null; jira_project_name?: string | null }> {
    const response = await api.get('/settings/jira')
    return response.data
  },

  async saveJiraSettings(payload: { jira_token?: string; jira_mcp_base_url?: string; jira_project_key?: string; jira_project_name?: string }): Promise<{ jira_token_set: boolean; jira_token_preview: string; jira_mcp_base_url: string; jira_project_key?: string | null; jira_project_name?: string | null }> {
    const response = await api.patch('/settings/jira', payload)
    return response.data
  },

  async testJiraConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
    const response = await api.post('/settings/jira/test')
    return response.data
  },

  async listJiraProjects(): Promise<JiraProject[]> {
    const response = await api.get<{ projects: JiraProject[] }>('/settings/jira/projects')
    return response.data.projects
  },

  async getJiraCreateMeta(projectKey?: string): Promise<{ project_key: string; issue_types: { id: string; name: string }[] }> {
    const response = await api.get('/settings/jira/create-meta', {
      params: projectKey ? { project_key: projectKey } : undefined,
    })
    return response.data
  },

  async createJiraTicket(payload: {
    project_key?: string
    issue_type: string
    source_issue_key?: string
    issue_link_type?: string
    summary: string
    description?: string
    priority?: string
    components?: string
    team_name?: string
    epic_link?: string
  }): Promise<{ key: string; url: string; linked_source?: boolean }> {
    const response = await api.post('/settings/jira/create-issue', payload)
    return response.data
  },

  async getConfluenceSettings(): Promise<{
    confluence_token_set: boolean
    confluence_token_preview: string
    confluence_mcp_base_url: string
    confluence_space_key?: string | null
    confluence_space_name?: string | null
    confluence_release_container_id?: string | null
    confluence_release_container_title?: string | null
    confluence_release_container_url?: string | null
    confluence_selected_release_page_id?: string | null
    confluence_selected_release_page_title?: string | null
    confluence_selected_release_page_url?: string | null
  }> {
    const response = await api.get('/settings/confluence')
    return response.data
  },

  async saveConfluenceSettings(payload: {
    confluence_token?: string
    confluence_mcp_base_url?: string
    confluence_space_key?: string
    confluence_space_name?: string
    confluence_release_container_id?: string
    confluence_release_container_title?: string
    confluence_release_container_url?: string
    confluence_selected_release_page_id?: string
    confluence_selected_release_page_title?: string
    confluence_selected_release_page_url?: string
  }): Promise<{
    confluence_token_set: boolean
    confluence_token_preview: string
    confluence_mcp_base_url: string
    confluence_space_key?: string | null
    confluence_space_name?: string | null
    confluence_release_container_id?: string | null
    confluence_release_container_title?: string | null
    confluence_release_container_url?: string | null
    confluence_selected_release_page_id?: string | null
    confluence_selected_release_page_title?: string | null
    confluence_selected_release_page_url?: string | null
  }> {
    const response = await api.patch('/settings/confluence', payload)
    return response.data
  },

  async testConfluenceConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
    const response = await api.post('/settings/confluence/test')
    return response.data
  },

  async listConfluenceSpaces(): Promise<ConfluenceSpace[]> {
    const response = await api.get<{ spaces: ConfluenceSpace[] }>('/settings/confluence/spaces')
    return response.data.spaces
  },

  async listConfluenceReleases(): Promise<ConfluenceReleasePage[]> {
    const response = await api.get<{ pages: ConfluenceReleasePage[] }>('/settings/confluence/releases')
    return response.data.pages
  },

  async searchConfluenceReleaseContainers(query: string): Promise<ConfluencePageItem[]> {
    const response = await api.get<{ pages: ConfluencePageItem[] }>('/settings/confluence/release-containers/search', {
      params: { q: query },
    })
    return response.data.pages
  },

  async listConfluenceReleasePages(containerId?: string): Promise<ConfluencePageItem[]> {
    const response = await api.get<{ pages: ConfluencePageItem[] }>('/settings/confluence/release-pages', {
      params: containerId ? { container_id: containerId } : undefined,
    })
    return response.data.pages
  },

  async analyzeConfluenceReleasePage(pageId?: string): Promise<ReleaseAnalysisResponse> {
    const response = await api.get<ReleaseAnalysisResponse>('/settings/confluence/release-analysis', {
      params: pageId ? { page_id: pageId } : undefined,
    })
    return response.data
  },

  // Zephyr (Test Manager) settings
  async getZephyrSettings(): Promise<{ zephyr_project_key: string; zephyr_selected_folder_id: string }> {
    const response = await api.get('/settings/zephyr')
    return response.data
  },

  async saveZephyrSettings(payload: { zephyr_project_key?: string; zephyr_selected_folder_id?: string }): Promise<{ zephyr_project_key: string; zephyr_selected_folder_id: string }> {
    const response = await api.patch('/settings/zephyr', payload)
    return response.data
  },

  async listZephyrCycles(projectKey: string): Promise<{ project_key: string; cycles: Array<{ id: string; name: string; description?: string; created?: string; updated?: string; folder?: string }>; total: number }> {
    const response = await api.get(`/settings/zephyr/cycles/${projectKey}`)
    return response.data
  },

  // Zephyr Automation Planner — Jira Management sub-tab
  // Folders/cases can take longer than the default 15s timeout for large
  // projects (full TM4J folder tree, or a folder with thousands of cases
  // paginated 1000/page), so these two calls use a longer, dedicated timeout.
  async listZephyrPlannerFolders(projectKey: string, caseStatus?: string, caseTeam?: string): Promise<{
    project_key: string
    folders: Array<{ id: string; name: string; parent_id?: string | null; kind: string; count?: number }>
    total: number
  }> {
    const response = await api.get(`/zephyr-planner/folders/${projectKey}`, {
      params: {
        ...(caseStatus ? { case_status: caseStatus } : {}),
        ...(caseTeam ? { case_team: caseTeam } : {}),
      },
      timeout: 60000,
    })
    return response.data
  },

  async listZephyrPlannerCases(projectKey: string, folderId?: string, caseStatus?: string, caseTeam?: string): Promise<{
    project_key: string
    folder_id: string | null
    cases: Array<{
      key: string; name: string; status: string; priority: string; folder: string
      story_task_id?: string; story_task_status?: string; story_task_team?: string
      precondition: string; objective: string; source: string
      steps: Array<{ index: number; description: string; test_data: string; expected_result: string }>
    }>
    total: number
  }> {
    const response = await api.get(`/zephyr-planner/cases/${projectKey}`, {
      params: {
        ...(folderId ? { folder_id: folderId } : {}),
        ...(caseStatus ? { case_status: caseStatus } : {}),
        ...(caseTeam ? { case_team: caseTeam } : {}),
      },
      timeout: 60000,
    })
    return response.data
  },

  async listZephyrPlannerStatuses(projectKey: string): Promise<{
    project_key: string
    statuses: Array<{ name: string; color: string; is_default: boolean; is_archived: boolean }>
    total: number
  }> {
    const response = await api.get(`/zephyr-planner/statuses/${projectKey}`)
    return response.data
  },

  async listZephyrPlannerTeams(projectKey: string): Promise<{
    project_key: string
    teams: string[]
    total: number
  }> {
    const response = await api.get(`/zephyr-planner/teams/${projectKey}`)
    return response.data
  },

  async updateZephyrPlannerCaseStatus(projectKey: string, caseKey: string, statusName: string): Promise<{ key: string; status: string }> {
    const response = await api.patch(`/zephyr-planner/cases/${projectKey}/${caseKey}/status`, { status: statusName })
    return response.data
  },

  async listZephyrPlannerTargets(): Promise<{
    projects: Array<{ project_id: string; project_name: string; local_repo_path: string; detected_framework: string }>
    total: number
  }> {
    const response = await api.get('/zephyr-planner/targets')
    return response.data
  },

  async listZephyrPlannerReferenceFolders(params: { projectId?: string; targetPath?: string }): Promise<{
    target_dir: string
    folders: Array<{ id: string; name: string; parent_id?: string | null; bru_count: number; bru_files?: string[] }>
    total: number
  }> {
    const response = await api.get('/zephyr-planner/reference-folders', {
      params: params.targetPath ? { target_path: params.targetPath } : { project_id: params.projectId },
    })
    return response.data
  },

  async getZephyrSessionCookie(): Promise<{ cookie_set: boolean; preview: string }> {
    const response = await api.get('/zephyr-planner/session-cookie')
    return response.data
  },

  async saveZephyrSessionCookie(sessionCookie: string): Promise<{ cookie_set: boolean; preview: string }> {
    const response = await api.patch('/zephyr-planner/session-cookie', { session_cookie: sessionCookie })
    return response.data
  },

  async generateZephyrPlannerAutomation(payload: {
    project_id?: string
    target_path?: string
    framework?: string
    output_subpath?: string
    reference_folder?: string
    cases: Array<{
      key: string
      name?: string
      status?: string
      priority?: string
      folder?: string
      precondition?: string
      objective?: string
      source?: string
      steps: Array<{ index?: number; description?: string; test_data?: string; expected_result?: string }>
    }>
  }): Promise<{
    framework: string
    target_dir: string
    output_dir: string
    created_files: string[]
    skipped_cases: Array<{ key: string; reason: string }>
    warnings: string[]
  }> {
    const response = await api.post('/zephyr-planner/generate', payload)
    return response.data
  },

  // Test Manager — sprint-based test overview (Jira Agile REST API)
  async getTestSprints(projectKey: string, state = 'active'): Promise<{
    project_key: string
    sprints: Array<{
      id: number; name: string; state: string; startDate: string; endDate: string
      boardId: number; boardName: string; totalTests: number; byStatus: Record<string, number>
    }>
    total: number
  }> {
    const response = await api.get(`/test-manager/sprints/${projectKey}`, { params: { state } })
    return response.data
  },

  async getSprintTestIssues(sprintId: number, projectKey: string): Promise<{
    sprint_id: number; project_key: string
    issues: Array<{
      key: string; summary: string; status: string; issueType: string
      assignee: string; components: string[]; updated: string; url: string
    }>
    total: number
  }> {
    const response = await api.get(`/test-manager/sprints/${sprintId}/issues/${projectKey}`)
    return response.data
  },

  // Test Cases (automation tracking)
  async getTestCases(projectKey: string, automationStatus = 'all', search = ''): Promise<{
    project_key: string
    cases: Array<{
      key: string; summary: string; jiraStatus: string; issueType: string
      components: string[]; updated: string; assignee: string; url: string
      automationStatus: 'pending' | 'to_automate' | 'automated' | 'manual'
    }>
    total: number
    total_jira: number
  }> {
    const response = await api.get(`/test-manager/cases/${projectKey}`, {
      params: { automation_status: automationStatus, search },
    })
    return response.data
  },

  async getTestCaseStats(projectKey: string): Promise<{
    project_key: string; total_jira: number; loaded: number
    pending: number; to_automate: number; automated: number; manual: number
  }> {
    const response = await api.get(`/test-manager/cases/${projectKey}/stats`)
    return response.data
  },

  async updateTestCaseAutomation(jiraKey: string, projectKey: string, status: string): Promise<{
    jira_key: string; project_key: string; status: string
  }> {
    const response = await api.patch(`/test-manager/cases/${projectKey}/${jiraKey}/automation`, { status })
    return response.data
  },

  async getEpicStories(projectKey: string, search = '', refresh = false): Promise<{
    project_key: string
    epics: Array<{
      key: string; summary: string; created: string; year: string; team: string; url: string
      stories: Array<{ key: string; summary: string; created: string; team: string; status: string; issueType: string; url: string }>
    }>
    total: number
  }> {
    const response = await api.get(`/test-manager/epics/${projectKey}`, { params: { search, refresh } })
    return response.data
  },

  // Per-project GitHub settings (Automation Lead or Admin)
  async getProjectGithub(projectId: string): Promise<{ github_token_set: boolean; github_token_preview: string; github_repo_url: string }> {
    const response = await api.get(`/projects/${projectId}/github`)
    return response.data
  },

  async saveProjectGithub(projectId: string, payload: { github_token?: string; github_repo_url?: string }): Promise<{ github_token_set: boolean; github_token_preview: string; github_repo_url: string }> {
    const response = await api.patch(`/projects/${projectId}/github`, payload)
    return response.data
  },

  async getProjectGithubOverview(projectId: string, refresh = false): Promise<ProjectGithubOverview> {
    const response = await api.get<ProjectGithubOverview>(`/projects/${projectId}/github/overview`, {
      params: refresh ? { refresh: true } : undefined,
      timeout: 60000,
    })
    return response.data
  },

  async testProjectGithub(projectId: string): Promise<{ ok: boolean; login?: string; name?: string; error?: string }> {
    const response = await api.post(`/projects/${projectId}/github/test`)
    return response.data
  },

  async disconnectProjectGithub(projectId: string): Promise<void> {
    await api.delete(`/projects/${projectId}/github`)
  },

  async analyzeProjectRepo(projectId: string): Promise<{ frameworks: string[]; projects: { path: string; environments: string[] }[]; files_count: number }> {
    const response = await api.get(`/projects/${projectId}/github/analyze`)
    return response.data
  },

  async analyzeLocalProjectRepo(projectId: string): Promise<{ frameworks: string[]; projects: { path: string; environments: string[] }[]; files_count: number }> {
    const response = await api.get(`/projects/${projectId}/local/collections`)
    return response.data
  },

  async listAllureReports(projectId: string): Promise<AllureReport[]> {
    const response = await api.get(`/projects/${projectId}/allure/reports`)
    return response.data
  },

  async importLocalAllureReports(projectId: string): Promise<{ imported: number; created: number; updated: number }> {
    const response = await api.post(`/projects/${projectId}/allure/import/local`)
    return response.data
  },

  async syncGitHubAllureReports(projectId: string): Promise<{ imported: number; created: number; updated: number }> {
    const response = await api.post(`/projects/${projectId}/allure/sync/github`)
    return response.data
  },

  async getProjectRepoTree(projectId: string, path = '', ref = ''): Promise<GitHubTreeItem[]> {
    const response = await api.get(`/projects/${projectId}/github/tree`, { params: { path, ...(ref ? { ref } : {}) } })
    return response.data
  },

  // Local repository (server-side managed working copy)
  async getLocalRepoStatus(projectId: string): Promise<LocalRepoStatus> {
    const response = await api.get(`/projects/${projectId}/local/status`)
    return response.data
  },

  async syncLocalRepo(projectId: string, branch?: string): Promise<LocalRepoStatus> {
    const response = await api.post(`/projects/${projectId}/local/sync`, { branch: branch ?? null })
    return response.data
  },

  /** Local and GitHub branches of the linked checkout (``fetch`` refreshes the GitHub ones first). */
  /** New/modified files of the linked checkout (uncommitted + commits not on ``base``) and their Bruno requests. */
  async getLocalChanges(projectId: string, params: { base?: string; committed?: boolean } = {}): Promise<LocalChanges> {
    const response = await api.get<LocalChanges>(`/projects/${projectId}/local/changes`, {
      params: { base: params.base || undefined, committed: params.committed ?? true }, timeout: 60000,
    })
    return response.data
  },

  async getLocalBranches(projectId: string, fetch = false): Promise<LocalRepoStatus & { remote_branches: string[]; github_connected: boolean; fetch_error: string | null }> {
    const response = await api.get(`/projects/${projectId}/local/branches`, { params: fetch ? { fetch: true } : undefined, timeout: 5 * 60 * 1000 })
    return response.data
  },

  async checkoutLocalRepo(projectId: string, branch: string): Promise<LocalRepoStatus> {
    const response = await api.post(`/projects/${projectId}/local/checkout`, { branch })
    return response.data
  },

  async setLocalRepoConfig(projectId: string, localPath: string | null): Promise<LocalRepoStatus> {
    const response = await api.patch(`/projects/${projectId}/local/config`, { local_repo_path: localPath })
    return response.data
  },

  async importLocalRepo(projectId: string, path: string, branch?: string): Promise<LocalRepoStatus> {
    // Cloning a large repository can take minutes.
    const response = await api.post(`/projects/${projectId}/local/import`, { path, branch: branch ?? null }, { timeout: 15 * 60 * 1000 })
    return response.data
  },

  async linkExistingLocalRepo(projectId: string, path: string, branch?: string): Promise<LocalRepoStatus> {
    const response = await api.post(`/projects/${projectId}/local/link-existing`, { path, branch: branch ?? null }, { timeout: 60000 })
    return response.data
  },

  async getAiSettings(): Promise<AiSettings> {
    const response = await api.get<AiSettings>('/ai/settings')
    return response.data
  },

  async saveAiSettings(payload: { provider: string; api_key?: string; model?: string; endpoint?: string }): Promise<AiSettings> {
    const response = await api.put<AiSettings>('/ai/settings', payload)
    return response.data
  },

  async deleteAiSettings(): Promise<AiSettings> {
    const response = await api.delete<AiSettings>('/ai/settings')
    return response.data
  },

  /** Every model the saved AI connection can use (detected from the provider; cached server-side). */
  async getAiModels(refresh = false): Promise<{ ok: boolean; message: string; models: { id: string; name: string }[] }> {
    const response = await api.get('/ai/models', { params: refresh ? { refresh: true } : undefined, timeout: 60000 })
    return response.data
  },

  /** Switch the saved AI connection to another of its models (checked with the provider). */
  async switchAiModel(model: string): Promise<AiSettings> {
    const response = await api.put<AiSettings>('/ai/settings/model', { model }, { timeout: 60000 })
    return response.data
  },

  async testAiSettings(payload?: { provider: string; api_key?: string; model?: string; endpoint?: string }): Promise<{ ok: boolean; message: string; models: { id: string; name: string }[] }> {
    const response = await api.post('/ai/settings/test', payload ?? null, { timeout: 60000 })
    return response.data
  },

  async listStationIdes(refresh = false): Promise<{ station: string; ides: StationIde[] }> {
    const response = await api.get('/ide/available', { params: refresh ? { refresh: true } : undefined })
    return response.data
  },

  async openInIde(projectId: string, ide: string, path = ''): Promise<{ opened: boolean; ide: string; path: string; absolute_path: string }> {
    const response = await api.post(`/projects/${projectId}/ide/open`, { ide, path }, { timeout: 30000 })
    return response.data
  },

  async startMicrosoftSignIn(payload: { tenant_id: string; client_id: string; time_zone?: string }): Promise<MicrosoftSignIn> {
    const response = await api.post<MicrosoftSignIn>('/ai/microsoft/signin', payload, { timeout: 30000 })
    return response.data
  },

  async pollMicrosoftSignIn(): Promise<{ status: 'pending' | 'slow_down' | 'done' | 'expired' | 'declined' | 'error'; message?: string; settings?: AiSettings }> {
    const response = await api.post('/ai/microsoft/signin/poll', null, { timeout: 30000 })
    return response.data
  },

  /** RBI GenAI LLM Gateway: returns the login URL to open; ATM receives the token on a localhost callback. */
  async startRbiSignIn(environment: string): Promise<{ login_url: string; environment: string; expires_in: number }> {
    const response = await api.post('/ai/rbi/signin', { environment })
    return response.data
  },

  async pollRbiSignIn(): Promise<{ status: 'pending' | 'done' | 'expired' | 'error'; message?: string; settings?: AiSettings }> {
    const response = await api.post('/ai/rbi/signin/poll')
    return response.data
  },

  async cancelRbiSignIn(): Promise<void> {
    await api.post('/ai/rbi/signin/cancel')
  },

  async getAiAnalysis(projectId: string, refresh = false): Promise<AiProjectAnalysis> {
    const response = await api.get<AiProjectAnalysis>(`/projects/${projectId}/ai/analysis`, {
      params: refresh ? { refresh: true } : undefined,
      timeout: 120000,
    })
    return response.data
  },

  async listAiConversations(projectId: string): Promise<AiConversationSummary[]> {
    const response = await api.get<{ conversations: AiConversationSummary[] }>(`/projects/${projectId}/ai/conversations`)
    return response.data.conversations
  },

  async createAiConversation(projectId: string, title?: string): Promise<AiConversation> {
    const response = await api.post<AiConversation>(`/projects/${projectId}/ai/conversations`, { title })
    return response.data
  },

  async getAiConversation(projectId: string, conversationId: string): Promise<AiConversation> {
    const response = await api.get<AiConversation>(`/projects/${projectId}/ai/conversations/${conversationId}`)
    return response.data
  },

  async deleteAiConversation(projectId: string, conversationId: string): Promise<void> {
    await api.delete(`/projects/${projectId}/ai/conversations/${conversationId}`)
  },

  /** Current file content and the assistant's proposal, for the side-by-side review. */
  async getAiChangeContent(projectId: string, conversationId: string, messageId: string, path: string): Promise<{ path: string; state: string; exists: boolean; original: string; proposed: string; current_sha: string | null }> {
    const response = await api.get(`/projects/${projectId}/ai/conversations/${conversationId}/changes/content`, { params: { message_id: messageId, path } })
    return response.data
  },
  async rejectAiChange(projectId: string, conversationId: string, payload: { message_id: string; path: string }): Promise<AiConversation> {
    const response = await api.post<AiConversation>(`/projects/${projectId}/ai/conversations/${conversationId}/changes/reject`, payload)
    return response.data
  },
  async applyAiChange(projectId: string, conversationId: string, payload: { message_id: string; path: string; expected_sha?: string | null; content?: string }): Promise<AiConversation> {
    const response = await api.post<AiConversation>(`/projects/${projectId}/ai/conversations/${conversationId}/changes/apply`, payload)
    return response.data
  },

  async undoAiChange(projectId: string, conversationId: string, payload: { message_id: string; path: string }): Promise<AiConversation> {
    const response = await api.post<AiConversation>(`/projects/${projectId}/ai/conversations/${conversationId}/changes/undo`, payload)
    return response.data
  },

  /** Streams the assistant's answer (NDJSON events). Uses fetch because axios can't stream in the browser. */
  async streamAiMessage(
    projectId: string,
    conversationId: string,
    payload: { content: string; attachments: string[]; run_id?: string | null },
    onEvent: (event: AiStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const token = localStorage.getItem('tm_access_token') || localStorage.getItem('token')
    const response = await fetch(`/api/projects/${projectId}/ai/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
      signal,
    })
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => null)
      const detail = data?.detail
      throw new Error(typeof detail === 'string' ? detail : `Request failed (${response.status})`)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) onEvent(JSON.parse(line) as AiStreamEvent)
        newline = buffer.indexOf('\n')
      }
    }
    if (buffer.trim()) onEvent(JSON.parse(buffer) as AiStreamEvent)
  },

  async getLocalFrameworks(projectId: string, refresh = false): Promise<FrameworkDetection> {
    const response = await api.get<FrameworkDetection>(`/projects/${projectId}/local/frameworks`, {
      params: refresh ? { refresh: true } : undefined,
      timeout: 60000,
    })
    return response.data
  },

  async getScaffoldCatalog(projectId: string): Promise<ScaffoldCatalog> {
    const response = await api.get<ScaffoldCatalog>(`/projects/${projectId}/scaffold/catalog`)
    return response.data
  },

  async getProjectScaffold(projectId: string): Promise<{ scaffold: ScaffoldInfo | null; verify: ScaffoldVerifyJob | null }> {
    const response = await api.get(`/projects/${projectId}/scaffold`)
    return response.data
  },

  async createProjectScaffold(projectId: string, payload: { framework: string; language: string; path: string }): Promise<{ scaffold: ScaffoldInfo; local: LocalRepoStatus }> {
    const response = await api.post(`/projects/${projectId}/scaffold`, payload, { timeout: 60000 })
    return response.data
  },

  async deleteProjectScaffold(projectId: string): Promise<{ deleted: boolean; path: string }> {
    const response = await api.delete(`/projects/${projectId}/scaffold`, { timeout: 60000 })
    return response.data
  },

  async startScaffoldVerify(projectId: string): Promise<ScaffoldVerifyJob> {
    const response = await api.post<ScaffoldVerifyJob>(`/projects/${projectId}/scaffold/verify`)
    return response.data
  },

  async getScaffoldVerify(projectId: string, jobId: string, since = 0): Promise<ScaffoldVerifyJob> {
    const response = await api.get<ScaffoldVerifyJob>(`/projects/${projectId}/scaffold/verify/${jobId}`, { params: { since } })
    return response.data
  },

  async cancelScaffoldVerify(projectId: string, jobId: string): Promise<ScaffoldVerifyJob> {
    const response = await api.post<ScaffoldVerifyJob>(`/projects/${projectId}/scaffold/verify/${jobId}/cancel`)
    return response.data
  },

  async inspectLocalFolder(projectId: string, path: string): Promise<LocalFolderInspection> {
    const response = await api.get(`/projects/${projectId}/local/inspect`, { params: { path } })
    return response.data
  },

  async getGitHubCommit(projectId: string, ref = ''): Promise<GitHubCommitInfo> {
    const response = await api.get(`/projects/${projectId}/github/commit`, { params: ref ? { ref } : {} })
    return response.data
  },

  async getLocalRepoTree(projectId: string, path = ''): Promise<GitHubTreeItem[]> {
    const response = await api.get(`/projects/${projectId}/local/tree`, { params: { path } })
    return response.data
  },

  async compareRepoSources(
    projectId: string,
    base: string,
    head: string,
    fetch = true,
  ): Promise<RepoCompareResult> {
    const response = await api.get(`/projects/${projectId}/local/compare`, {
      params: { base, head, fetch },
    })
    return response.data
  },

  async getProjectTemplates(projectId: string, ref = ''): Promise<GitHubTemplates> {
    const response = await api.get(`/projects/${projectId}/github/templates`, { params: ref ? { ref } : {} })
    return response.data
  },

  async dispatchProjectWorkflow(
    projectId: string,
    payload: { workflow_id: string; ref?: string; inputs?: Record<string, string | boolean>; collection?: string },
  ): Promise<WorkflowDispatchResult> {
    const response = await api.post(`/projects/${projectId}/github/workflows/dispatch`, payload)
    return response.data
  },

  async syncProjectWorkflowRuns(
    projectId: string,
    payload: { workflow_id?: string; collection?: string; branch?: string; limit?: number } = {},
  ): Promise<WorkflowRunsSyncResult> {
    const response = await api.post(`/projects/${projectId}/github/runs/sync`, payload)
    return response.data
  },

  async getProjectWorkflowRuns(
    projectId: string,
    params: { workflow_id?: string; branch?: string; limit?: number } = {},
  ): Promise<GitHubRun[]> {
    const response = await api.get(`/projects/${projectId}/github/runs`, { params })
    return response.data
  },

  async getLocalLibraries(projectId: string): Promise<LibraryManifest[]> {
    const response = await api.get(`/projects/${projectId}/local/libraries`)
    return response.data
  },

  async installLocalLibraries(projectId: string, manifestId: string, timeout?: number): Promise<LibraryInstallResult> {
    const response = await api.post(`/projects/${projectId}/local/libraries/install`, {
      manifest_id: manifestId,
      timeout: timeout ?? null,
    })
    return response.data
  },

  async getSetupPlan(projectId: string): Promise<SetupPlan> {
    const response = await api.get(`/projects/${projectId}/local/setup-plan`)
    return response.data
  },

  async installSetupPlan(projectId: string, timeout?: number): Promise<SetupInstallResult> {
    const response = await api.post(`/projects/${projectId}/local/setup-plan/install`, {
      timeout: timeout ?? null,
    })
    return response.data
  },

  async getLocalScripts(projectId: string): Promise<LocalScript[]> {
    const response = await api.get(`/projects/${projectId}/local/scripts`)
    return response.data
  },

  async runLocalScript(projectId: string, scriptId: string, timeout?: number): Promise<LocalScriptRunResult> {
    const response = await api.post(`/projects/${projectId}/local/scripts/run`, {
      script_id: scriptId,
      timeout: timeout ?? null,
    })
    return response.data
  },

  async saveLocalScriptConfig(
    projectId: string,
    scriptId: string,
    values: Record<string, string | boolean>,
  ): Promise<LocalScript> {
    const response = await api.put(`/projects/${projectId}/local/scripts/config`, {
      script_id: scriptId,
      values,
    })
    return response.data
  },

  async getLocalFile(projectId: string, path: string): Promise<LocalFileContent> {
    const response = await api.get(`/projects/${projectId}/local/file`, { params: { path } })
    return response.data
  },

  async saveLocalFile(projectId: string, path: string, content: string): Promise<LocalFileContent> {
    const response = await api.put(`/projects/${projectId}/local/file`, { path, content })
    return response.data
  },

  async createLocalBranch(projectId: string, branch: string, fromRef?: string): Promise<LocalRepoStatus> {
    const response = await api.post(`/projects/${projectId}/local/branch`, {
      branch,
      from_ref: fromRef ?? null,
    })
    return response.data
  },

  async commitLocalChanges(projectId: string, message: string): Promise<LocalRepoStatus> {
    const response = await api.post(`/projects/${projectId}/local/commit`, { message })
    return response.data
  },

  async pushLocalBranch(projectId: string, branch?: string): Promise<LocalPushResult> {
    const response = await api.post(`/projects/${projectId}/local/push`, { branch: branch ?? null })
    return response.data
  },

  async createPullRequest(
    projectId: string,
    params: { head: string; base?: string; title: string; body?: string; draft?: boolean },
  ): Promise<PullRequestResult> {
    const response = await api.post(`/projects/${projectId}/github/pull-request`, {
      head: params.head,
      base: params.base ?? null,
      title: params.title,
      body: params.body ?? '',
      draft: params.draft ?? false,
    })
    return response.data
  },

  async deleteLocalRepo(projectId: string): Promise<void> {
    await api.delete(`/projects/${projectId}/local`)
  },

  // Task Management (Jira Management > Task Management sub-page)
  async getTaskTeamSettings(): Promise<{ team_name: string | null }> {
    const response = await api.get('/tasks/team-settings')
    return response.data
  },

  async saveTaskTeamSettings(teamName: string): Promise<{ team_name: string | null }> {
    const response = await api.put('/tasks/team-settings', { team_name: teamName })
    return response.data
  },

  async listTasks(teamName?: string): Promise<Task[]> {
    const response = await api.get<Task[]>('/tasks', { params: teamName ? { team_name: teamName } : {} })
    return response.data
  },

  async createTask(payload: { title: string; description?: string; team_name?: string }): Promise<Task> {
    const response = await api.post<Task>('/tasks', payload)
    return response.data
  },

  async assignTaskToMe(taskId: string): Promise<Task> {
    const response = await api.post<Task>(`/tasks/${taskId}/assign-to-me`)
    return response.data
  },

  async unassignTask(taskId: string): Promise<Task> {
    const response = await api.post<Task>(`/tasks/${taskId}/unassign`)
    return response.data
  },

  async updateTaskStatus(taskId: string, status: string): Promise<Task> {
    const response = await api.patch<Task>(`/tasks/${taskId}/status`, { status })
    return response.data
  },

  // ── Community Forum ────────────────────────────────────────────────────────
  async listForumPosts(params: {
    communityId: string
    search?: string
    tags?: string[]
    sort?: 'latest' | 'top'
    page?: number
    pageSize?: number
  }): Promise<ForumPostList> {
    const response = await api.get<ForumPostList>('/community/posts', {
      params: {
        community_id: params.communityId,
        search: params.search || undefined,
        tags: params.tags && params.tags.length > 0 ? params.tags.join(',') : undefined,
        sort: params.sort || 'latest',
        page: params.page || 1,
        page_size: params.pageSize || 20,
      },
    })
    return response.data
  },

  async getAvailableForumTags(communityId: string): Promise<{ tags: Array<{ name: string; count: number }> }> {
    const response = await api.get<{ tags: Array<{ name: string; count: number }> }>('/community/posts/tags/all', {
      params: { community_id: communityId },
    })
    return response.data
  },

  async getForumPost(postId: number): Promise<ForumPost> {
    const response = await api.get<ForumPost>(`/community/posts/${postId}`)
    return response.data
  },

  async createForumPost(payload: {
    community_id: string
    title: string
    body: string
    tags?: string[]
    attachment_ids?: number[]
  }): Promise<ForumPost> {
    const response = await api.post<ForumPost>('/community/posts', payload)
    return response.data
  },

  async updateForumPost(
    postId: number,
    payload: { title?: string; body?: string; tags?: string[] },
  ): Promise<ForumPost> {
    const response = await api.patch<ForumPost>(`/community/posts/${postId}`, payload)
    return response.data
  },

  async moderateForumPost(
    postId: number,
    payload: { is_pinned?: boolean; is_locked?: boolean },
  ): Promise<ForumPost> {
    const response = await api.patch<ForumPost>(`/community/posts/${postId}/moderate`, payload)
    return response.data
  },

  async deleteForumPost(postId: number): Promise<void> {
    await api.delete(`/community/posts/${postId}`)
  },

  async likeForumPost(postId: number): Promise<ForumReactionResponse> {
    const response = await api.post<ForumReactionResponse>(`/community/posts/${postId}/like`)
    return response.data
  },

  async listForumComments(postId: number): Promise<ForumComment[]> {
    const response = await api.get<ForumComment[]>(`/community/posts/${postId}/comments`)
    return response.data
  },

  async createForumComment(
    postId: number,
    payload: { body: string; parent_comment_id?: number | null; attachment_ids?: number[] },
  ): Promise<ForumComment> {
    const response = await api.post<ForumComment>(`/community/posts/${postId}/comments`, payload)
    return response.data
  },

  async updateForumComment(commentId: number, body: string): Promise<ForumComment> {
    const response = await api.patch<ForumComment>(`/community/comments/${commentId}`, { body })
    return response.data
  },

  async deleteForumComment(commentId: number): Promise<void> {
    await api.delete(`/community/comments/${commentId}`)
  },

  async likeForumComment(commentId: number): Promise<ForumReactionResponse> {
    const response = await api.post<ForumReactionResponse>(`/community/comments/${commentId}/like`)
    return response.data
  },

  async uploadForumAttachment(file: File): Promise<ForumAttachment> {
    const formData = new FormData()
    formData.append('file', file)
    const response = await api.post<ForumAttachment>('/community/attachments', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return response.data
  },

  /** Fetch an attachment through the authenticated client and return an object URL. */
  async fetchForumAttachmentUrl(url: string): Promise<string> {
    const path = url.replace(/^\/api/, '')
    const response = await api.get(path, { responseType: 'blob' })
    return URL.createObjectURL(response.data as Blob)
  },

  // ── User Profile Management ──────────────────────────────────────────────
  async changePassword(currentPassword: string, newPassword: string, twoFaCode?: string): Promise<{ message: string; status: string }> {
    const response = await api.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
      two_fa_code: twoFaCode,
    })
    return response.data
  },

  async updateProfile(fullName?: string, email?: string, twoFaCode?: string): Promise<UserResponse> {
    const response = await api.put<UserResponse>('/auth/profile', {
      full_name: fullName,
      email,
      two_fa_code: twoFaCode,
    })
    return response.data
  },

  async uploadProfilePicture(file: File): Promise<{ profile_picture_url: string }> {
    const formData = new FormData()
    formData.append('file', file)
    const response = await api.post('/auth/profile/picture', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    })
    return response.data
  },

  async deleteProfilePicture(): Promise<{ message: string }> {
    const response = await api.delete('/auth/profile/picture')
    return response.data
  },

  async deleteAccount(password: string, twoFaCode?: string): Promise<{ message: string }> {
    const response = await api.post('/auth/delete-account', {
      password,
      two_fa_code: twoFaCode,
    })
    return response.data
  },

  // ── Settings API Methods ─────────────────────────────────────────────────
  
  // Security
  async getLoginHistory(limit?: number): Promise<{ logins: any[] }> {
    const response = await api.get('/settings/security/login-history', {
      params: { limit: limit || 50 },
    })
    return response.data
  },

  async getUserSessions(): Promise<{ sessions: any[] }> {
    const response = await api.get('/settings/security/sessions')
    return response.data
  },

  async logoutSession(sessionId: number): Promise<{ message: string }> {
    const response = await api.post(`/settings/security/sessions/${sessionId}/logout`)
    return response.data
  },

  async logoutAllOtherSessions(): Promise<{ message: string }> {
    const response = await api.post('/settings/security/sessions/logout-all-others')
    return response.data
  },

  async listAPITokens(): Promise<{ tokens: any[] }> {
    const response = await api.get('/settings/security/api-tokens')
    return response.data
  },

  async createAPIToken(name: string, scopes?: string, expiresAt?: string): Promise<any> {
    const response = await api.post('/settings/security/api-tokens', {
      name,
      scopes,
      expires_at: expiresAt,
    })
    return response.data
  },

  async deleteAPIToken(tokenId: number): Promise<{ message: string }> {
    const response = await api.delete(`/settings/security/api-tokens/${tokenId}`)
    return response.data
  },

  // Preferences
  async updateTheme(theme: string): Promise<{ theme_preference: string }> {
    const response = await api.put('/settings/preferences/theme', { theme })
    return response.data
  },

  async getAIPreferences(): Promise<{ preferred_model: string; provider: string; temperature: number }> {
    const response = await api.get('/settings/preferences/ai')
    return response.data
  },

  async updateAIPreferences(
    preferredModel: string,
    provider: string,
    temperature: number
  ): Promise<any> {
    const response = await api.put('/settings/preferences/ai', {
      preferred_model: preferredModel,
      provider,
      temperature,
    })
    return response.data
  },

  async getNotificationPreferences(): Promise<any> {
    const response = await api.get('/settings/preferences/notifications')
    return response.data
  },

  async updateNotificationPreferences(preferences: any): Promise<any> {
    const response = await api.put('/settings/preferences/notifications', preferences)
    return response.data
  },

  async listMobileDevices(): Promise<MobileDevicesResponse> {
    const response = await api.get<MobileDevicesResponse>('/devices')
    return response.data
  },

  async bootMobileDevice(platform: MobilePlatform, deviceId: string): Promise<MobileDevicesResponse> {
    const response = await api.post<MobileDevicesResponse>(
      `/devices/${platform}/${encodeURIComponent(deviceId)}/boot`,
      null,
      { timeout: 90000 },
    )
    return response.data
  },

  async shutdownMobileDevice(platform: MobilePlatform, deviceId: string): Promise<MobileDevicesResponse> {
    const response = await api.post<MobileDevicesResponse>(
      `/devices/${platform}/${encodeURIComponent(deviceId)}/shutdown`,
      null,
      { timeout: 90000 },
    )
    return response.data
  },

  async getLocalAppiumAnalysis(projectId: string, refresh = false): Promise<AppiumProjectAnalysis> {
    const response = await api.get<AppiumProjectAnalysis>(`/projects/${projectId}/local/appium`, {
      params: refresh ? { refresh: true } : undefined,
      timeout: 120000,
    })
    return response.data
  },

  async listPropertiesFiles(projectId: string): Promise<PropertiesFileSummary[]> {
    const response = await api.get<{ files: PropertiesFileSummary[] }>(`/projects/${projectId}/local/properties`)
    return response.data.files
  },

  async readPropertiesFile(projectId: string, path: string, reveal = false): Promise<PropertiesFileView> {
    const response = await api.get<PropertiesFileView>(`/projects/${projectId}/local/properties/file`, {
      params: { path, reveal: reveal || undefined },
    })
    return response.data
  },

  async updatePropertiesFile(projectId: string, payload: {
    path: string
    etag: string
    changes: Record<string, string>
    additions: Record<string, string>
  }): Promise<PropertiesFileView> {
    const response = await api.put<PropertiesFileView>(`/projects/${projectId}/local/properties/file`, payload)
    return response.data
  },

  async revertPropertiesFile(projectId: string, path: string): Promise<PropertiesFileView> {
    const response = await api.post<PropertiesFileView>(`/projects/${projectId}/local/properties/revert`, { path })
    return response.data
  },

  async listBrunoEnvFiles(projectId: string, collection: string): Promise<PropertiesFileSummary[]> {
    const response = await api.get<{ files: PropertiesFileSummary[] }>(`/projects/${projectId}/local/bruno-env`, {
      params: { collection },
    })
    return response.data.files
  },

  async readBrunoEnvFile(projectId: string, path: string, reveal = false): Promise<PropertiesFileView> {
    const response = await api.get<PropertiesFileView>(`/projects/${projectId}/local/bruno-env/file`, {
      params: { path, reveal: reveal || undefined },
    })
    return response.data
  },

  async updateBrunoEnvFile(projectId: string, payload: {
    path: string
    etag: string
    changes: Record<string, string>
    additions: Record<string, string>
    enabled: Record<string, boolean>
  }): Promise<PropertiesFileView> {
    const response = await api.put<PropertiesFileView>(`/projects/${projectId}/local/bruno-env/file`, payload)
    return response.data
  },

  async revertBrunoEnvFile(projectId: string, path: string): Promise<PropertiesFileView> {
    const response = await api.post<PropertiesFileView>(`/projects/${projectId}/local/bruno-env/revert`, { path })
    return response.data
  },

  errorMessage: extractErrorMessage,
}

export default apiService
