import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Link2, Loader2, RefreshCcw, RotateCcw, Save, Search, ServerCrash, FolderOpen, Settings, Users, Wand2 } from 'lucide-react'
import { apiService, CONNECTION_STATUS_CHANGED_EVENT } from '@/services/api'
import TaskManagementPanel from './TaskManagementPanel'
import ZephyrAutomationPlannerPanel from './ZephyrAutomationPlannerPanel'

const JIRA_STATUS_SPLIT_STORAGE_KEY = 'projects.jira.status.leftPanelWidth'
const JIRA_PRIORITY_OPTIONS = ['Highest', 'High', 'Medium', 'Low', 'Lowest']

type SubTab = 'planner' | 'status' | 'tasks'

type StoryItem = {
  key: string
  summary: string
  created: string
  team: string
  status: string
  issueType: string
  url: string
}
type EpicItem = {
  key: string
  summary: string
  created: string
  year: string
  team: string
  url: string
  stories: StoryItem[]
}
type TeamNode = { team: string; epics: EpicItem[] }
type YearNode = { year: string; teams: TeamNode[] }

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

export default function RequirementsTab() {
  const [subTab, setSubTab] = useState<SubTab>('planner')

  const [baseUrl, setBaseUrl] = useState('')
  const [tokenSet, setTokenSet] = useState(false)
  const [connectedProjectKey, setConnectedProjectKey] = useState('')
  const [connectedProjectName, setConnectedProjectName] = useState('')
  const [settingsLoading, setSettingsLoading] = useState(true)

  const [epicsAll, setEpicsAll] = useState<EpicItem[]>([])
  const [epicsLoading, setEpicsLoading] = useState(false)
  const [epicsError, setEpicsError] = useState<string | null>(null)
  const [epicSearch, setEpicSearch] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')
  const [selectedTeam, setSelectedTeam] = useState('')
  const [collapsedHierarchy, setCollapsedHierarchy] = useState<Set<string>>(new Set())
  const [automationState, setAutomationState] = useState<Record<string, { toBeAutomated: boolean; inProgress: boolean; noAutomationNeeded: boolean }>>({})
  const [automationSearch, setAutomationSearch] = useState('')
  const [automationFilter, setAutomationFilter] = useState('')
  const [automationTeam, setAutomationTeam] = useState('')
  const [automationTicketIds, setAutomationTicketIds] = useState<Record<string, string>>({})
  const [createTicketState, setCreateTicketState] = useState<CreateTicketFormState | null>(null)
  const [createTicketSubmitting, setCreateTicketSubmitting] = useState(false)
  const [createTicketError, setCreateTicketError] = useState<string | null>(null)
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return 55
    const raw = Number(window.localStorage.getItem(JIRA_STATUS_SPLIT_STORAGE_KEY) || '')
    return Number.isFinite(raw) ? Math.min(72, Math.max(30, raw)) : 55
  })
  const [isResizing, setIsResizing] = useState(false)
  const panelsRef = useRef<HTMLDivElement | null>(null)

  const [epicFilterStatus, setEpicFilterStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [automationFilterStatus, setAutomationFilterStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  const availableStatuses = useMemo(() => {
    const statuses = new Set<string>()
    for (const epic of epicsAll) {
      for (const story of epic.stories) {
        if (story.status) statuses.add(story.status)
      }
    }
    return Array.from(statuses).sort()
  }, [epicsAll])

  const suggestedTeams = useMemo(() => {
    const teams = new Set<string>()
    for (const epic of epicsAll) {
      if (epic.team) teams.add(epic.team)
    }
    return Array.from(teams).sort()
  }, [epicsAll])

  const availableTeams = useMemo(() => {
    const teams = new Set<string>()
    for (const epic of epicsAll) {
      teams.add((epic.team || `Team ${connectedProjectKey || ''}`).trim())
    }
    return Array.from(teams).sort()
  }, [epicsAll, connectedProjectKey])

  // Base hierarchy (year -> team -> epics), built directly from all epics with no
  // filters applied. Each panel below derives its own view from this shared base,
  // applying only its own filter state, so the two panels never affect each other.
  const baseHierarchyData = useMemo(() => {
    const byYear = new Map<string, Map<string, EpicItem[]>>()
    for (const epic of epicsAll) {
      const year = epic.year || (epic.created?.slice(0, 4) || 'Unknown')
      const team = (epic.team || `Team ${connectedProjectKey || ''}`).trim()
      const teamMap = byYear.get(year) || new Map<string, EpicItem[]>()
      byYear.set(year, teamMap)
      const list = teamMap.get(team) || []
      list.push(epic)
      teamMap.set(team, list)
    }
    return Array.from(byYear.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([year, teamsMap]): YearNode => ({
        year,
        teams: Array.from(teamsMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([team, epics]): TeamNode => ({
            team,
            epics: [...epics].sort((a, b) => (a.created < b.created ? 1 : -1)),
          })),
      }))
  }, [epicsAll, connectedProjectKey])

  const teamFilteredStatusHierarchy = useMemo(() => {
    const q = epicSearch.trim().toLowerCase()
    return baseHierarchyData
      .map(yearNode => ({
        ...yearNode,
        teams: yearNode.teams
          .filter(teamNode => !selectedTeam || teamNode.team === selectedTeam)
          .map(teamNode => ({
            ...teamNode,
            epics: teamNode.epics
              .map(epic => {
                let stories = epic.stories
                if (selectedStatus) stories = stories.filter(s => (s.status || '') === selectedStatus)
                if (!q) return { ...epic, stories }
                const epicMatch = epic.key.toLowerCase().includes(q) || epic.summary.toLowerCase().includes(q)
                if (epicMatch) return { ...epic, stories }
                return {
                  ...epic,
                  stories: stories.filter(
                    s => s.key.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q),
                  ),
                }
              })
              .filter(epic => epic.stories.length > 0),
          }))
          .filter(team => team.epics.length > 0),
      }))
      .filter(year => year.teams.length > 0)
  }, [baseHierarchyData, epicSearch, selectedStatus, selectedTeam])

  const automationHierarchyData = useMemo(() => {
    const q = automationSearch.trim().toLowerCase()
    const matchesCheckboxFilter = (story: StoryItem) => {
      const inProd = story.status === 'In Production'
      const st = automationState[story.key] ?? { toBeAutomated: false, inProgress: false, noAutomationNeeded: false }
      if (!automationFilter) return true
      if (automationFilter === 'in-production') return inProd
      if (automationFilter === 'ready-for-check') return inProd
      if (automationFilter === 'to-be-automated') return st.toBeAutomated
      if (automationFilter === 'in-progress') return st.inProgress
      if (automationFilter === 'done') return st.inProgress
      return true
    }
    return baseHierarchyData
      .map(yearNode => ({
        ...yearNode,
        teams: yearNode.teams
          .filter(teamNode => !automationTeam || teamNode.team === automationTeam)
          .map(teamNode => ({
            ...teamNode,
            epics: teamNode.epics
              .map(epic => {
                const storiesByCheckbox = epic.stories.filter(matchesCheckboxFilter)
                if (!q) return { ...epic, stories: storiesByCheckbox }
                const epicMatch = epic.key.toLowerCase().includes(q) || epic.summary.toLowerCase().includes(q)
                if (epicMatch) return { ...epic, stories: storiesByCheckbox }
                return {
                  ...epic,
                  stories: storiesByCheckbox.filter(
                    s => s.key.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q),
                  ),
                }
              })
              .filter(epic => epic.stories.length > 0),
          }))
          .filter(team => team.epics.length > 0),
      }))
      .filter(year => year.teams.length > 0)
  }, [baseHierarchyData, automationSearch, automationFilter, automationState, automationTeam])

  const toggleHierarchy = (key: string) => {
    setCollapsedHierarchy(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const loadEpicStories = async (projectKey: string, forceRefresh = false) => {
    if (!projectKey) return
    setEpicsLoading(true)
    setEpicsError(null)
    try {
      const data = await apiService.getEpicStories(projectKey, '', forceRefresh)
      setEpicsAll(data.epics)
    } catch (e) {
      setEpicsError(apiService.errorMessage(e))
      setEpicsAll([])
    } finally {
      setEpicsLoading(false)
    }
  }

  const loadJiraSettings = async () => {
    setSettingsLoading(true)
    try {
      const settings = await apiService.getJiraSettings()
      setBaseUrl(settings.jira_mcp_base_url || '')
      setTokenSet(settings.jira_token_set)
      setConnectedProjectKey(settings.jira_project_key || '')
      setConnectedProjectName(settings.jira_project_name || '')
      return settings
    } catch {
      // Keep previous values on transient failures.
      return null
    } finally {
      setSettingsLoading(false)
    }
  }

  useEffect(() => {
    void loadJiraSettings()
  }, [])

  // If the Jira connection (token, base URL or connected project) is
  // changed/reset from Settings, drop everything derived from the old
  // connection and reload fresh — otherwise this page would keep showing
  // epics/stories fetched under the previous configuration.
  useEffect(() => {
    const onConnectionChanged = (event: Event) => {
      const kind = (event as CustomEvent<{ kind?: 'github' | 'jira' | 'confluence' }>).detail?.kind
      if (kind !== 'jira') return
      setEpicsAll([])
      setEpicsError(null)
      setAutomationState({})
      setAutomationTicketIds({})
      setCollapsedHierarchy(new Set())
      void (async () => {
        const refreshed = await loadJiraSettings()
        if (refreshed?.jira_token_set && refreshed.jira_project_key) {
          void loadEpicStories(refreshed.jira_project_key, true)
        }
      })()
    }
    window.addEventListener(CONNECTION_STATUS_CHANGED_EVENT, onConnectionChanged)
    return () => window.removeEventListener(CONNECTION_STATUS_CHANGED_EVENT, onConnectionChanged)
  }, [])

  useEffect(() => {
    if (connectedProjectKey && tokenSet) {
      void loadEpicStories(connectedProjectKey, true)
    }
  }, [connectedProjectKey, tokenSet])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const saved = await apiService.getRequirementsFilters()
        if (!mounted) return
        setEpicSearch(saved.epic_status_view.search || '')
        setSelectedStatus(saved.epic_status_view.status || '')
        setSelectedTeam(saved.epic_status_view.team || '')
        setAutomationSearch(saved.automation_status_management.search || '')
        setAutomationFilter(saved.automation_status_management.filter || '')
        setAutomationTeam(saved.automation_status_management.team || '')
      } catch {
        // No saved filters yet, or failed to load — keep defaults.
      }
    })()
    return () => { mounted = false }
  }, [])

  const openCreateTicketModal = (story: StoryItem, team: string, epicKey?: string) => {
    setCreateTicketError(null)
    setCreateTicketState({
      sourceKey: story.key,
      sourceUrl: story.url || undefined,
      sourceType: story.issueType || undefined,
      sourceStatus: story.status || undefined,
      summary: `Automation needed: ${story.key} (Team: ${team})`,
      description: `Automate test coverage for ${story.key}${story.summary ? ` - ${story.summary}` : ''}.`,
      priority: '',
      components: '',
      teamName: team,
      epicLink: epicKey || '',
    })
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
        project_key: connectedProjectKey || undefined,
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

  const saveEpicFilter = async () => {
    setEpicFilterStatus('saving')
    try {
      await apiService.saveRequirementsFilters({
        epic_status_view: { search: epicSearch, status: selectedStatus, team: selectedTeam },
      })
      setEpicFilterStatus('saved')
    } catch {
      setEpicFilterStatus('idle')
    } finally {
      setTimeout(() => setEpicFilterStatus('idle'), 1500)
    }
  }

  const resetEpicFilter = async () => {
    setEpicSearch('')
    setSelectedStatus('')
    setSelectedTeam('')
    setEpicFilterStatus('saving')
    try {
      await apiService.saveRequirementsFilters({
        epic_status_view: { search: '', status: '', team: '' },
      })
      setEpicFilterStatus('saved')
    } catch {
      setEpicFilterStatus('idle')
    } finally {
      setTimeout(() => setEpicFilterStatus('idle'), 1500)
    }
  }

  const saveAutomationFilter = async () => {
    setAutomationFilterStatus('saving')
    try {
      await apiService.saveRequirementsFilters({
        automation_status_management: { search: automationSearch, filter: automationFilter, team: automationTeam },
      })
      setAutomationFilterStatus('saved')
    } catch {
      setAutomationFilterStatus('idle')
    } finally {
      setTimeout(() => setAutomationFilterStatus('idle'), 1500)
    }
  }

  const resetAutomationFilter = async () => {
    setAutomationSearch('')
    setAutomationFilter('')
    setAutomationTeam('')
    setAutomationFilterStatus('saving')
    try {
      await apiService.saveRequirementsFilters({
        automation_status_management: { search: '', filter: '', team: '' },
      })
      setAutomationFilterStatus('saved')
    } catch {
      setAutomationFilterStatus('idle')
    } finally {
      setTimeout(() => setAutomationFilterStatus('idle'), 1500)
    }
  }

  useEffect(() => {
    if (!isResizing) return

    const onMove = (event: MouseEvent) => {
      const container = panelsRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return
      const raw = ((event.clientX - rect.left) / rect.width) * 100
      const clamped = Math.min(72, Math.max(30, raw))
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
    window.localStorage.setItem(JIRA_STATUS_SPLIT_STORAGE_KEY, String(leftPanelWidth))
  }, [leftPanelWidth])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Sub-tabs */}
      <div className="mb-3 flex shrink-0 items-center gap-1 border-b border-gray-200 px-1 pb-2 dark:border-gray-700">
        {([
          { id: 'planner' as SubTab, label: 'Zephyr Automation Planner', icon: Wand2 },
          { id: 'status' as SubTab, label: 'Epic and Task Management', icon: ClipboardList },
          { id: 'tasks' as SubTab, label: 'Task Management', icon: Users },
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

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {subTab === 'planner' ? (
          <ZephyrAutomationPlannerPanel
            connectedProjectKey={connectedProjectKey}
            connectedProjectName={connectedProjectName}
            ready={!settingsLoading && tokenSet && !!connectedProjectKey}
          />
        ) : subTab === 'tasks' ? (
          <TaskManagementPanel suggestedTeams={suggestedTeams} />
        ) : settingsLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 size={16} className="animate-spin" /> Loading Jira settings…
          </div>
        ) : !tokenSet || !connectedProjectKey ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <FolderOpen size={30} className="text-gray-300 dark:text-gray-600" />
            <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">
              {tokenSet ? 'No Jira project connected' : 'Jira is not connected'}
            </p>
            <p className="max-w-sm text-xs text-gray-500 dark:text-gray-400">
              Connect your Jira server and select a project in Settings to view epics, stories and automation status here.
            </p>
            <Link to="/settings" className="btn-primary mt-1">
              <Settings size={14} /> Open Settings
            </Link>
          </div>
        ) : (
        <div ref={panelsRef} className={`flex min-h-0 flex-1 flex-col gap-4 md:flex-row md:gap-0 ${isResizing ? 'select-none' : ''}`}>
      {/* Epic and Story Management */}
      <div
        className="flex min-h-[180px] min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90 md:min-h-0 md:rounded-r-none"
        style={{ width: `clamp(320px, ${leftPanelWidth}%, 72%)` }}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <FolderOpen size={16} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Epic Status View</h3>
              <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                {epicsAll.length} epics loaded · {connectedProjectKey}{connectedProjectName ? ` - ${connectedProjectName}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => void loadEpicStories(connectedProjectKey, true)}
            disabled={epicsLoading}
            className="btn-ghost !px-2 !py-1 text-xs"
            title="Refresh epics and stories"
          >
            <RefreshCcw size={12} className={epicsLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {!epicsLoading && (
          <div className="border-b border-gray-100 px-4 py-2 dark:border-gray-700/50">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={epicSearch}
                onChange={e => setEpicSearch(e.target.value)}
                placeholder="Search epic or story by key/name..."
                className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-7 pr-3 text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
              />
            </div>
            {(availableStatuses.length > 0 || availableTeams.length > 0) && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {availableStatuses.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label htmlFor="status-filter" className="text-xs font-medium text-gray-600 dark:text-gray-300">Status:</label>
                    <select
                      id="status-filter"
                      value={selectedStatus}
                      onChange={e => setSelectedStatus(e.target.value)}
                      className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                    >
                      <option value="">All</option>
                      {availableStatuses.map(statusOption => (
                        <option key={statusOption} value={statusOption}>{statusOption}</option>
                      ))}
                    </select>
                  </div>
                )}
                {availableTeams.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label htmlFor="team-filter" className="text-xs font-medium text-gray-600 dark:text-gray-300">Team:</label>
                    <select
                      id="team-filter"
                      value={selectedTeam}
                      onChange={e => setSelectedTeam(e.target.value)}
                      className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                    >
                      <option value="">All</option>
                      {availableTeams.map(teamOption => (
                        <option key={teamOption} value={teamOption}>{teamOption}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => void saveEpicFilter()}
                disabled={epicFilterStatus === 'saving'}
                className="btn-ghost !px-2 !py-1 text-xs"
                title="Save this filter to your profile"
              >
                <Save size={12} /> {epicFilterStatus === 'saved' ? 'Saved' : epicFilterStatus === 'saving' ? 'Saving…' : 'Save filter'}
              </button>
              <button
                onClick={() => void resetEpicFilter()}
                disabled={epicFilterStatus === 'saving'}
                className="btn-ghost !px-2 !py-1 text-xs"
                title="Reset this filter"
              >
                <RotateCcw size={12} /> Reset
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {epicsLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Loading epics and stories...
            </div>
          ) : epicsError ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <ServerCrash size={20} className="text-red-400" />
              <p className="text-sm text-red-600 dark:text-red-400">{epicsError}</p>
            </div>
          ) : teamFilteredStatusHierarchy.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-gray-500 dark:text-gray-400">
              <CheckCircle2 size={20} className="text-gray-400" />
              <p>No epics/stories match the current filter.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700/40">
              {teamFilteredStatusHierarchy.map(yearNode => {
                const yearKey = `year::${yearNode.year}`
                const yearCollapsed = collapsedHierarchy.has(yearKey)
                return (
                  <div key={yearNode.year}>
                    <button
                      onClick={() => toggleHierarchy(yearKey)}
                      className="flex w-full items-center justify-between bg-gray-50 px-4 py-2 text-left hover:bg-gray-100 dark:bg-gray-800/60 dark:hover:bg-gray-700/60"
                    >
                      <div className="flex items-center gap-2">
                        {yearCollapsed ? <ChevronRight size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
                        <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">{yearNode.year}</span>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">Year</span>
                    </button>

                    {!yearCollapsed && yearNode.teams.map(teamNode => {
                      const teamKey = `${yearKey}::team::${teamNode.team}`
                      const teamCollapsed = collapsedHierarchy.has(teamKey)
                      return (
                        <div key={teamKey}>
                          <button
                            onClick={() => toggleHierarchy(teamKey)}
                            className="flex w-full items-center justify-between bg-white px-7 py-2 text-left hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700/40"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {teamCollapsed ? <ChevronRight size={13} className="text-gray-500" /> : <ChevronDown size={13} className="text-gray-500" />}
                              <FolderOpen size={13} className="text-blue-500" />
                              <span className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">{teamNode.team}</span>
                            </div>
                            <span className="text-xs text-gray-500 dark:text-gray-400">Team</span>
                          </button>

                          {!teamCollapsed && teamNode.epics.map(epic => {
                            const epicKey = `${teamKey}::epic::${epic.key}`
                            const epicCollapsed = collapsedHierarchy.has(epicKey)
                            return (
                              <div key={epic.key}>
                                <button
                                  onClick={() => toggleHierarchy(epicKey)}
                                  className="flex w-full items-center justify-between bg-white pl-14 pr-0 py-2 text-left hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700/30"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    {epicCollapsed ? <ChevronRight size={12} className="text-gray-500" /> : <ChevronDown size={12} className="text-gray-500" />}
                                    <a
                                      href={epic.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      className="truncate text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                                    >
                                      {epic.key} - {epic.summary}
                                    </a>
                                  </div>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">Epic</span>
                                </button>

                                {!epicCollapsed && (
                                  <div className="divide-y divide-gray-100 dark:divide-gray-700/20">
                                    {epic.stories.map(story => (
                                      <div key={story.key} className="flex items-start justify-between gap-3 pl-20 pr-0 py-2.5 transition hover:bg-gray-50 dark:hover:bg-gray-700/20">
                                        <div className="min-w-0 flex-1 pr-3">
                                          <a
                                            href={story.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                                          >
                                            {story.key}
                                          </a>
                                          <p className="mt-0.5 whitespace-normal break-words text-xs leading-4 text-gray-600 dark:text-gray-300">
                                            {story.summary}
                                          </p>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-1.5">
                                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                                            {story.issueType || 'Story'}
                                          </span>
                                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                                            {story.status || 'Unknown'}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                    {epic.stories.length === 0 && (
                                      <p className="px-12 py-2 text-xs text-gray-400">No stories under this epic.</p>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-1.5 border-t border-gray-100 px-4 py-2 dark:border-gray-700/50">
          <Link2 size={11} className="text-gray-400" />
          <a
            href={`${baseUrl}/issues/?jql=project%3D${connectedProjectKey}%20AND%20issuetype%20in%20(Epic%2CStory%2C%22User%20Story%22)%20ORDER%20BY%20created%20DESC`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline"
          >
            Open in Jira
          </a>
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Jira panels"
        onMouseDown={() => setIsResizing(true)}
        className="hidden w-2 cursor-col-resize items-stretch justify-center md:flex"
        title="Drag to resize panels"
      >
        <div className={`w-px rounded-full transition-colors ${isResizing ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-700'}`} />
      </div>

      {/* Epic and Story to be Automated Status panel */}
      <div className="flex min-h-[180px] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90 md:min-h-0 md:rounded-l-none">
        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Automation Status Management</h3>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
            {epicsAll.reduce((acc, e) => acc + e.stories.length, 0)} stories total
          </p>
        </div>

        {!epicsLoading && (
          <div className="border-b border-gray-100 px-4 py-2 dark:border-gray-700/50">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={automationSearch}
                onChange={e => setAutomationSearch(e.target.value)}
                placeholder="Search story by key/name..."
                className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-7 pr-3 text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label htmlFor="automation-filter" className="text-xs font-medium text-gray-600 dark:text-gray-300">Filter:</label>
                <select
                  id="automation-filter"
                  value={automationFilter}
                  onChange={e => setAutomationFilter(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                >
                  <option value="">All</option>
                  <option value="in-production">In Production</option>
                  <option value="ready-for-check">Ready for automation check</option>
                  <option value="to-be-automated">To be automated</option>
                  <option value="in-progress">Automation In progress</option>
                  <option value="done">Automation Done</option>
                </select>
              </div>
              {availableTeams.length > 0 && (
                <div className="flex items-center gap-2">
                  <label htmlFor="automation-team-filter" className="text-xs font-medium text-gray-600 dark:text-gray-300">Team:</label>
                  <select
                    id="automation-team-filter"
                    value={automationTeam}
                    onChange={e => setAutomationTeam(e.target.value)}
                    className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  >
                    <option value="">All</option>
                    {availableTeams.map(teamOption => (
                      <option key={teamOption} value={teamOption}>{teamOption}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => void saveAutomationFilter()}
                disabled={automationFilterStatus === 'saving'}
                className="btn-ghost !px-2 !py-1 text-xs"
                title="Save this filter to your profile"
              >
                <Save size={12} /> {automationFilterStatus === 'saved' ? 'Saved' : automationFilterStatus === 'saving' ? 'Saving…' : 'Save filter'}
              </button>
              <button
                onClick={() => void resetAutomationFilter()}
                disabled={automationFilterStatus === 'saving'}
                className="btn-ghost !px-2 !py-1 text-xs"
                title="Reset this filter"
              >
                <RotateCcw size={12} /> Reset
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {epicsLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Loading epics and stories to be automated...
            </div>
          ) : automationHierarchyData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">No stories found.</div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700/40">
              {automationHierarchyData.map(yearNode => {
                const yearKey = `auto::year::${yearNode.year}`
                const yearCollapsed = collapsedHierarchy.has(yearKey)
                return (
                  <div key={yearNode.year}>
                    <button
                      onClick={() => toggleHierarchy(yearKey)}
                      className="flex w-full items-center justify-between bg-gray-50 px-4 py-2 text-left hover:bg-gray-100 dark:bg-gray-800/60 dark:hover:bg-gray-700/60"
                    >
                      <div className="flex items-center gap-2">
                        {yearCollapsed ? <ChevronRight size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
                        <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">{yearNode.year}</span>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">Year</span>
                    </button>

                    {!yearCollapsed && yearNode.teams.map(teamNode => {
                      const teamKey = `${yearKey}::team::${teamNode.team}`
                      const teamCollapsed = collapsedHierarchy.has(teamKey)
                      return (
                        <div key={teamKey}>
                          <button
                            onClick={() => toggleHierarchy(teamKey)}
                            className="flex w-full items-center justify-between bg-white px-7 py-2 text-left hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700/40"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {teamCollapsed ? <ChevronRight size={13} className="text-gray-500" /> : <ChevronDown size={13} className="text-gray-500" />}
                              <FolderOpen size={13} className="text-blue-500" />
                              <span className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">{teamNode.team}</span>
                            </div>
                            <span className="text-xs text-gray-500 dark:text-gray-400">Team</span>
                          </button>

                          {!teamCollapsed && teamNode.epics.map(epic => {
                            const epicKey = `${teamKey}::epic::${epic.key}`
                            const epicCollapsed = collapsedHierarchy.has(epicKey)
                            return (
                              <div key={epic.key}>
                                <button
                                  onClick={() => toggleHierarchy(epicKey)}
                                  className="flex w-full items-center justify-between bg-white px-14 py-2 text-left hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700/30"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    {epicCollapsed ? <ChevronRight size={12} className="text-gray-500" /> : <ChevronDown size={12} className="text-gray-500" />}
                                    <span className="truncate text-xs font-semibold text-blue-600 dark:text-blue-400">
                                      {epic.key} - {epic.summary}
                                    </span>
                                  </div>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">Epic</span>
                                </button>

                                {!epicCollapsed && (
                                  <div className="divide-y divide-gray-100 dark:divide-gray-700/20">
                                    {epic.stories.map(story => {
                                      const inProd = story.status === 'In Production'
                                      const st = automationState[story.key] ?? { toBeAutomated: false, inProgress: false, noAutomationNeeded: false }
                                      const defaultSt = { toBeAutomated: false, inProgress: false, noAutomationNeeded: false }
                                      return (
                                        <div key={story.key} className="px-5 py-2.5">
                                          <div className="mb-1.5 pl-14">
                                            <div className="flex items-center gap-1.5">
                                              <a href={story.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">
                                                {story.key}
                                              </a>
                                              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                                                {story.issueType || 'Story'}
                                              </span>
                                            </div>
                                            <p className="truncate text-xs text-gray-500 dark:text-gray-400">{story.summary}</p>
                                            {automationTicketIds[story.key] && (
                                              <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                                                Automation ticket:{' '}
                                                {baseUrl ? (
                                                  <a
                                                    href={`${baseUrl}/browse/${automationTicketIds[story.key]}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="font-mono text-blue-600 hover:underline dark:text-blue-400"
                                                  >
                                                    {automationTicketIds[story.key]}
                                                  </a>
                                                ) : (
                                                  <span className="font-mono">{automationTicketIds[story.key]}</span>
                                                )}
                                              </p>
                                            )}
                                          </div>
                                          <div className="flex flex-col gap-1 pl-14">
                                            <label className="flex cursor-default items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                              <input type="checkbox" checked={inProd} readOnly className="h-3.5 w-3.5 rounded accent-emerald-500" />
                                              In Production
                                            </label>
                                            <label className="flex cursor-default items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                              <input type="checkbox" checked={inProd} readOnly className="h-3.5 w-3.5 rounded accent-emerald-500" />
                                              Ready for automation check
                                            </label>
                                            <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                              <input
                                                type="checkbox"
                                                checked={st.toBeAutomated}
                                                onChange={e => {
                                                  const checked = e.target.checked
                                                  setAutomationState(prev => ({
                                                    ...prev,
                                                    [story.key]: {
                                                      ...(prev[story.key] ?? defaultSt),
                                                      toBeAutomated: checked,
                                                      noAutomationNeeded: checked ? false : (prev[story.key] ?? defaultSt).noAutomationNeeded,
                                                    },
                                                  }))
                                                  if (checked) openCreateTicketModal(story, teamNode.team, epic.key)
                                                }}
                                                className="h-3.5 w-3.5 rounded accent-blue-500"
                                              />
                                              To be automated
                                            </label>
                                            <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                              <input
                                                type="checkbox"
                                                checked={st.noAutomationNeeded}
                                                onChange={e => {
                                                  const checked = e.target.checked
                                                  setAutomationState(prev => ({
                                                    ...prev,
                                                    [story.key]: {
                                                      ...(prev[story.key] ?? defaultSt),
                                                      noAutomationNeeded: checked,
                                                      toBeAutomated: checked ? false : (prev[story.key] ?? defaultSt).toBeAutomated,
                                                      inProgress: checked ? false : (prev[story.key] ?? defaultSt).inProgress,
                                                    },
                                                  }))
                                                }}
                                                className="h-3.5 w-3.5 rounded accent-gray-500"
                                              />
                                              No automation needed
                                            </label>
                                            <label className={`flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 ${st.noAutomationNeeded ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                                              <input
                                                type="checkbox"
                                                checked={st.inProgress}
                                                disabled={st.noAutomationNeeded}
                                                onChange={e =>
                                                  setAutomationState(prev => ({
                                                    ...prev,
                                                    [story.key]: { ...(prev[story.key] ?? defaultSt), inProgress: e.target.checked },
                                                  }))
                                                }
                                                className="h-3.5 w-3.5 rounded accent-blue-500"
                                              />
                                              Automation In progress
                                            </label>
                                            <label className={`flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 ${st.noAutomationNeeded ? 'cursor-not-allowed opacity-50' : 'cursor-default'}`}>
                                              <input type="checkbox" checked={st.inProgress} disabled readOnly className="h-3.5 w-3.5 rounded accent-emerald-500" />
                                              Automation Done
                                            </label>
                                          </div>
                                        </div>
                                      )
                                    })}
                                    {epic.stories.length === 0 && (
                                      <p className="px-16 py-2 text-xs text-gray-400">No stories under this epic.</p>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
        )}
      </div>

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
                  {connectedProjectKey || 'Not configured'}
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
