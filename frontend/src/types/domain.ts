export type UserRole = 'super_admin' | 'automation_lead' | 'automation_senior' | 'automation_user' | 'automation_trainee' | 'viewer'

/** Highest first; the order the Users screen lists and offers them in. */
export const ALL_ROLES: UserRole[] = ['super_admin', 'automation_lead', 'automation_senior', 'automation_user', 'automation_trainee', 'viewer']

/** Roles a lead may give to their own people (docs/redesign/04-roles-and-permissions.md). */
export const LEAD_ASSIGNABLE_ROLES: UserRole[] = ['automation_senior', 'automation_user', 'automation_trainee', 'viewer']

/** Roles that carry a scope tag. */
export const TAGGED_ROLES: UserRole[] = ['automation_senior', 'automation_user', 'automation_trainee']

export type ScopeTag = 'project_base' | 'shared'

export const SCOPE_TAG_LABELS: Record<ScopeTag, string> = {
  project_base: 'Project based',
  shared: 'Shared',
}

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  automation_lead: 'Automation Lead',
  automation_senior: 'Automation Senior',
  automation_user: 'Automation User',
  automation_trainee: 'Automation Trainee',
  viewer: 'Viewer',
}

export const ROLE_COLORS: Record<UserRole, string> = {
  super_admin: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  automation_lead: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
  automation_senior: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  automation_user: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  automation_trainee: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
  viewer: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
}

export type RunStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'error'
  | 'skipped'
  | 'cancelled'

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type?: string
}

export interface UserResponse {
  id: string
  email: string
  theme_preference?: 'light' | 'dark' | 'system' | string
  full_name: string | null
  role: string
  username?: string
  scope_tag?: ScopeTag | null
  assigned_lead_id?: string | null
  assigned_lead_name?: string | null
  is_active: boolean
  created_at: string
  assigned_communities?: string[] | null
  two_fa_enabled?: boolean
  /** /api/me: what the signed-in user may do and which projects they see. */
  permissions?: string[]
  all_projects?: boolean
  /** /api/me: the projects the user sees; /api/users: the projects the user is a member of. */
  project_ids?: string[]
}

export interface ProjectConfig {
  [key: string]: unknown
}

export interface Project {
  id: string
  name: string
  description: string | null
  git_repo_url: string
  /** Where the project's stories and requirement pages live (Work area). */
  jira_project_key?: string | null
  confluence_space_key?: string | null
  /** Test report pages are published under this Confluence page. */
  confluence_parent_page_id?: string | null
  /** A Teams channel webhook is set (the URL itself is never sent back). */
  teams_webhook_set?: boolean
  git_provider: string
  default_branch: string
  framework: string | null
  config_json: ProjectConfig | null
  created_at: string
}

export interface GitHubTreeItem {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  sha: string
  download_url?: string | null
}

export interface LocalRepoCommit {
  sha: string
  author: string
  date: string
  message: string
}

export interface LocalChangedFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  scope: 'committed' | 'uncommitted'
}

export interface LocalChanges {
  branch: string | null
  /** Branch the committed changes are compared with (null when only uncommitted changes are listed). */
  base: string | null
  files: LocalChangedFile[]
  truncated: boolean
  bruno: { collection: string; requests: string[]; environments_changed: string[]; environments: string[] }[]
}

export interface LocalRepoStatus {
  path: string
  exists: boolean
  is_git_repo: boolean
  current_branch: string | null
  branches: string[]
  last_commit: LocalRepoCommit | null
  dirty: boolean
  has_upstream: boolean
  ahead: number
  behind: number
}

export interface GitHubCommitInfo {
  sha: string
  author: string
  date: string
  message: string
}

export interface AllureTestResult {
  name: string
  class_name: string | null
  status: string
  duration_ms: number
  message: string | null
}

export interface AllureReport {
  id: number
  source: 'local' | 'github_actions'
  name: string
  branch: string | null
  workflow_name: string | null
  report_url: string | null
  total_tests: number
  passed_tests: number
  failed_tests: number
  broken_tests: number
  skipped_tests: number
  duration_ms: number
  created_at: string | null
  results: AllureTestResult[]
}

export interface RepoCompareFile {
  path: string
  old_path?: string | null
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied'
  additions: number
  deletions: number
  binary: boolean
  patch?: string | null
  patch_truncated: boolean
}

export interface RepoCompareResult {
  base: string
  head: string
  base_label: string
  head_label: string
  default_branch: string
  files: RepoCompareFile[]
  total_files: number
  total_additions: number
  total_deletions: number
  truncated: boolean
}

export interface ScriptParam {
  name: string
  type: 'positional' | 'flag'
  value_type: 'string' | 'boolean'
  required: boolean
}

export interface LocalScript {
  id: string
  type: 'npm' | 'make' | 'pytest' | 'shell' | 'python' | 'node' | 'typescript'
  name: string
  description: string
  command: string
  cwd: string
  source: string
  usage?: string | null
  example?: string | null
  params: ScriptParam[]
  configured: boolean
  config_values: Record<string, string | boolean>
}

export interface LocalScriptRunResult {
  script_id: string
  command: string
  cwd: string
  exit_code: number
  timed_out: boolean
  duration_seconds: number
  stdout: string
  stderr: string
}

export interface WorkflowInput {
  name: string
  description: string
  required: boolean
  default: string | number | boolean | null
  type: string
  options: string[]
  example: string
}

export interface WorkflowItem {
  id: string
  path: string
  name: string
  inputs: WorkflowInput[]
}

export interface IssueTemplateField {
  id: string
  type: string
  label: string
  description: string
  placeholder: string
  required: boolean
  options: string[]
}

export interface IssueTemplateItem {
  id: string
  path: string
  name: string
  description: string
  fields: IssueTemplateField[]
}

export interface GitHubTemplates {
  ref: string
  workflows: WorkflowItem[]
  issue_templates: IssueTemplateItem[]
}

export interface WorkflowDispatchResult {
  dispatched: boolean
  workflow_id: string
  ref: string
  actions_url: string
  run_id: string | null
}

export interface WorkflowRunsSyncResult {
  synced: number
  created: number
  updated: number
  total_available: number
}

export interface GitHubRun {
  id: string
  run_number: number | null
  name: string
  status: string                 // queued | in_progress | completed
  conclusion: string | null      // success | failure | cancelled | ...
  branch: string | null
  event: string | null
  actor: string | null
  created_at: string | null
  run_started_at: string | null
  updated_at: string | null
  html_url: string
}

export interface LibraryItem {
  name: string
  version: string
}

export interface LibraryManifest {
  id: string
  manifest: string
  path: string
  ecosystem: string
  install_command: string
  libraries: LibraryItem[]
  count: number
}

export interface LibraryInstallResult {
  manifest_id: string
  command: string
  cwd: string
  exit_code: number
  timed_out: boolean
  duration_seconds: number
  stdout: string
  stderr: string
}

export interface SetupPlanStep {
  id: string
  label: string
  command: string
  cwd: string
  kind: 'workflow' | 'framework'
  source: string
}

export interface SetupPlan {
  run_workflow: string
  frameworks: string[]
  steps: SetupPlanStep[]
}

export interface SetupStepResult extends SetupPlanStep {
  exit_code: number
  timed_out: boolean
  skipped: boolean
  duration_seconds: number
  stdout: string
  stderr: string
}

export interface SetupInstallResult {
  run_workflow: string
  frameworks: string[]
  exit_code: number
  steps: SetupStepResult[]
}

export type TaskStatus = 'todo' | 'in_progress' | 'done'

export interface Task {
  id: string
  team_name: string
  title: string
  description: string | null
  status: TaskStatus
  assignee_id: string | null
  assignee_name: string | null
  created_by_id: string | null
  created_by_name: string | null
  created_at: string | null
  updated_at: string | null
}

export interface LocalFileContent {
  path: string
  content: string | null
  size: number
  binary: boolean
  too_large: boolean
}

export interface LocalPushResult {
  branch: string
  pushed: boolean
  status: LocalRepoStatus
  /** Test files of the push traced to the branch's work item. */
  linked_tests?: number
}

export interface PullRequestResult {
  number: number
  url: string
  state: string
  title: string
  head: string
  base: string
}

export interface JiraProject {
  id: string
  key: string
  name: string
  project_type?: string | null
}

export type MobilePlatform = 'android' | 'ios'
export type MobileDeviceState = 'stopped' | 'booting' | 'running' | 'stopping'

export interface MobileDevice {
  id: string
  platform: MobilePlatform
  name: string
  os_version: string | null
  state: MobileDeviceState
  serial: string | null
}

export interface MobilePlatformTooling {
  sdk_path?: string | null
  source?: string | null
  emulator?: string | null
  adb?: string | null
  xcode_path?: string | null
  xcode_version?: string | null
}

export interface MobilePlatformStatus {
  available: boolean
  reason: string | null
  tooling: MobilePlatformTooling | null
}

export interface MobileStation {
  hostname: string
  os: string
  os_family: 'macos' | 'windows' | 'linux' | 'other'
  user: string | null
}

export interface MobileDevicesResponse {
  station: MobileStation
  platforms: Record<MobilePlatform, MobilePlatformStatus>
  devices: MobileDevice[]
}

export type AppiumCheckStatus = 'ok' | 'warning' | 'error'

export interface AppiumCheck {
  id: string
  title: string
  status: AppiumCheckStatus
  message: string
  fix: string | null
  file: string | null
  line: number | null
}

export interface AppiumProfileChange {
  key: string
  current: string | null
  suggested: string
}

export interface AppiumDeviceProfile {
  option: string
  aliases: string[]
  platform: MobilePlatform
  device_name: string | null
  udid: string | null
  avd: string | null
  platform_version: string | null
  port: string | null
  file: string
  line: number
  status: AppiumCheckStatus
  issues: string[]
  station_device: MobileDevice | null
  app_installed: boolean | null
  suggestion: { device: MobileDevice; changes: AppiumProfileChange[] } | null
}

export interface AppiumRunner {
  name: string
  class_name: string
  package: string
  group: string
  path: string
  features: string | null
  tags: string | null
  runnable: boolean
  issue: string | null
  note: string | null
  suggested_features: string | null
}

export interface AppiumSuite {
  name: string
  folder: string
  file: string
  path: string
  classes: string[]
}

export interface AppiumProjectDetails {
  detected: true
  layout: string
  repo_path: string
  framework: {
    language: string
    build: string
    test_runner: string
    java_release: number | null
    appium_client_version: string | null
  }
  settings: {
    file: string
    app_env: string | null
    app_env_values: string[]
    app_env_ready: Record<string, boolean>
    device_run_option: string | null
  }
  station: MobileStation
  checks: AppiumCheck[]
  profiles: AppiumDeviceProfile[]
  profiles_file: string | null
  runners: AppiumRunner[]
  suites: AppiumSuite[]
}

export type AppiumProjectAnalysis = { detected: false } | AppiumProjectDetails

export interface AiProviderInfo {
  id: 'github' | 'anthropic' | 'azure_openai' | 'rbi_genai' | 'microsoft_copilot'
  name: string
  auth: 'api_key' | 'device_code' | 'rbi_login'
  key_label: string
  key_hint: string
  /** For Azure OpenAI: the default deployment name. */
  default_model: string
  /** Azure OpenAI only. */
  default_endpoint?: string
  /** Azure OpenAI: the only deployments that can be chosen. */
  models?: string[]
  /** RBI GenAI LLM Gateway: environment used by default (prod | uat | sbox). */
  default_environment?: string
}

export interface AiSettings {
  provider: string
  model: string
  api_key_set: boolean
  api_key_preview: string
  configured: boolean
  /** Azure OpenAI base URL (…/openai/v1). */
  endpoint: string
  /** RBI GenAI LLM Gateway: environment the user signed in to. */
  environment: string
  rbi_environments: RbiGatewayEnvironment[]
  tenant_id: string
  client_id: string
  account: string
  providers: AiProviderInfo[]
  graph_scopes: string[]
}

export interface RbiGatewayEnvironment {
  id: string
  name: string
  gateway: string
  login: string
}

export interface StationIde {
  id: string
  name: string
  version: string | null
  kind: 'ide' | 'editor'
  notes: string
}

export interface MicrosoftSignIn {
  user_code: string
  verification_uri: string
  message: string
  interval: number
  expires_in: number
}

export interface AiProjectAnalysis {
  path: string
  analyzed_at: string
  files_count: number
  files_truncated: boolean
  languages: { name: string; files: number; percent: number }[]
  frameworks: string[]
  build_tools: string[]
  maven: { artifact: string | null; java_release: string | null; stacks: string[] } | null
  package_json: { name: string | null; test_libraries: Record<string, string>; scripts: string[] } | null
  test_file_kinds: Record<string, number>
  test_files_count: number
  test_files: string[]
  runnable: { name: string; root: string; runner: string; language: string; stacks: string[]; missing_tools: string[]; issues: string[]; targets: number }[]
  appium: boolean
  bruno_collections: string[]
  properties_files: string[]
  workflows: string[]
  key_files: string[]
  structure: { folder: string; files: number }[]
  git: {
    branch: string | null
    remote: string | null
    changed_files: { status: string; path: string }[]
    changed_count: number
    last_commit: { sha: string; author: string; date: string; message: string } | null
  }
  files: string[]
}

export interface AiChange {
  path: string
  state: 'proposed' | 'applied' | 'undone' | 'rejected' | 'invalid'
  error?: string | null
  status?: 'create' | 'modify' | 'unchanged'
  added?: number
  removed?: number
  diff?: string
  diff_truncated?: boolean
  current_sha?: string | null
}

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  attachments?: { files: string[]; run: { id: string; name: string | null; status: string; passed: number; failed: number; skipped: number } | null }
  changes?: AiChange[]
  error?: string | null
  stopped?: boolean
  model?: string
  provider?: string
  context_files?: string[]
}

export interface AiConversationSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
  messages: number
}

export interface AiConversation {
  id: string
  title: string
  created_at: string
  updated_at: string
  messages: AiMessage[]
}

export type AiStreamEvent =
  | { type: 'start'; user_message: string; context_files: string[]; provider: string; model: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; conversation: AiConversation; error: string | null }

export interface FrameworkRunTarget {
  id: string
  label: string
  group: string
  description: string
}

export interface DetectedRunFramework {
  id: string
  name: string
  language: string
  root: string
  runner: string
  stacks: string[]
  tools: string[]
  missing_tools: { tool: string; hint: string }[]
  issues: string[]
  targets: FrameworkRunTarget[]
}

export interface FrameworkDetection {
  frameworks: DetectedRunFramework[]
  station_tools: Record<string, boolean>
}

export interface ScaffoldLanguageOption {
  language: string
  language_name: string
  tools: string[]
  /** `installable`: ATM downloads it itself as the first step of "Install & run sample tests". */
  missing_tools: { tool: string; hint: string; installable?: boolean }[]
  run: string[]
  target: string
  note: string
  files: string[]
}

export interface ScaffoldFramework {
  id: string
  name: string
  type: string
  summary: string
  languages: ScaffoldLanguageOption[]
}

export interface ScaffoldCatalog {
  frameworks: ScaffoldFramework[]
  languages: Record<string, string>
  station_tools: Record<string, boolean>
  /** Tools installed by ATM in its own folder (not on PATH): tool -> binary path. */
  managed_tools?: Record<string, string>
}

export interface ScaffoldInfo {
  framework: string
  language: string
  path: string
  created_at: string
  /** Git remotes of the generated repository; empty while it only exists locally. */
  remotes?: string[]
}

export interface ScaffoldVerifyJob {
  id: string
  project_id: number
  path: string
  framework: string
  language: string
  status: 'running' | 'passed' | 'failed' | 'cancelled'
  steps: { label: string; status: 'pending' | 'running' | 'passed' | 'failed' | 'cancelled' }[]
  started_at: string
  finished_at: string | null
  log_offset: number
  log: string[]
  log_total: number
}

export interface LocalFolderInspection {
  path: string
  exists: boolean
  is_git_repo: boolean
  origin: string | null
  matches_project: boolean
  current_branch: string | null
  branches: string[]
  dirty: boolean
  error: string | null
}

export interface ProjectGithubOverview {
  branch: string
  analyzed_at: string
  repository: {
    full_name: string | null
    html_url: string | null
    description: string | null
    visibility: string | null
    archived: boolean
    default_branch: string
    language: string | null
    topics: string[]
    stars: number | null
    forks: number | null
    open_issues: number | null
    size_kb: number | null
    license: string | null
    created_at: string | null
    pushed_at: string | null
    branches_count: number | string | null
    languages: { name: string; percent: number }[]
    contributors: { login: string; contributions: number; html_url: string }[]
    latest_commit: { sha: string; message: string; author: string | null; date: string | null; html_url: string | null } | null
    latest_workflow_run: {
      name: string | null
      status: string | null
      conclusion: string | null
      branch: string | null
      created_at: string | null
      html_url: string | null
    } | null
  }
  detection: {
    files_count: number
    frameworks: string[]
    build_tools: string[]
    test_files: Record<string, number>
    collections: string[]
    properties_files: string[]
    workflows: string[]
    top_level_folders: string[]
    has_readme: boolean
    maven: { artifact: string | null; java_release: string | null; appium_java_client: string | null; selenium: string | null; stacks: string[] } | null
    package_json: { name: string | null; test_libraries: Record<string, string>; scripts: string[] } | null
    tree_truncated: boolean
    tree_available: boolean
  }
  local: {
    path: string
    exists: boolean
    is_git_repo: boolean
    current_branch: string | null
    dirty: boolean
    ahead: number
    behind: number
    last_commit: { sha: string; author: string; date: string; message: string } | null
  } | null
}

export type GitFileStatus = 'clean' | 'modified' | 'untracked' | 'unknown'

export interface PropertiesFileSummary {
  path: string
  entries: number
  git_status: GitFileStatus
  /** Bruno environments only: environment name and whether it comes from the parent folder. */
  environment?: string
  shared?: boolean
}

export interface PropertiesEntry {
  key: string
  value: string | null
  secret: boolean
  has_value: boolean
  line: number
  multiline: boolean
  /** Bruno environments only. */
  id?: string
  enabled?: boolean
  readonly?: boolean
  note?: string | null
}

export interface PropertiesFileView {
  path: string
  etag: string
  git_status: GitFileStatus
  revealed: boolean
  entries: PropertiesEntry[]
}

export interface ConfluenceSpace {
  id: string
  key: string
  name: string
}

export interface ConfluenceReleasePage {
  id: string
  title: string
  url: string
  space_key: string
  updated?: string | null
}

export interface ConfluencePageItem {
  id: string
  title: string
  url: string
  updated?: string | null
}

export interface ReleaseAnalysisBackendItem {
  service: string
  version: string
  component?: string | null
  component_color?: string | null
  live_env_details?: string | null
  live_env_details_color?: string | null
  new_service_or_operation?: string | null
  new_service_or_operation_color?: string | null
  developer?: string | null
  developer_color?: string | null
  context: string
}

export interface ReleaseAnalysisFrontendItem {
  platform: string
  version: string
  environment?: string | null
  context: string
}

export interface ReleaseAnalysisMetadata {
  release_date?: string | null
  status?: string | null
  team?: string | null
}

export interface ReleaseAnalysisTicketItem {
  key: string
  summary: string
  issue_type: string
  status: string
  team_name?: string | null
  epic_link?: string | null
  components?: string | null
  url: string
}

export interface ReleaseAnalysisResponse {
  page_id: string
  page_title: string
  page_url: string
  release_metadata?: ReleaseAnalysisMetadata | null
  backend_versions: ReleaseAnalysisBackendItem[]
  frontend_versions: ReleaseAnalysisFrontendItem[]
  additional_tickets: ReleaseAnalysisTicketItem[]
  additional_tickets_error?: string | null
}

export type TestType = 'functional' | 'regression' | 'smoke' | 'api' | 'ui' | 'mobile' | 'performance'

export const TEST_TYPES: TestType[] = ['functional', 'regression', 'smoke', 'api', 'ui', 'mobile', 'performance']

export interface TestSuite {
  id: string
  project_id: string
  name: string
  tags: string[] | null
  cron_expression: string | null
  active: boolean
  created_at: string
  test_type?: TestType
  /** Framework target id from /local/frameworks, e.g. "pytest@.|file|tests/test_login.py". */
  target?: string | null
  environment_id?: string | null
  ci_workflow?: string | null
  created_by_user_id?: string | null
  last_run?: { id: string; status: RunStatus; trigger: string; created_at: string | null } | null
  /** Archived suites keep their runs and reports and can be restored (phase 17). */
  archived_at?: string | null
  /** Every finished run's report goes to Confluence, with the token of who switched it on (phase 19). */
  auto_publish?: boolean
  auto_publish_by?: string | null
}

export interface TestEnvironment {
  id: string
  project_id: string
  name: string
  variables: Record<string, string>
  /** Names of the secret variables; their values never reach the browser. */
  secret_names?: string[]
  bruno_environment: string | null
}

export interface TestRun {
  id: string
  name?: string | null
  app_version?: string | null
  report_count?: number
  suite_id: string
  status: RunStatus
  branch: string | null
  commit_sha: string | null
  triggered_by: string | null
  source: 'local' | 'github_actions'
  trigger?: 'manual' | 'schedule' | string
  environment_id?: string | null
  collection: string | null
  environment?: string | null
  execution_time?: string | null
  started_at: string | null
  finished_at: string | null
  total_tests: number
  passed_tests: number
  failed_tests: number
  skipped_tests: number
  created_at: string
}

export interface TestResult {
  id: string
  run_id: string
  test_name: string
  class_name: string | null
  status: RunStatus
  duration_ms: number | null
  error_message: string | null
  stack_trace: string | null
}

export interface RunReportFile {
  name: string
  source: string
  file: string
  kind: string
  size: number
}

export interface RunPerformance {
  p95_ms: number | null
  p90_ms: number | null
  avg_ms: number | null
  max_ms: number | null
  requests: number
  requests_per_second: number | null
  error_rate: number | null
  virtual_users: number
  iterations: number
}

export interface RunExecutionDetails {
  type: 'appium' | 'bruno' | 'framework'
  /** k6 runs: response times, throughput and errors. */
  performance?: RunPerformance | null
  command?: string[]
  target?: {
    kind: 'runner' | 'suite' | 'collection'
    name: string
    class_name?: string
    features?: string | null
    tags?: string | null
    file?: string
    classes?: string[]
  } | null
  app_env?: string | null
  device_run_option?: string | null
  duration_seconds?: number
  exit_code?: number | null
  app?: { name?: string; id?: string; version?: string | null; build?: string | null; source?: string } | null
  device?: {
    platform?: string | null
    platform_version?: string | null
    name?: string | null
    os?: string | null
    id?: string | null
    automation?: string | null
  } | null
  technology?: Record<string, string | number | { name: string; version?: string | null } | null>
  station?: { hostname: string; os: string; user: string | null } | null
  reports?: RunReportFile[]
}

export interface TestRunDetails extends TestRun {
  results: TestResult[]
  details?: RunExecutionDetails | null
}

export interface Branch {
  name: string
  commit_sha: string
  is_default: boolean
}

export interface Tag {
  name: string
  commit_sha: string
}

export interface ExecuteRunResponse {
  status: string
  run_id: string
  task_id: string
  message: string
}

export interface WsRunMessage {
  type: string
  data?: string
  status?: string
  timestamp?: string
}
