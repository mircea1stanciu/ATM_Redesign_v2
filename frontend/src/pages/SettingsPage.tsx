import { useEffect, useState } from 'react'
import { NavLink, Navigate, useParams } from 'react-router-dom'
import {
  AlertCircle, Bot, BookOpen, CheckCircle2, Github, Loader2,
  Save, Search, Settings2, Unplug, Eye, EyeOff, Trash2, Link2, User,
  Lock, Sliders,
} from 'lucide-react'
import AiAssistantPanel from '@/components/settings/AiAssistantPanel'
import { useAppStore } from '@/store/useAppStore'
import { apiService, notifyConnectionStatusChanged } from '@/services/api'
import { UserProfilePanel } from '@/components/settings/UserProfilePanel'
import { SecuritySettingsPanel } from '@/components/settings/SecuritySettingsPanel'
import { PreferencesSettingsPanel } from '@/components/settings/PreferencesSettingsPanel'

interface ProjectGithubSettings {
  github_token_set: boolean
  github_token_preview: string
  github_repo_url: string
}

interface TestResult {
  ok: boolean
  login?: string
  name?: string
  plan?: string
  error?: string
}

interface JiraSettingsResponse {
  jira_token_set: boolean
  jira_token_preview: string
  jira_mcp_base_url: string
  jira_project_key?: string | null
  jira_project_name?: string | null
}

interface JiraTestResult {
  ok: boolean
  user?: string
  error?: string
}

interface ConfluenceSettingsResponse {
  confluence_token_set: boolean
  confluence_token_preview: string
  confluence_mcp_base_url: string
  confluence_space_key?: string | null
  confluence_space_name?: string | null
}

interface ConfluenceTestResult {
  ok: boolean
  user?: string
  error?: string
}

// ── Shared GitHub card used for both global and per-project ───────────────
interface GitHubCardProps {
  title: string
  subtitle: string
  tokenSet: boolean
  tokenPreview: string
  repoUrl: string
  loading: boolean
  saving: boolean
  testing: boolean
  error: string | null
  saveMsg: string | null
  testResult: TestResult | null
  canSave: boolean
  canEditToken: boolean
  canEdit: boolean
  onTokenChange: (v: string) => void
  onRepoUrlChange: (v: string) => void
  onSave: () => void
  onTest: () => void
  onDisconnect?: () => void
  disconnecting?: boolean
}

function GitHubCard({
  title, subtitle, tokenSet, tokenPreview, repoUrl, loading,
  saving, testing, error, saveMsg, testResult, canSave, canEditToken, canEdit,
  onTokenChange, onRepoUrlChange, onSave, onTest, onDisconnect, disconnecting,
}: GitHubCardProps) {
  const [token, setToken] = useState('')
  const [localRepo, setLocalRepo] = useState(repoUrl)
  const [showToken, setShowToken] = useState(false)

  useEffect(() => { setLocalRepo(repoUrl) }, [repoUrl])

  return (
    <div className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft overflow-hidden">
      <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900 dark:bg-white">
          <Github size={20} className="text-white dark:text-gray-900" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-gray-900 dark:text-white">{title}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
        {!loading && (
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
            tokenSet
              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${tokenSet ? 'bg-emerald-500' : 'bg-gray-400'}`} />
            {tokenSet ? 'Connected' : 'Not connected'}
          </span>
        )}
      </div>

      <div className="px-6 py-5 space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {tokenSet && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-2.5">
                <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="text-xs text-emerald-700 dark:text-emerald-300">
                  Token on file: <span className="font-mono font-semibold">{tokenPreview}</span>
                </span>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                Classic token for general use, with repo rights
                <span className="ml-1 font-normal text-gray-400">(leave blank to keep existing)</span>
              </label>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={e => { setToken(e.target.value); onTokenChange(e.target.value) }}
                  placeholder="ghp_••••••••••••••••••••••••••••••••••••••"
                  className="form-input w-full pr-10 font-mono text-sm"
                  disabled={!canEditToken}
                />
                <button type="button" onClick={() => setShowToken(v => !v)} disabled={!canEdit}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                Generate at{' '}
                <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noreferrer" className="underline hover:text-blue-500">
                  github.com/settings/tokens?type=beta
                </a>
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                Repository URL
              </label>
              <input
                type="text"
                value={localRepo}
                onChange={e => { setLocalRepo(e.target.value); onRepoUrlChange(e.target.value) }}
                placeholder="https://github.com/your-org/your-repo.git"
                className="form-input w-full font-mono text-sm"
                disabled={!canEdit}
              />
              {!canEdit && (
                <p className="mt-1 text-[11px] text-blue-500 dark:text-blue-400">
                  Repository URL is managed by your Automation Lead.
                </p>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}
            {saveMsg && !error && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 size={15} className="shrink-0" /> {saveMsg}
              </div>
            )}
            {testResult && (
              <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
                testResult.ok
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                  : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
              }`}>
                {testResult.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
                <div>
                  {testResult.ok ? (
                    <>
                      <p className="font-semibold">Connection successful!</p>
                      <p className="text-xs mt-0.5 opacity-80">
                        Logged in as <span className="font-mono font-semibold">@{testResult.login}</span>
                        {testResult.name ? ` (${testResult.name})` : ''}
                        {testResult.plan ? ` · Plan: ${testResult.plan}` : ''}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold">Connection failed</p>
                      <p className="text-xs mt-0.5 opacity-80">{testResult.error}</p>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button onClick={onSave} disabled={saving || !canSave} className="btn-primary gap-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
              </button>
              <button
                onClick={onTest}
                disabled={testing || !tokenSet}
                className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-40 transition"
              >
                {testing ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />} Test Connection
              </button>
              {onDisconnect && tokenSet && (
                <button
                  onClick={() => {
                    if (window.confirm('Remove your GitHub token for this project?')) {
                      onDisconnect()
                    }
                  }}
                  disabled={disconnecting}
                  className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-gray-700 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 transition ml-auto"
                >
                  {disconnecting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Disconnect
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Per-project GitHub panel ──────────────────────────────────────────────
function ProjectGitHubPanel({ projectId, projectName, canEdit }: { projectId: string; projectName: string; canEdit: boolean }) {
  const [settings, setSettings] = useState<ProjectGithubSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [pendingToken, setPendingToken] = useState('')
  const [pendingRepo, setPendingRepo] = useState('')
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    setSettings(null)
    setPendingToken('')
    setPendingRepo('')
    setError(null)
    setSaveMsg(null)
    setTestResult(null)
    setLoading(true)
    apiService.getProjectGithub(projectId)
      .then(d => { setSettings(d); setPendingRepo(d.github_repo_url) })
      .catch(e => {
        setSettings(null)
        setPendingRepo('')
        setError(apiService.errorMessage(e))
      })
      .finally(() => setLoading(false))
  }, [projectId])

  const handleSave = async () => {
    setSaving(true); setError(null); setSaveMsg(null); setTestResult(null)
    try {
      const payload: { github_token?: string; github_repo_url?: string } = {}
      if (pendingToken.trim()) payload.github_token = pendingToken.trim()
      if (canEdit && pendingRepo.trim()) payload.github_repo_url = pendingRepo.trim()
      const d = await apiService.saveProjectGithub(projectId, payload)
      setSettings(d); setPendingToken(''); setSaveMsg('Saved successfully.')
      notifyConnectionStatusChanged('github')
    } catch (e) { setError(apiService.errorMessage(e)) }
    finally { setSaving(false) }
  }

  const handleTest = async () => {
    setTesting(true); setTestResult(null); setError(null)
    try {
      setTestResult(await apiService.testProjectGithub(projectId))
      notifyConnectionStatusChanged('github')
    }
    catch (e) { setError(apiService.errorMessage(e)) }
    finally { setTesting(false) }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true); setError(null); setSaveMsg(null); setTestResult(null)
    try {
      await apiService.disconnectProjectGithub(projectId)
      setSettings(s => s ? { ...s, github_token_set: false, github_token_preview: '' } : s)
      setSaveMsg('GitHub connection removed.')
      notifyConnectionStatusChanged('github')
    } catch (e) { setError(apiService.errorMessage(e)) }
    finally { setDisconnecting(false) }
  }

  return (
    <GitHubCard
      title={`GitHub — ${projectName}`}
      subtitle="Per-project Fine-grained PAT for this repository"
      tokenSet={settings?.github_token_set ?? false}
      tokenPreview={settings?.github_token_preview ?? ''}
      repoUrl={settings?.github_repo_url ?? ''}
      loading={loading}
      saving={saving}
      testing={testing}
      error={error}
      saveMsg={saveMsg}
      testResult={testResult}
      canSave={!!pendingToken.trim() || (canEdit && pendingRepo !== (settings?.github_repo_url ?? ''))}
      canEditToken={true}
      canEdit={canEdit}
      onTokenChange={setPendingToken}
      onRepoUrlChange={setPendingRepo}
      onSave={handleSave}
      onTest={handleTest}
      onDisconnect={handleDisconnect}
      disconnecting={disconnecting}
    />
  )
}

function JiraMcpPanel({ canEditConnection, canEditBaseUrl, canManageProject }: { canEditConnection: boolean; canEditBaseUrl: boolean; canManageProject: boolean }) {
  const [settings, setSettings] = useState<JiraSettingsResponse | null>(null)
  const [projects, setProjects] = useState<Array<{ id: string; key: string; name: string; project_type?: string | null }>>([])
  const [search, setSearch] = useState('')
  const [selectedProjectKey, setSelectedProjectKey] = useState('')
  const [pendingToken, setPendingToken] = useState('')
  const [pendingBaseUrl, setPendingBaseUrl] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectingProject, setDisconnectingProject] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<JiraTestResult | null>(null)

  const loadJira = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiService.getJiraSettings()
      console.log('[JiraMcpPanel] loadJira response:', JSON.stringify(data))
      setSettings(data)
      setPendingBaseUrl(data.jira_mcp_base_url || '')
      setSelectedProjectKey(data.jira_project_key || '')

      if (data.jira_token_set && data.jira_mcp_base_url) {
        const list = await apiService.listJiraProjects()
        setProjects(list)
      } else {
        setProjects([])
      }
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadJira()
  }, [])

  const filteredProjects = projects.filter(p => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return p.key.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
  })

  // If a project is connected, show only that project
  const displayProjects = settings?.jira_project_key
    ? projects.filter(p => p.key === settings.jira_project_key)
    : (canManageProject ? filteredProjects : [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaveMsg(null)
    setTestResult(null)
    try {
      const payload: { jira_token?: string; jira_mcp_base_url?: string } = {}
      if (pendingToken.trim()) payload.jira_token = pendingToken.trim()
      if (canEditBaseUrl) payload.jira_mcp_base_url = pendingBaseUrl.trim()
      const data = await apiService.saveJiraSettings(payload)
      setSettings(data)
      setPendingToken('')
      setSaveMsg('Saved successfully.')
      notifyConnectionStatusChanged('jira')
      if (data.jira_token_set && data.jira_mcp_base_url) {
        const list = await apiService.listJiraProjects()
        setProjects(list)
      }
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setError(null)
    setTestResult(null)
    try {
      setTestResult(await apiService.testJiraConnection())
      notifyConnectionStatusChanged('jira')
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setTesting(false)
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    setError(null)
    setSaveMsg(null)
    setTestResult(null)
    try {
      const data = await apiService.saveJiraSettings({
        jira_token: '',
      })
      setSettings(data)
      setSaveMsg('Jira token removed.')
      notifyConnectionStatusChanged('jira')
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setDisconnecting(false)
    }
  }

  const handleConnectSelected = async () => {
    const selected = projects.find(p => p.key === selectedProjectKey)
    if (!selected) return
    setConnecting(true)
    setError(null)
    setSaveMsg(null)
    try {
      const data = await apiService.saveJiraSettings({
        jira_project_key: selected.key,
        jira_project_name: selected.name,
      })
      setSettings(data)
      setSaveMsg(`Connected project ${selected.key}.`)
      notifyConnectionStatusChanged('jira')
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnectProject = async () => {
    setDisconnectingProject(true)
    setError(null)
    setSaveMsg(null)
    try {
      const data = await apiService.saveJiraSettings({
        jira_project_key: '',
        jira_project_name: '',
      })
      setSettings(data)
      setSelectedProjectKey('')
      setSaveMsg('Jira project disconnected.')
      notifyConnectionStatusChanged('jira')

      if (data.jira_token_set && data.jira_mcp_base_url) {
        const list = await apiService.listJiraProjects()
        setProjects(list)
      }
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setDisconnectingProject(false)
    }
  }

  const selectedIsConnected = settings?.jira_project_key && settings.jira_project_key === selectedProjectKey

  return (
    <div className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft overflow-hidden">
      <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600">
          <Settings2 size={20} className="text-white" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-gray-900 dark:text-white">Jira MCP Connection</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Configure Jira base URL, token, test and connect a default Jira project.</p>
        </div>
        {!loading && (
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
            settings?.jira_token_set
              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${settings?.jira_token_set ? 'bg-emerald-500' : 'bg-gray-400'}`} />
            {settings?.jira_token_set ? 'Connected' : 'Not connected'}
          </span>
        )}
      </div>

      <div className="px-6 py-5 space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {settings?.jira_token_set && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-2.5">
                <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="text-xs text-emerald-700 dark:text-emerald-300">
                  Token on file: <span className="font-mono font-semibold">{settings.jira_token_preview}</span>
                </span>
              </div>
            )}

            <div>
              <label htmlFor="jira-token" className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                Jira Token
                <span className="ml-1 font-normal text-gray-400">(leave blank to keep existing)</span>
              </label>
              <input
                id="jira-token"
                type="password"
                value={pendingToken}
                onChange={e => setPendingToken(e.target.value)}
                placeholder="Enter Jira token"
                className="form-input w-full font-mono text-sm"
                disabled={!canEditConnection}
              />
            </div>

            <div>
              <label htmlFor="jira-base-url" className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                Jira Base URL
              </label>
              <input
                id="jira-base-url"
                type="text"
                value={pendingBaseUrl}
                onChange={e => setPendingBaseUrl(e.target.value)}
                placeholder="https://your-domain.atlassian.net"
                className="form-input w-full font-mono text-sm"
                disabled={!canEditBaseUrl}
              />
              {!canEditBaseUrl && (
                <p className="mt-1 text-[11px] text-blue-500 dark:text-blue-400">
                  Jira Base URL is managed by your Automation Lead.
                </p>
              )}
            </div>

            {settings?.jira_project_key && (
              <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-2.5 text-xs text-blue-700 dark:text-blue-300">
                Configured project: <span className="font-semibold">{settings.jira_project_key}</span>{settings.jira_project_name ? ` - ${settings.jira_project_name}` : ''}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button onClick={handleSave} disabled={saving} className="btn-primary gap-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
              </button>
              <button
                onClick={handleTest}
                disabled={testing || !settings?.jira_token_set}
                className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-40 transition"
              >
                {testing ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />} Test Connection
              </button>
              {settings?.jira_token_set && (
                <button
                  onClick={() => {
                    if (window.confirm('Remove Jira token and selected project?')) {
                      void handleDisconnect()
                    }
                  }}
                  disabled={disconnecting || !canEditConnection}
                  className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-gray-700 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 transition ml-auto"
                >
                  {disconnecting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Disconnect
                </button>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  {settings?.jira_project_key ? 'Selected Project' : 'Jira Projects'}
                </p>
                <div className="flex items-center gap-2">
                  {settings?.jira_project_key && (
                    <button
                      onClick={() => {
                        if (window.confirm('Disconnect currently configured Jira project?')) {
                          void handleDisconnectProject()
                        }
                      }}
                      disabled={!canManageProject || disconnectingProject}
                      className="flex items-center gap-1 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-gray-700 px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 transition"
                    >
                      {disconnectingProject ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Disconnect Project
                    </button>
                  )}
                  <button
                    onClick={handleConnectSelected}
                    disabled={!canManageProject || !selectedProjectKey || connecting || Boolean(selectedIsConnected)}
                    className="btn-primary !px-2.5 !py-1 text-xs"
                  >
                    {connecting ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} Connect Selected Project
                  </button>
                </div>
              </div>

              {!settings?.jira_project_key && (
                <div className="relative">
                  <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search key or name"
                    className="form-input !pl-8"
                    disabled={!canManageProject}
                  />
                </div>
              )}

              <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                {displayProjects.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-gray-500 dark:text-gray-400">No Jira projects found.</div>
                ) : (
                  displayProjects.map(project => {
                    const isSelected = project.key === selectedProjectKey
                    const isConnected = project.key === settings?.jira_project_key
                    return (
                      <button
                        key={project.id}
                        onClick={() => {
                          if (canManageProject) setSelectedProjectKey(project.key)
                        }}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition ${
                          isSelected ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                        }`}
                        disabled={!canManageProject}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-gray-900 dark:text-white">{project.key} - {project.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{project.project_type || 'unknown type'}</p>
                        </div>
                        <CheckCircle2 size={14} className={isConnected ? 'text-emerald-500' : 'text-gray-300 dark:text-gray-600'} />
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}
            {saveMsg && !error && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 size={15} className="shrink-0" /> {saveMsg}
              </div>
            )}
            {testResult && (
              <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
                testResult.ok
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                  : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
              }`}>
                {testResult.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
                <div>
                  {testResult.ok ? (
                    <>
                      <p className="font-semibold">Connection successful!</p>
                      <p className="text-xs mt-0.5 opacity-80">Authenticated as {testResult.user || 'Jira user'}.</p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold">Connection failed</p>
                      <p className="text-xs mt-0.5 opacity-80">{testResult.error}</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ConfluenceMcpPanel({ canEditConnection, canEditBaseUrl, canManageSpace }: { canEditConnection: boolean; canEditBaseUrl: boolean; canManageSpace: boolean }) {
  const [settings, setSettings] = useState<ConfluenceSettingsResponse | null>(null)
  const [spaces, setSpaces] = useState<Array<{ id: string; key: string; name: string }>>([])
  const [search, setSearch] = useState('')
  const [selectedSpaceKey, setSelectedSpaceKey] = useState('')
  const [pendingToken, setPendingToken] = useState('')
  const [pendingBaseUrl, setPendingBaseUrl] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectingSpace, setDisconnectingSpace] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<ConfluenceTestResult | null>(null)

  const loadConfluence = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiService.getConfluenceSettings()
      setSettings(data)
      setPendingBaseUrl(data.confluence_mcp_base_url || '')
      setSelectedSpaceKey(data.confluence_space_key || '')

      if (data.confluence_token_set && data.confluence_mcp_base_url) {
        const list = await apiService.listConfluenceSpaces()
        setSpaces(list)
      } else {
        setSpaces([])
      }
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadConfluence()
  }, [])

  const filteredSpaces = spaces.filter(s => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return s.key.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
  })

  // If a space is connected, show only that space
  const displaySpaces = settings?.confluence_space_key
    ? spaces.filter(s => s.key === settings.confluence_space_key)
    : (canManageSpace ? filteredSpaces : [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaveMsg(null)
    setTestResult(null)
    try {
      const payload: { confluence_token?: string; confluence_mcp_base_url?: string } = {}
      if (pendingToken.trim()) payload.confluence_token = pendingToken.trim()
      if (canEditBaseUrl) payload.confluence_mcp_base_url = pendingBaseUrl.trim()
      const data = await apiService.saveConfluenceSettings(payload)
      setSettings(data)
      setPendingToken('')
      setSaveMsg('Saved successfully.')
      notifyConnectionStatusChanged('confluence')
      if (data.confluence_token_set && data.confluence_mcp_base_url) {
        const list = await apiService.listConfluenceSpaces()
        setSpaces(list)
      }
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setError(null)
    setTestResult(null)
    try {
      setTestResult(await apiService.testConfluenceConnection())
      notifyConnectionStatusChanged('confluence')
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setTesting(false)
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    setError(null)
    setSaveMsg(null)
    setTestResult(null)
    try {
      const data = await apiService.saveConfluenceSettings({
        confluence_token: '',
      })
      setSettings(data)
      setSaveMsg('Confluence token removed.')
      notifyConnectionStatusChanged('confluence')
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setDisconnecting(false)
    }
  }

  const handleConnectSelected = async () => {
    const selected = spaces.find(s => s.key === selectedSpaceKey)
    if (!selected) return
    setConnecting(true)
    setError(null)
    setSaveMsg(null)
    try {
      const data = await apiService.saveConfluenceSettings({
        confluence_space_key: selected.key,
        confluence_space_name: selected.name,
      })
      setSettings(data)
      setSaveMsg(`Connected space ${selected.key}.`)
      notifyConnectionStatusChanged('confluence')
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnectSpace = async () => {
    setDisconnectingSpace(true)
    setError(null)
    setSaveMsg(null)
    try {
      const data = await apiService.saveConfluenceSettings({
        confluence_space_key: '',
        confluence_space_name: '',
      })
      setSettings(data)
      setSelectedSpaceKey('')
      setSaveMsg('Confluence space disconnected.')
      notifyConnectionStatusChanged('confluence')

      if (data.confluence_token_set && data.confluence_mcp_base_url) {
        const list = await apiService.listConfluenceSpaces()
        setSpaces(list)
      }
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setDisconnectingSpace(false)
    }
  }

  const selectedIsConnected = settings?.confluence_space_key && settings.confluence_space_key === selectedSpaceKey

  return (
    <div className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft overflow-hidden">
      <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600">
          <BookOpen size={20} className="text-white" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-gray-900 dark:text-white">Confluence MCP Connection</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Configure Confluence base URL, token, test and connect a default Confluence space.</p>
        </div>
        {!loading && (
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
            settings?.confluence_token_set
              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${settings?.confluence_token_set ? 'bg-emerald-500' : 'bg-gray-400'}`} />
            {settings?.confluence_token_set ? 'Connected' : 'Not connected'}
          </span>
        )}
      </div>

      <div className="px-6 py-5 space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {settings?.confluence_token_set && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-2.5">
                <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="text-xs text-emerald-700 dark:text-emerald-300">
                  Token on file: <span className="font-mono font-semibold">{settings.confluence_token_preview}</span>
                </span>
              </div>
            )}

            <div>
              <label htmlFor="confluence-token" className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                Confluence Token
                <span className="ml-1 font-normal text-gray-400">(leave blank to keep existing)</span>
              </label>
              <input
                id="confluence-token"
                type="password"
                value={pendingToken}
                onChange={e => setPendingToken(e.target.value)}
                placeholder="Enter Confluence token"
                className="form-input w-full font-mono text-sm"
                disabled={!canEditConnection}
              />
            </div>

            <div>
              <label htmlFor="confluence-base-url" className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                Confluence Base URL
              </label>
              <input
                id="confluence-base-url"
                type="text"
                value={pendingBaseUrl}
                onChange={e => setPendingBaseUrl(e.target.value)}
                placeholder="https://your-domain.atlassian.net/wiki"
                className="form-input w-full font-mono text-sm"
                disabled={!canEditBaseUrl}
              />
              {!canEditBaseUrl && (
                <p className="mt-1 text-[11px] text-blue-500 dark:text-blue-400">
                  Confluence Base URL is managed by your Automation Lead.
                </p>
              )}
            </div>

            {settings?.confluence_space_key && (
              <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-2.5 text-xs text-blue-700 dark:text-blue-300">
                Configured space: <span className="font-semibold">{settings.confluence_space_key}</span>{settings.confluence_space_name ? ` - ${settings.confluence_space_name}` : ''}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button onClick={handleSave} disabled={saving} className="btn-primary gap-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
              </button>
              <button
                onClick={handleTest}
                disabled={testing || !settings?.confluence_token_set}
                className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-40 transition"
              >
                {testing ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />} Test Connection
              </button>
              {settings?.confluence_token_set && (
                <button
                  onClick={() => {
                    if (window.confirm('Remove Confluence token and selected space?')) {
                      void handleDisconnect()
                    }
                  }}
                  disabled={disconnecting || !canEditConnection}
                  className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-gray-700 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 transition ml-auto"
                >
                  {disconnecting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Disconnect
                </button>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  {settings?.confluence_space_key ? 'Selected Space' : 'Confluence Spaces'}
                </p>
                <div className="flex items-center gap-2">
                  {settings?.confluence_space_key && (
                    <button
                      onClick={() => {
                        if (window.confirm('Disconnect currently configured Confluence space?')) {
                          void handleDisconnectSpace()
                        }
                      }}
                      disabled={!canManageSpace || disconnectingSpace}
                      className="flex items-center gap-1 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-gray-700 px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 transition"
                    >
                      {disconnectingSpace ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Disconnect Space
                    </button>
                  )}
                  <button
                    onClick={handleConnectSelected}
                    disabled={!canManageSpace || !selectedSpaceKey || connecting || Boolean(selectedIsConnected)}
                    className="btn-primary !px-2.5 !py-1 text-xs"
                  >
                    {connecting ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} Connect Selected Space
                  </button>
                </div>
              </div>

              {!settings?.confluence_space_key && (
                <div className="relative">
                  <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search key or name"
                    className="form-input !pl-8"
                    disabled={!canManageSpace}
                  />
                </div>
              )}

              <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                {displaySpaces.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-gray-500 dark:text-gray-400">No Confluence spaces found.</div>
                ) : (
                  displaySpaces.map(space => {
                    const isSelected = space.key === selectedSpaceKey
                    const isConnected = space.key === settings?.confluence_space_key
                    return (
                      <button
                        key={space.id}
                        onClick={() => {
                          if (canManageSpace) setSelectedSpaceKey(space.key)
                        }}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition ${
                          isSelected ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                        }`}
                        disabled={!canManageSpace}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-gray-900 dark:text-white">{space.key} - {space.name}</p>
                        </div>
                        <CheckCircle2 size={14} className={isConnected ? 'text-emerald-500' : 'text-gray-300 dark:text-gray-600'} />
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}
            {saveMsg && !error && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 size={15} className="shrink-0" /> {saveMsg}
              </div>
            )}
            {testResult && (
              <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
                testResult.ok
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                  : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
              }`}>
                {testResult.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
                <div>
                  {testResult.ok ? (
                    <>
                      <p className="font-semibold">Connection successful!</p>
                      <p className="text-xs mt-0.5 opacity-80">Authenticated as {testResult.user || 'Confluence user'}.</p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold">Connection failed</p>
                      <p className="text-xs mt-0.5 opacity-80">{testResult.error}</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { section, mcp } = useParams<{ section?: string; mcp?: string }>()
  const user = useAppStore(s => s.user)
  const projects = useAppStore(s => s.projects)
  const selectedProjectId = useAppStore(s => s.selectedProjectId)

  const isProjectManager = user?.role === 'admin' || user?.role === 'automation_lead' || user?.role === 'super_admin' || user?.role === 'org_admin'
  const canManageJiraProject =
    user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'org_admin' ||
    user?.role === 'automation_lead' ||
    ((user?.role === 'automation_user' || user?.role === 'viewer') && Boolean(user?.assigned_lead_id))

  // Determine current active section (mcp takes precedence if provided)
  const activeSection = mcp ? 'mcp' : (section || 'profile')
  const activeMcp = mcp || (section && ['jira', 'confluence', 'github', 'ai'].includes(section) ? section : 'jira')
  const allowedSections = new Set(['profile', 'security', 'preferences', 'mcp'])
  const allowedMcps = new Set(['jira', 'confluence', 'github', 'ai'])
  
  if (activeSection === 'mcp' && !allowedMcps.has(activeMcp)) {
    return <Navigate to="/settings/mcp/jira" replace />
  }
  if (!allowedSections.has(activeSection) && !['jira', 'confluence', 'github', 'ai'].includes(activeSection)) {
    return <Navigate to="/settings/profile" replace />
  }

  // Which project to show per-project settings for
  const activeProject = projects.find(p => p.id === selectedProjectId) ?? projects[0]

  const profileItems: Array<{ id: string; label: string; description: string; icon: any }> = [
    { id: 'profile', label: 'My Profile', description: 'Password, email, picture', icon: User },
  ]

  const securityItems: Array<{ id: string; label: string; description: string; icon: any }> = [
    { id: 'security', label: 'Security', description: 'Sessions, API tokens, login history', icon: Lock },
    { id: 'preferences', label: 'Preferences', description: 'Theme, AI, notifications', icon: Sliders },
  ]

  const mcpItems: Array<{ id: string; label: string; description: string; icon: any }> = [
    { id: 'jira', label: 'Jira', description: 'Token, URL, project', icon: Settings2 },
    { id: 'confluence', label: 'Confluence', description: 'Token, URL, space', icon: BookOpen },
    { id: 'github', label: 'Project GitHub', description: 'Per-project GitHub connection', icon: Github },
    { id: 'ai', label: 'AI Assistant', description: 'GitHub Copilot, Claude, Microsoft 365 Copilot', icon: Bot },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
          <Settings2 size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Settings</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Configure your account, preferences, and integrations.</p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-2xl border border-gray-200/80 bg-white p-2 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90 flex flex-col min-h-0">
          <nav className="space-y-1 min-h-0 overflow-y-auto">
            {/* Account Section */}
            <div className="px-2 py-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400 px-1 mb-2">Account</p>
              <div className="space-y-1">
                {profileItems.map(item => {
                  const Icon = item.icon
                  const isActive = activeSection === item.id
                  return (
                    <NavLink
                      key={item.id}
                      to={`/settings/${item.id}`}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2 transition ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/60'
                      }`}
                    >
                      <Icon size={16} className="shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{item.label}</span>
                        <span className="block truncate text-[11px] opacity-75">{item.description}</span>
                      </span>
                    </NavLink>
                  )
                })}
              </div>
            </div>

            {/* General Settings Section */}
            <div className="px-2 py-2 border-t border-gray-200 dark:border-gray-700">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400 px-1 mb-2">Preferences</p>
              <div className="space-y-1">
                {securityItems.map(item => {
                  const Icon = item.icon
                  const isActive = activeSection === item.id
                  return (
                    <NavLink
                      key={item.id}
                      to={`/settings/${item.id}`}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2 transition ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/60'
                      }`}
                    >
                      <Icon size={16} className="shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{item.label}</span>
                        <span className="block truncate text-[11px] opacity-75">{item.description}</span>
                      </span>
                    </NavLink>
                  )
                })}
              </div>
            </div>

            {/* MCP's Settings Section */}
            <div className="px-2 py-2 border-t border-gray-200 dark:border-gray-700">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400 px-1 mb-2">MCP Settings</p>
              <div className="space-y-1">
                {mcpItems.map(item => {
                  const Icon = item.icon
                  const isActive = activeSection === 'mcp' && activeMcp === item.id
                  return (
                    <NavLink
                      key={item.id}
                      to={`/settings/mcp/${item.id}`}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2 transition ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/60'
                      }`}
                    >
                      <Icon size={16} className="shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{item.label}</span>
                        <span className="block truncate text-[11px] opacity-75">{item.description}</span>
                      </span>
                    </NavLink>
                  )
                })}
              </div>
            </div>
          </nav>
        </aside>

        <section className="min-h-0 overflow-y-auto">
          {activeSection === 'profile' && (
            <>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                User Profile Settings
              </h2>
              <UserProfilePanel />
            </>
          )}

          {activeSection === 'security' && (
            <>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                Security Settings
              </h2>
              <SecuritySettingsPanel />
            </>
          )}

          {activeSection === 'preferences' && (
            <>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                Preferences & Display
              </h2>
              <PreferencesSettingsPanel />
            </>
          )}

          {activeSection === 'mcp' && activeMcp === 'jira' && (
            <>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                Jira MCP Server Connection
              </h2>
              <JiraMcpPanel canEditConnection={true} canEditBaseUrl={isProjectManager} canManageProject={canManageJiraProject} />
            </>
          )}

          {activeSection === 'mcp' && activeMcp === 'confluence' && (
            <>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                Confluence MCP Server Connection
              </h2>
              <ConfluenceMcpPanel canEditConnection={true} canEditBaseUrl={isProjectManager} canManageSpace={canManageJiraProject} />
            </>
          )}

          {activeSection === 'mcp' && activeMcp === 'ai' && (
            <>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                AI Assistant Connection
              </h2>
              <AiAssistantPanel />
            </>
          )}

          {activeSection === 'mcp' && activeMcp === 'github' && (
            <>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                Project GitHub Connection
              </h2>
              {!isProjectManager && (
                <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                  Project-level GitHub settings are managed by your assigned Automation Lead.
                </div>
              )}
              {projects.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No projects available. Create a project first.
                </div>
              ) : (
                <div className="space-y-4">
                  {projects.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {projects.map(p => (
                        <button
                          key={p.id}
                          onClick={() => useAppStore.getState().setSelectedProjectId(p.id)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                            (selectedProjectId ?? projects[0].id) === p.id
                              ? 'bg-blue-600 text-white shadow'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {activeProject && (
                    <ProjectGitHubPanel
                      key={`${user?.id ?? 'anon'}-${activeProject.id}`}
                      projectId={activeProject.id}
                      projectName={activeProject.name}
                      canEdit={isProjectManager}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
