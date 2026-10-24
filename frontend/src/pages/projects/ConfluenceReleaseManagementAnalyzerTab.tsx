import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  ExternalLink,
  Info,
  ListChecks,
  Loader2,
  RefreshCcw,
  Server,
  Settings,
  Smartphone,
} from 'lucide-react'
import { apiService, CONNECTION_STATUS_CHANGED_EVENT } from '@/services/api'
import type { ConfluencePageItem, ReleaseAnalysisResponse, ReleaseAnalysisTicketItem } from '@/types/domain'

const CONFLUENCE_ANALYZER_SPLIT_STORAGE_KEY = 'projects.confluence.analyzer.leftPanelWidth'
const AUTOMATABLE_STATUSES = new Set([
  'done',
  'ready for production',
  'ready for prelive',
  'in production',
])
const JIRA_PRIORITY_OPTIONS = ['Highest', 'High', 'Medium', 'Low', 'Lowest']
type AutomationSelection = 'yes' | 'no' | 'no_already_automated'

function isAutomatableStatus(status?: string | null): boolean {
  const normalized = (status || '').trim().toLowerCase()
  return AUTOMATABLE_STATUSES.has(normalized)
}

interface CreateTicketFormState {
  sourceKey: string
  sourceUrl?: string
  sourceType?: string
  sourceStatus?: string
  summary: string
  description: string
  priority: string
  components: string
  teamName: string
  epicLink: string
}

interface ConfluenceSettingsView {
  confluence_token_set: boolean
  confluence_space_key?: string | null
  confluence_space_name?: string | null
  confluence_release_container_id?: string | null
  confluence_release_container_title?: string | null
  confluence_release_container_url?: string | null
  confluence_selected_release_page_id?: string | null
  confluence_selected_release_page_title?: string | null
  confluence_selected_release_page_url?: string | null
}

function colorClassesFromConfluenceToken(color?: string | null): string {
  const token = (color || '').trim().toLowerCase()
  if (!token) {
    return 'border-gray-200 bg-gray-100 text-gray-700 dark:border-gray-600 dark:bg-gray-700/70 dark:text-gray-200'
  }
  if (token.includes('green')) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
  }
  if (token.includes('yellow') || token.includes('amber')) {
    return 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
  }
  if (token.includes('red')) {
    return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-200'
  }
  if (token.includes('blue')) {
    return 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
  }
  if (token.includes('purple')) {
    return 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-200'
  }
  if (token.includes('teal') || token.includes('cyan')) {
    return 'border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-200'
  }
  if (token.includes('orange')) {
    return 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-700 dark:bg-orange-900/30 dark:text-orange-200'
  }
  if (token.includes('grey') || token.includes('gray')) {
    return 'border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-600 dark:bg-slate-700/70 dark:text-slate-200'
  }
  return 'border-gray-200 bg-gray-100 text-gray-700 dark:border-gray-600 dark:bg-gray-700/70 dark:text-gray-200'
}

function normalizeMultilineConfig(text?: string | null): string {
  const raw = (text || '').replace(/\r\n?/g, '\n').trim()
  if (!raw) return ''

  let formatted = raw.replace(/\s*\n\s*/g, '\n')
  if (!formatted.includes('\n')) {
    formatted = formatted
      .replace(/\s*;\s*/g, ';\n')
      .replace(/\s+\|\s+/g, '\n')
  }
  return formatted
}

function renderColoredValue(value?: string | null, color?: string | null) {
  const text = (value || '').trim()
  if (!text) {
    return <span className="text-gray-400 dark:text-gray-500">-</span>
  }
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${colorClassesFromConfluenceToken(color)}`}
      title={color ? `Confluence color: ${color}` : undefined}
    >
      <span className="truncate">{text}</span>
    </span>
  )
}

export default function ConfluenceReleaseManagementAnalyzerTab() {
  const [settings, setSettings] = useState<ConfluenceSettingsView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [analysis, setAnalysis] = useState<ReleaseAnalysisResponse | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [releasePagesLoading, setReleasePagesLoading] = useState(false)
  const [releasePagesError, setReleasePagesError] = useState<string | null>(null)
  const [releasePages, setReleasePages] = useState<ConfluencePageItem[]>([])
  const [quickReleaseId, setQuickReleaseId] = useState('')
  const [quickSaveLoading, setQuickSaveLoading] = useState(false)
  const [quickSaveError, setQuickSaveError] = useState<string | null>(null)
  const [quickSaveMsg, setQuickSaveMsg] = useState<string | null>(null)
  const [ticketSearch, setTicketSearch] = useState('')
  const [ticketKeyFilter, setTicketKeyFilter] = useState('')
  const [ticketSummaryFilter, setTicketSummaryFilter] = useState('')
  const [ticketTypeFilter, setTicketTypeFilter] = useState('')
  const [ticketStatusFilter, setTicketStatusFilter] = useState('')
  const [ticketTeamFilter, setTicketTeamFilter] = useState('')
  const [ticketEpicFilter, setTicketEpicFilter] = useState('')
  const [ticketComponentsFilter, setTicketComponentsFilter] = useState('')
  const [jiraBaseUrl, setJiraBaseUrl] = useState('')
  const [jiraProjectKey, setJiraProjectKey] = useState('')
  const [ticketAutomationState, setTicketAutomationState] = useState<Record<string, AutomationSelection>>({})
  const [automationTicketIds, setAutomationTicketIds] = useState<Record<string, string>>({})
  const [createTicketState, setCreateTicketState] = useState<CreateTicketFormState | null>(null)
  const [createTicketSubmitting, setCreateTicketSubmitting] = useState(false)
  const [createTicketError, setCreateTicketError] = useState<string | null>(null)

  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return 34
    const raw = Number(window.localStorage.getItem(CONFLUENCE_ANALYZER_SPLIT_STORAGE_KEY) || '')
    return Number.isFinite(raw) ? Math.min(60, Math.max(24, raw)) : 34
  })
  const [isResizing, setIsResizing] = useState(false)
  const panelsRef = useRef<HTMLDivElement | null>(null)

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const confluenceSettings = await apiService.getConfluenceSettings()
      setSettings(confluenceSettings)
      return confluenceSettings
    } catch (e) {
      setError(apiService.errorMessage(e))
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const loadReleasePages = useCallback(async (containerId?: string) => {
    if (!containerId) {
      setReleasePages([])
      setReleasePagesError(null)
      return
    }

    setReleasePagesLoading(true)
    setReleasePagesError(null)
    try {
      const pages = await apiService.listConfluenceReleasePages(containerId)
      setReleasePages(pages)
    } catch (e) {
      setReleasePages([])
      setReleasePagesError(apiService.errorMessage(e))
    } finally {
      setReleasePagesLoading(false)
    }
  }, [])

  const runAnalysis = useCallback(async (pageId?: string) => {
    if (!pageId) {
      setAnalysis(null)
      return
    }
    setAnalysisLoading(true)
    setAnalysisError(null)
    try {
      const result = await apiService.analyzeConfluenceReleasePage(pageId)
      setAnalysis(result)
    } catch (e) {
      setAnalysisError(apiService.errorMessage(e))
      setAnalysis(null)
    } finally {
      setAnalysisLoading(false)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const confluenceSettings = await loadSettings()
      if (!mounted) return
      if (confluenceSettings?.confluence_selected_release_page_id) {
        await runAnalysis(confluenceSettings.confluence_selected_release_page_id)
      }
    })()
    return () => {
      mounted = false
    }
  }, [loadSettings, runAnalysis])

  // If the Confluence connection (token, base URL or linked space/release
  // page) is changed/reset from Settings, drop the stale analysis and
  // reload fresh — otherwise this page would keep showing results fetched
  // under the previous configuration.
  useEffect(() => {
    const onConnectionChanged = (event: Event) => {
      const kind = (event as CustomEvent<{ kind?: 'github' | 'jira' | 'confluence' }>).detail?.kind
      if (kind !== 'confluence') return
      setAnalysis(null)
      setAnalysisError(null)
      setReleasePages([])
      setQuickSaveError(null)
      setQuickSaveMsg(null)
      void (async () => {
        const confluenceSettings = await loadSettings()
        if (confluenceSettings?.confluence_selected_release_page_id) {
          await runAnalysis(confluenceSettings.confluence_selected_release_page_id)
        }
      })()
    }
    window.addEventListener(CONNECTION_STATUS_CHANGED_EVENT, onConnectionChanged)
    return () => window.removeEventListener(CONNECTION_STATUS_CHANGED_EVENT, onConnectionChanged)
  }, [loadSettings, runAnalysis])

  const loadJiraSettingsForTicketing = async () => {
    try {
      const jiraSettings = await apiService.getJiraSettings()
      setJiraBaseUrl(jiraSettings.jira_mcp_base_url || '')
      setJiraProjectKey(jiraSettings.jira_project_key || '')
    } catch {
      // Jira base URL is optional here — the "Create Jira Ticket" popup simply
      // won't be able to submit if it's not configured.
    }
  }

  useEffect(() => {
    void loadJiraSettingsForTicketing()
  }, [])

  // If the Jira connection is changed/reset from Settings, reload the
  // project/base URL used by "Create Jira Ticket" and drop any ticket ids
  // that were tied to the previous connection.
  useEffect(() => {
    const onConnectionChanged = (event: Event) => {
      const kind = (event as CustomEvent<{ kind?: 'github' | 'jira' | 'confluence' }>).detail?.kind
      if (kind !== 'jira') return
      setTicketAutomationState({})
      setAutomationTicketIds({})
      void loadJiraSettingsForTicketing()
    }
    window.addEventListener(CONNECTION_STATUS_CHANGED_EVENT, onConnectionChanged)
    return () => window.removeEventListener(CONNECTION_STATUS_CHANGED_EVENT, onConnectionChanged)
  }, [])

  useEffect(() => {
    const containerId = settings?.confluence_release_container_id || ''
    if (containerId) {
      void loadReleasePages(containerId)
    } else {
      setReleasePages([])
      setReleasePagesError(null)
    }
  }, [settings?.confluence_release_container_id, loadReleasePages])

  useEffect(() => {
    setQuickReleaseId(settings?.confluence_selected_release_page_id || '')
  }, [settings?.confluence_selected_release_page_id])

  useEffect(() => {
    if (!isResizing) return

    const onMove = (event: MouseEvent) => {
      const container = panelsRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return

      const raw = ((event.clientX - rect.left) / rect.width) * 100
      const clamped = Math.min(60, Math.max(24, raw))
      setLeftPanelWidth(clamped)
    }

    const onUp = () => setIsResizing(false)

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isResizing])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(CONFLUENCE_ANALYZER_SPLIT_STORAGE_KEY, String(leftPanelWidth))
  }, [leftPanelWidth])

  const hasConfluenceConnection = Boolean(settings?.confluence_token_set && settings?.confluence_space_key)
  const hasSelectedRelease = Boolean(settings?.confluence_selected_release_page_id)

  const handleQuickChangeReleasePage = useCallback(async (nextReleaseId: string) => {
    const selected = releasePages.find(p => p.id === nextReleaseId)
    if (!selected) {
      setQuickSaveError('Select a release page first.')
      setQuickSaveMsg(null)
      return
    }

    setQuickSaveLoading(true)
    setQuickSaveError(null)
    setQuickSaveMsg(null)
    try {
      const updated = await apiService.saveConfluenceSettings({
        confluence_selected_release_page_id: selected.id,
        confluence_selected_release_page_title: selected.title,
        confluence_selected_release_page_url: selected.url,
      })
      setSettings(updated)
      setQuickSaveMsg('Release page updated. Analyzer refreshed.')
      await runAnalysis(selected.id)
    } catch (e) {
      setQuickSaveError(apiService.errorMessage(e))
    } finally {
      setQuickSaveLoading(false)
    }
  }, [releasePages, runAnalysis])

  const backendVersions = useMemo(() => analysis?.backend_versions ?? [], [analysis])
  const frontendVersions = useMemo(() => analysis?.frontend_versions ?? [], [analysis])
  const additionalTickets = useMemo(() => analysis?.additional_tickets ?? [], [analysis])
  const additionalTicketsError = analysis?.additional_tickets_error ?? null
  const releaseMetadata = analysis?.release_metadata ?? null
  const hasReleaseMetadata = Boolean(releaseMetadata?.release_date || releaseMetadata?.status || releaseMetadata?.team)

  const showComponentCol = useMemo(() => backendVersions.some(v => v.component), [backendVersions])
  const showLiveEnvCol = useMemo(() => backendVersions.some(v => v.live_env_details), [backendVersions])
  const showNewServiceCol = useMemo(() => backendVersions.some(v => v.new_service_or_operation), [backendVersions])
  const showDeveloperCol = useMemo(() => backendVersions.some(v => v.developer), [backendVersions])

  const ticketTypeOptions = useMemo(
    () => Array.from(new Set(additionalTickets.map(t => (t.issue_type || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [additionalTickets],
  )
  const ticketStatusOptions = useMemo(
    () => Array.from(new Set(additionalTickets.map(t => (t.status || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [additionalTickets],
  )
  const ticketTeamOptions = useMemo(
    () => Array.from(new Set(additionalTickets.map(t => (t.team_name || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [additionalTickets],
  )
  const ticketEpicOptions = useMemo(
    () => Array.from(new Set(additionalTickets.map(t => (t.epic_link || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [additionalTickets],
  )
  const ticketComponentsOptions = useMemo(
    () => Array.from(new Set(additionalTickets.map(t => (t.components || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [additionalTickets],
  )

  const filteredAdditionalTickets = useMemo(() => {
    const q = ticketSearch.trim().toLowerCase()
    const keyQ = ticketKeyFilter.trim().toLowerCase()
    const summaryQ = ticketSummaryFilter.trim().toLowerCase()

    return additionalTickets.filter((item) => {
      const key = (item.key || '').toLowerCase()
      const summary = (item.summary || '').toLowerCase()
      const issueType = item.issue_type || ''
      const status = item.status || ''
      const team = item.team_name || ''
      const epic = item.epic_link || ''
      const components = item.components || ''

      if (q && !key.includes(q) && !summary.includes(q)) return false
      if (keyQ && !key.includes(keyQ)) return false
      if (summaryQ && !summary.includes(summaryQ)) return false
      if (ticketTypeFilter && issueType !== ticketTypeFilter) return false
      if (ticketStatusFilter && status !== ticketStatusFilter) return false
      if (ticketTeamFilter && team !== ticketTeamFilter) return false
      if (ticketEpicFilter && epic !== ticketEpicFilter) return false
      if (ticketComponentsFilter && components !== ticketComponentsFilter) return false
      return true
    })
  }, [
    additionalTickets,
    ticketSearch,
    ticketKeyFilter,
    ticketSummaryFilter,
    ticketTypeFilter,
    ticketStatusFilter,
    ticketTeamFilter,
    ticketEpicFilter,
    ticketComponentsFilter,
  ])

  const clearTicketFilters = () => {
    setTicketSearch('')
    setTicketKeyFilter('')
    setTicketSummaryFilter('')
    setTicketTypeFilter('')
    setTicketStatusFilter('')
    setTicketTeamFilter('')
    setTicketEpicFilter('')
    setTicketComponentsFilter('')
  }

  const openCreateTicketModal = (item: ReleaseAnalysisTicketItem) => {
    setCreateTicketError(null)
    setCreateTicketState({
      sourceKey: item.key,
      sourceUrl: item.url || undefined,
      sourceType: item.issue_type || undefined,
      sourceStatus: item.status || undefined,
      summary: `Automation needed: ${item.key} (Team: ${item.team_name || 'Unassigned'})`,
      description: `Automate test coverage for ${item.key}${item.summary ? ` - ${item.summary}` : ''}.`,
      priority: '',
      components: item.components || '',
      teamName: item.team_name || '',
      epicLink: item.epic_link || '',
    })
  }

  const handleToBeAutomatedChange = (item: ReleaseAnalysisTicketItem, value: AutomationSelection) => {
    setTicketAutomationState(prev => ({ ...prev, [item.key]: value }))
    if (value !== 'no_already_automated') {
      setAutomationTicketIds(prev => {
        const next = { ...prev }
        delete next[item.key]
        return next
      })
    }
    if (value === 'yes') {
      openCreateTicketModal(item)
    }
  }

  const handleAutomationTicketIdChange = (key: string, rawValue: string) => {
    const normalized = rawValue.trim().toUpperCase()
    if (!normalized) {
      setAutomationTicketIds(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      return
    }
    setAutomationTicketIds(prev => ({ ...prev, [key]: normalized }))
  }

  const handleCreateTicketSubmit = async () => {
    if (!createTicketState) return
    if (!createTicketState.summary.trim()) {
      setCreateTicketError('Summary is required.')
      return
    }
    setCreateTicketSubmitting(true)
    setCreateTicketError(null)
    try {
      const result = await apiService.createJiraTicket({
        project_key: jiraProjectKey || undefined,
        issue_type: 'Task',
        source_issue_key: createTicketState.sourceKey,
        summary: createTicketState.summary.trim(),
        description: createTicketState.description.trim() || undefined,
        priority: createTicketState.priority || undefined,
        components: createTicketState.components.trim() || undefined,
        team_name: createTicketState.teamName.trim() || undefined,
        epic_link: createTicketState.epicLink.trim() || undefined,
      })
      setAutomationTicketIds(prev => ({ ...prev, [createTicketState.sourceKey]: result.key }))
      setCreateTicketState(null)
    } catch (e) {
      setCreateTicketError(apiService.errorMessage(e))
    } finally {
      setCreateTicketSubmitting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">

      {loading ? (
        <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 size={16} className="animate-spin" /> Loading analyzer...
        </div>
      ) : error ? (
        <div className="flex h-full items-center justify-center px-6 text-sm text-red-600 dark:text-red-400">{error}</div>
      ) : !hasConfluenceConnection ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <BookOpen size={30} className="text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Confluence is not fully configured</p>
          <Link to="/settings/confluence" className="btn-primary mt-1">
            <Settings size={14} /> Open Confluence Settings
          </Link>
        </div>
      ) : (
        <div
          ref={panelsRef}
          className={`flex min-h-0 flex-1 flex-col gap-3 md:flex-row md:gap-0 ${isResizing ? 'select-none' : ''}`}
        >
          <section
            className="flex min-h-[180px] min-w-0 shrink-0 flex-col overflow-y-auto rounded-2xl border border-gray-200/80 bg-white p-4 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90 md:min-h-0 md:rounded-r-none"
            style={{ width: `clamp(260px, ${leftPanelWidth}%, 60%)` }}
          >
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Configuration Summary</h3>
            <dl className="mt-3 space-y-3 text-xs">
              <div>
                <dt className="text-gray-500 dark:text-gray-400">Space</dt>
                <dd className="font-medium text-gray-800 dark:text-gray-200">
                  {settings?.confluence_space_key}{settings?.confluence_space_name ? ` - ${settings.confluence_space_name}` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500 dark:text-gray-400">Main release container</dt>
                <dd className="font-medium text-gray-800 dark:text-gray-200">{settings?.confluence_release_container_title || 'Not linked'}</dd>
              </div>
              <div>
                <dt className="text-gray-500 dark:text-gray-400">Quick change release page</dt>
                <dd className="mt-1 space-y-2">
                  <div>
                    <select
                      value={quickReleaseId}
                      onChange={e => {
                        const nextId = e.target.value
                        setQuickReleaseId(nextId)
                        if (!nextId || nextId === settings?.confluence_selected_release_page_id) {
                          return
                        }
                        void handleQuickChangeReleasePage(nextId)
                      }}
                      disabled={releasePagesLoading || quickSaveLoading || !settings?.confluence_release_container_id}
                      className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                    >
                      <option value="">Select release page</option>
                      {releasePages.map(page => (
                        <option key={page.id} value={page.id}>{page.title}</option>
                      ))}
                    </select>
                  </div>
                  {releasePagesLoading && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Loading release pages...</p>
                  )}
                  {quickSaveLoading && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Updating release page and refreshing analyzer...</p>
                  )}
                  {releasePagesError && (
                    <p className="text-[11px] text-red-600 dark:text-red-400">{releasePagesError}</p>
                  )}
                  {quickSaveError && (
                    <p className="text-[11px] text-red-600 dark:text-red-400">{quickSaveError}</p>
                  )}
                  {quickSaveMsg && (
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-300">{quickSaveMsg}</p>
                  )}
                </dd>
              </div>

              <div>
                <dt className="text-gray-500 dark:text-gray-400">Selected release page</dt>
                {hasSelectedRelease ? (
                  <dd className="mt-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-800 dark:bg-emerald-900/20">
                    <p className="font-semibold text-emerald-700 dark:text-emerald-300">{settings?.confluence_selected_release_page_title}</p>
                    {settings?.confluence_selected_release_page_url && (
                      <a
                        href={settings.confluence_selected_release_page_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-emerald-700 underline dark:text-emerald-300"
                      >
                        Open release page <ExternalLink size={11} />
                      </a>
                    )}
                  </dd>
                ) : (
                  <dd className="font-medium text-gray-800 dark:text-gray-200">Not selected</dd>
                )}
              </div>
            </dl>

            {!hasSelectedRelease && (
              <Link to="/work/confluence" className="btn-primary mt-4 !w-full justify-center">
                Select a release page
              </Link>
            )}
          </section>

          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize analyzer panels"
            onMouseDown={() => setIsResizing(true)}
            className="hidden w-2 cursor-col-resize items-stretch justify-center md:flex"
            title="Drag to resize panels"
          >
            <div className={`w-px rounded-full transition-colors ${isResizing ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-700'}`} />
          </div>

          <section className="flex min-h-[180px] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90 md:min-h-0 md:rounded-l-none">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <BarChart3 size={16} className="text-blue-500" />
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Quick Analyzer</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Scans the selected release page for BE service versions and FE Android/iOS build versions.
                  </p>
                </div>
              </div>
              <button
                onClick={() => void runAnalysis(settings?.confluence_selected_release_page_id || undefined)}
                disabled={analysisLoading || !hasSelectedRelease}
                className="btn-ghost !px-2 !py-1 text-xs"
                title="Re-run analysis"
              >
                <RefreshCcw size={12} className={analysisLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {!hasSelectedRelease ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Select a release page in Release Page Configuration to run the analyzer.
                </p>
              ) : analysisLoading ? (
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <Loader2 size={14} className="animate-spin" /> Analyzing release page...
                </div>
              ) : analysisError ? (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" /> {analysisError}
                </div>
              ) : (
                <div className="space-y-5">
                  {hasReleaseMetadata && (
                    <div>
                      <div className="mb-2 flex items-center gap-2">
                        <Info size={14} className="text-blue-500" />
                        <h4 className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                          General Information
                        </h4>
                      </div>
                      <div className="grid grid-cols-1 gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-700/30 sm:grid-cols-3">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Release Date</p>
                          <p className="font-medium text-gray-800 dark:text-gray-200">{releaseMetadata?.release_date || 'Not mentioned'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Status</p>
                          <p className="font-medium text-gray-800 dark:text-gray-200">{releaseMetadata?.status || 'Not mentioned'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Team</p>
                          <p className="font-medium text-gray-800 dark:text-gray-200">{releaseMetadata?.team || 'Not mentioned'}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <Server size={14} className="text-indigo-500" />
                      <h4 className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                        Backend service versions
                      </h4>
                    </div>

                    {backendVersions.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        No backend service version mentions were detected on this page.
                      </p>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-700">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 dark:bg-gray-700/40">
                            <tr>
                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Service</th>
                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Version</th>
                              {showComponentCol && (
                                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Component</th>
                              )}
                              {showLiveEnvCol && (
                                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">LIVE ENV Details</th>
                              )}
                              {showNewServiceCol && (
                                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">New service/operation</th>
                              )}
                              {showDeveloperCol && (
                                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Developer</th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                            {backendVersions.map((item, idx) => (
                              <tr key={`${item.service}-${item.version}-${idx}`}>
                                <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">{item.service}</td>
                                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">{item.version}</td>
                                {showComponentCol && (
                                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                                    {renderColoredValue(item.component, item.component_color)}
                                  </td>
                                )}
                                {showLiveEnvCol && (
                                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                                    {item.live_env_details ? (
                                      <pre
                                        className={`max-h-44 overflow-auto rounded-md border px-2 py-1 font-mono text-[11px] leading-5 whitespace-pre-wrap break-words ${colorClassesFromConfluenceToken(item.live_env_details_color)}`}
                                        title={item.live_env_details_color ? `Confluence color: ${item.live_env_details_color}` : undefined}
                                      >
                                        {normalizeMultilineConfig(item.live_env_details)}
                                      </pre>
                                    ) : (
                                      '-'
                                    )}
                                  </td>
                                )}
                                {showNewServiceCol && (
                                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                                    {renderColoredValue(item.new_service_or_operation, item.new_service_or_operation_color)}
                                  </td>
                                )}
                                {showDeveloperCol && (
                                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                                    {renderColoredValue(item.developer, item.developer_color)}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <Smartphone size={14} className="text-purple-500" />
                      <h4 className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                        Frontend Android/iOS build versions
                      </h4>
                    </div>
                    {frontendVersions.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        No Android/iOS build version mentions were detected on this page.
                      </p>
                    ) : (
                      <div className="overflow-hidden rounded-lg border border-gray-100 dark:border-gray-700">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 dark:bg-gray-700/40">
                            <tr>
                              <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Technology</th>
                              <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Version</th>
                              <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Environment</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                            {frontendVersions.map((item, idx) => (
                              <tr key={`${item.platform}-${item.version}-${idx}`}>
                                <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">{item.platform}</td>
                                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">{item.version}</td>
                                <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{item.environment || 'Not mentioned'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <ListChecks size={14} className="text-emerald-500" />
                      <h4 className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                        Additional information
                      </h4>
                    </div>
                    <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                      Info: <span className="font-medium">To Be Automated</span> is available only for tickets with status
                      {' '}<span className="font-medium">Done</span>, <span className="font-medium">Ready For Production</span>,
                      {' '}<span className="font-medium">Ready For Prelive</span> or <span className="font-medium">In Production</span>.
                    </div>
                    {additionalTicketsError ? (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                        <AlertCircle size={13} className="mt-0.5 shrink-0" /> {additionalTicketsError}
                      </div>
                    ) : additionalTickets.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        No Stories/Technical stories/Bugs/Tasks were detected on this page.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <div className="grid grid-cols-1 gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-700/30 xl:grid-cols-5">
                          <input
                            type="text"
                            value={ticketSearch}
                            onChange={(e) => setTicketSearch(e.target.value)}
                            placeholder="Search key/summary"
                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                          />
                          <input
                            type="text"
                            value={ticketKeyFilter}
                            onChange={(e) => setTicketKeyFilter(e.target.value)}
                            placeholder="Filter Key"
                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                          />
                          <input
                            type="text"
                            value={ticketSummaryFilter}
                            onChange={(e) => setTicketSummaryFilter(e.target.value)}
                            placeholder="Filter Summary"
                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                          />
                          <select
                            value={ticketTypeFilter}
                            onChange={(e) => setTicketTypeFilter(e.target.value)}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                          >
                            <option value="">All Types</option>
                            {ticketTypeOptions.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          <select
                            value={ticketStatusFilter}
                            onChange={(e) => setTicketStatusFilter(e.target.value)}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                          >
                            <option value="">All Statuses</option>
                            {ticketStatusOptions.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          <select
                            value={ticketTeamFilter}
                            onChange={(e) => setTicketTeamFilter(e.target.value)}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                          >
                            <option value="">All Teams</option>
                            {ticketTeamOptions.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          <select
                            value={ticketEpicFilter}
                            onChange={(e) => setTicketEpicFilter(e.target.value)}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                          >
                            <option value="">All Epic Links</option>
                            {ticketEpicOptions.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          <select
                            value={ticketComponentsFilter}
                            onChange={(e) => setTicketComponentsFilter(e.target.value)}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                          >
                            <option value="">All Component/s</option>
                            {ticketComponentsOptions.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={clearTicketFilters}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                          >
                            Clear filters
                          </button>
                        </div>

                        <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-700">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 dark:bg-gray-700/40">
                            <tr>
                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Key</th>
                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Summary</th>
                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Type</th>
                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Status</th>
                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Team Name</th>
                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Epic Link</th>
                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Component/s</th>
                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">To Be Automated</th>
                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Automation Jira Ticket</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                            {filteredAdditionalTickets.map(item => (
                              <tr key={item.key}>
                                <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-700 dark:text-gray-300">
                                  {item.url ? (
                                    <a href={item.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">
                                      {item.key}
                                    </a>
                                  ) : item.key}
                                </td>
                                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{item.summary || '-'}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-gray-400">{item.issue_type || '-'}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-gray-400">{item.status || '-'}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-gray-400">{item.team_name || '-'}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-gray-400">{item.epic_link || '-'}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-gray-400">{item.components || '-'}</td>
                                <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                                  {isAutomatableStatus(item.status) ? (
                                    <div className="min-w-[180px] space-y-1.5">
                                      <select
                                        value={ticketAutomationState[item.key] || ''}
                                        onChange={(e) => {
                                          const value = e.target.value
                                          if (value === 'yes' || value === 'no' || value === 'no_already_automated') {
                                            handleToBeAutomatedChange(item, value)
                                          }
                                        }}
                                        className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                                      >
                                        <option value="">Select</option>
                                        <option value="yes">Yes</option>
                                        <option value="no">No</option>
                                        <option value="no_already_automated">No, already automated</option>
                                      </select>
                                      {ticketAutomationState[item.key] === 'yes' && !automationTicketIds[item.key] && (
                                        <button
                                          type="button"
                                          onClick={() => openCreateTicketModal(item)}
                                          className="text-[11px] font-semibold text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
                                        >
                                          Create Jira Ticket
                                        </button>
                                      )}
                                      {ticketAutomationState[item.key] === 'no_already_automated' && (
                                        <input
                                          type="text"
                                          value={automationTicketIds[item.key] || ''}
                                          onChange={(e) => handleAutomationTicketIdChange(item.key, e.target.value)}
                                          placeholder="Insert Jira ID (ex: ATM-123)"
                                          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                                        />
                                      )}
                                    </div>
                                  ) : (
                                    '-'
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-gray-400">
                                  {automationTicketIds[item.key] ? (
                                    jiraBaseUrl ? (
                                      <a
                                        href={`${jiraBaseUrl}/browse/${automationTicketIds[item.key]}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="font-mono text-blue-600 hover:underline dark:text-blue-400"
                                      >
                                        {automationTicketIds[item.key]}
                                      </a>
                                    ) : (
                                      <span className="font-mono">{automationTicketIds[item.key]}</span>
                                    )
                                  ) : (
                                    '-'
                                  )}
                                </td>
                              </tr>
                            ))}
                            {filteredAdditionalTickets.length === 0 && (
                              <tr>
                                <td colSpan={9} className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                                  No tickets match the current search/filter criteria.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      </div>
                    )}
                  </div>

                  <p className="text-[11px] text-gray-400 dark:text-gray-500">
                    Results are heuristically extracted from page headings, tables and text. Always verify against{' '}
                    {analysis?.page_url ? (
                      <a href={analysis.page_url} target="_blank" rel="noreferrer" className="underline hover:text-blue-500">
                        the original release page
                      </a>
                    ) : 'the original release page'}.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {createTicketState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl dark:bg-gray-800">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Create Jira Ticket</h4>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              <span className="font-medium">{createTicketState.sourceKey}</span> was marked as "To be automated". This creates the ticket directly through your configured Jira connection.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Linked To</label>
                <div className="mt-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-700/40 dark:text-gray-200">
                  {createTicketState.sourceUrl ? (
                    <a
                      href={createTicketState.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {createTicketState.sourceKey}
                    </a>
                  ) : (
                    <span className="font-mono">{createTicketState.sourceKey}</span>
                  )}
                  {(createTicketState.sourceType || createTicketState.sourceStatus) && (
                    <span className="ml-2 text-gray-500 dark:text-gray-400">
                      ({createTicketState.sourceType || 'Issue'}{createTicketState.sourceStatus ? `, ${createTicketState.sourceStatus}` : ''})
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Project</label>
                <p className="mt-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-700/40 dark:text-gray-200">
                  {jiraProjectKey || 'Not configured'}
                </p>
              </div>

              <div>
                <label className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Issue Type *</label>
                <input
                  type="text"
                  value="Task"
                  readOnly
                  className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-700/40 dark:text-gray-200"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Summary *</label>
                <input
                  type="text"
                  value={createTicketState.summary}
                  onChange={(e) => setCreateTicketState(prev => prev && { ...prev, summary: e.target.value })}
                  className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Description</label>
                <textarea
                  value={createTicketState.description}
                  onChange={(e) => setCreateTicketState(prev => prev && { ...prev, description: e.target.value })}
                  rows={3}
                  className="mt-1 w-full resize-none rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Priority</label>
                  <select
                    value={createTicketState.priority}
                    onChange={(e) => setCreateTicketState(prev => prev && { ...prev, priority: e.target.value })}
                    className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                  >
                    <option value="">Not set</option>
                    {JIRA_PRIORITY_OPTIONS.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Component/s</label>
                  <input
                    type="text"
                    value={createTicketState.components}
                    onChange={(e) => setCreateTicketState(prev => prev && { ...prev, components: e.target.value })}
                    placeholder="Comma separated"
                    className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Team Name</label>
                  <input
                    type="text"
                    value={createTicketState.teamName}
                    onChange={(e) => setCreateTicketState(prev => prev && { ...prev, teamName: e.target.value })}
                    className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Epic Link</label>
                  <input
                    type="text"
                    value={createTicketState.epicLink}
                    onChange={(e) => setCreateTicketState(prev => prev && { ...prev, epicLink: e.target.value })}
                    className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                  />
                </div>
              </div>

              {createTicketError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" /> {createTicketError}
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setCreateTicketState(null)}
                disabled={createTicketSubmitting}
                className="btn-ghost !px-3 !py-1.5 text-xs"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreateTicketSubmit()}
                disabled={createTicketSubmitting}
                className="btn-primary !px-3 !py-1.5 text-xs"
              >
                {createTicketSubmitting ? (
                  <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Creating...</span>
                ) : (
                  'Create Ticket'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
