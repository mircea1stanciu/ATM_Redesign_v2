import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Link2, Loader2, RefreshCcw, Search, ServerCrash, FolderOpen } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import type { JiraProject } from '@/types/domain'

export default function JiraProjectsPage() {
  const user = useAppStore(s => s.user)
  const canEdit = user?.role === 'admin' || user?.role === 'automation_lead' || user?.role === 'super_admin' || user?.role === 'org_admin'

  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')
  const [tokenSet, setTokenSet] = useState(false)

  const [projects, setProjects] = useState<JiraProject[]>([])
  const [search, setSearch] = useState('')
  const [selectedProjectKey, setSelectedProjectKey] = useState<string>('')
  const [connectedProjectKey, setConnectedProjectKey] = useState<string>('')
  const [connectedProjectName, setConnectedProjectName] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [carouselIndex, setCarouselIndex] = useState(0)

  // Epic and Story Management
  type StoryItem = {
    key: string
    summary: string
    created: string
    team: string
    status: string
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

  const [epicsAll, setEpicsAll] = useState<EpicItem[]>([])
  const [epicsLoading, setEpicsLoading] = useState(false)
  const [epicsError, setEpicsError] = useState<string | null>(null)
  const [epicSearch, setEpicSearch] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')
  const [collapsedHierarchy, setCollapsedHierarchy] = useState<Set<string>>(new Set())
  const [automationState, setAutomationState] = useState<Record<string, { toBeAutomated: boolean; inProgress: boolean }>>({})
  const [automationSearch, setAutomationSearch] = useState('')
  const [automationFilter, setAutomationFilter] = useState('')

  const availableStatuses = useMemo(() => {
    const statuses = new Set<string>()
    for (const epic of epicsAll) {
      for (const story of epic.stories) {
        if (story.status) statuses.add(story.status)
      }
    }
    return Array.from(statuses).sort()
  }, [epicsAll])

  const filteredEpics = useMemo(() => {
    let filtered = epicsAll

    // Filter by selected status
    if (selectedStatus) {
      filtered = filtered.map(epic => ({
        ...epic,
        stories: epic.stories.filter(s => (s.status || '') === selectedStatus),
      })).filter(epic => epic.stories.length > 0)
    }

    // Filter by search text
    if (!epicSearch.trim()) return filtered
    const q = epicSearch.toLowerCase()
    const out: EpicItem[] = []

    for (const epic of filtered) {
      const epicMatch = epic.key.toLowerCase().includes(q) || epic.summary.toLowerCase().includes(q)
      const matchedStories = epic.stories.filter(
        s => s.key.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q),
      )

      if (epicMatch) {
        out.push(epic)
      } else if (matchedStories.length > 0) {
        out.push({ ...epic, stories: matchedStories })
      }
    }

    return out
  }, [epicsAll, epicSearch, selectedStatus])

  const hierarchyData = useMemo(() => {
    type TeamNode = { team: string; epics: EpicItem[] }
    type YearNode = { year: string; teams: TeamNode[] }

    const byYear = new Map<string, Map<string, EpicItem[]>>()

    for (const epic of filteredEpics) {
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
            epics: [...epics]
              .filter(e => e.stories.length > 0)
              .sort((a, b) => (a.created < b.created ? 1 : -1)),
          }))
          .filter(t => t.epics.length > 0),
      }))
      .filter(y => y.teams.length > 0)
  }, [filteredEpics, connectedProjectKey])

  const automationHierarchyData = useMemo(() => {
    const q = automationSearch.trim().toLowerCase()

    const matchesCheckboxFilter = (story: StoryItem) => {
      const inProd = story.status === 'In Production'
      const st = automationState[story.key] ?? { toBeAutomated: false, inProgress: false }

      if (!automationFilter) return true
      if (automationFilter === 'in-production') return inProd
      if (automationFilter === 'ready-for-check') return inProd
      if (automationFilter === 'to-be-automated') return st.toBeAutomated
      if (automationFilter === 'in-progress') return st.inProgress
      if (automationFilter === 'done') return st.inProgress
      return true
    }

    return hierarchyData
      .map(yearNode => ({
        ...yearNode,
        teams: yearNode.teams
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
  }, [hierarchyData, automationSearch, automationFilter, automationState])

  const toggleHierarchy = (key: string) => {
    setCollapsedHierarchy(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const loadEpicStories = async (projectKey: string, forceRefresh: boolean = false) => {
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

  const loadJiraState = async () => {
    setLoading(true)
    setError(null)
    try {
      const settings = await apiService.getJiraSettings()
      setBaseUrl(settings.jira_mcp_base_url || '')
      setTokenSet(settings.jira_token_set)
      setConnectedProjectKey(settings.jira_project_key || '')
      setConnectedProjectName(settings.jira_project_name || '')
      setSelectedProjectKey(settings.jira_project_key || '')

      if (settings.jira_token_set && settings.jira_mcp_base_url) {
        const items = await apiService.listJiraProjects()
        setProjects(items)
      } else {
        setProjects([])
      }
    } catch (e) {
      setError(apiService.errorMessage(e))
      setProjects([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadJiraState()
  }, [])

  // Load epics/stories when a project is connected (force refresh on initial load)
  useEffect(() => {
    if (connectedProjectKey && tokenSet) {
      void loadEpicStories(connectedProjectKey, true)
    }
  }, [connectedProjectKey, tokenSet])

  const handleSave = async () => {
    setSaving(true)
    setStatus(null)
    setError(null)
    try {
      const payload: { jira_mcp_base_url?: string; jira_token?: string } = {
        jira_mcp_base_url: baseUrl.trim(),
      }
      if (token.trim()) payload.jira_token = token.trim()

      const saved = await apiService.saveJiraSettings(payload)
      setToken('')
      setTokenSet(saved.jira_token_set)
      setConnectedProjectKey(saved.jira_project_key || '')
      setConnectedProjectName(saved.jira_project_name || '')
      setStatus({ ok: true, text: 'Jira settings saved.' })
      const items = await apiService.listJiraProjects()
      setProjects(items)
    } catch (e) {
      setStatus({ ok: false, text: apiService.errorMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(project =>
      project.key.toLowerCase().includes(q) ||
      project.name.toLowerCase().includes(q),
    )
  }, [projects, search])

  // If a project is connected, show only that project
  const displayProjects = useMemo(() => {
    if (connectedProjectKey) {
      return projects.filter(p => p.key === connectedProjectKey)
    }
    if (!canEdit) {
      return []
    }
    return filteredProjects
  }, [projects, filteredProjects, connectedProjectKey, canEdit])

  const selectedProject = useMemo(
    () => projects.find(project => project.key === selectedProjectKey) || null,
    [projects, selectedProjectKey],
  )

  const handleConnectSelected = async () => {
    if (!selectedProject) return
    setConnecting(true)
    setStatus(null)
    setError(null)
    try {
      const saved = await apiService.saveJiraSettings({
        jira_project_key: selectedProject.key,
        jira_project_name: selectedProject.name,
      })
      setConnectedProjectKey(saved.jira_project_key || selectedProject.key)
      setConnectedProjectName(saved.jira_project_name || selectedProject.name)
      setStatus({ ok: true, text: `Connected Jira project: ${selectedProject.key}` })
    } catch (e) {
      setStatus({ ok: false, text: apiService.errorMessage(e) })
    } finally {
      setConnecting(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setStatus(null)
    setError(null)
    try {
      const result = await apiService.testJiraConnection()
      if (result.ok) {
        setStatus({ ok: true, text: `Connected as ${result.user || 'Jira user'}.` })
      } else {
        setStatus({ ok: false, text: result.error || 'Jira connection failed.' })
      }
    } catch (e) {
      setStatus({ ok: false, text: apiService.errorMessage(e) })
    } finally {
      setTesting(false)
    }
  }

  const totalSlides = 2
  const goPrevSlide = () => setCarouselIndex(prev => (prev - 1 + totalSlides) % totalSlides)
  const goNextSlide = () => setCarouselIndex(prev => (prev + 1) % totalSlides)

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between rounded-2xl border border-gray-200/80 bg-white px-4 py-2 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <div className="section-title">
          Jira Projects pages
        </div>
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
          <section className="h-full shrink-0 px-0" style={{ width: `${100 / totalSlides}%` }}>
            <div className="flex h-full flex-col gap-4">
              <div className="flex min-h-0 flex-1 gap-4">
                <div className="w-72 shrink-0 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90 flex flex-col">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Jira Projects</h2>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Connect to Jira and load visible projects.
                  </p>
                  {connectedProjectKey && (
                    <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                      Connected: {connectedProjectKey} - {connectedProjectName || 'Unnamed'}
                    </p>
                  )}

                  <div className="mt-4 flex flex-col gap-2">
                    <input
                      value={baseUrl}
                      onChange={e => setBaseUrl(e.target.value)}
                      placeholder="https://your-domain.atlassian.net"
                      className="form-input"
                      disabled={!canEdit}
                    />
                    <input
                      value={token}
                      onChange={e => setToken(e.target.value)}
                      placeholder={tokenSet ? 'Leave blank to keep current token' : 'Jira token'}
                      className="form-input"
                      disabled={!canEdit}
                      type="password"
                    />
                    <button onClick={() => void handleSave()} disabled={!canEdit || saving} className="btn-primary w-full justify-center">
                      {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                      Save
                    </button>
                    <button onClick={() => void handleTest()} disabled={testing} className="btn-ghost w-full justify-center">
                      {testing ? <Loader2 size={14} className="animate-spin" /> : null}
                      Test Connection
                    </button>
                  </div>

                  {status && (
                    <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${status.ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
                      {status.text}
                    </div>
                  )}
                  {error && (
                    <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                      {error}
                    </div>
                  )}
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
                  <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                      {connectedProjectKey ? 'Selected Project' : 'Available Jira Projects'} <span className="text-gray-400">({displayProjects.length})</span>
                    </h3>
                    <div className="flex items-center gap-2">
                      {connectedProjectKey && (
                        <button
                          onClick={async () => {
                            if (window.confirm('Deselect the current project and show all projects?')) {
                              try {
                                await apiService.saveJiraSettings({ jira_project_key: '', jira_project_name: '' })
                                setConnectedProjectKey('')
                                setConnectedProjectName('')
                                setSelectedProjectKey('')
                                setSearch('')
                                const items = await apiService.listJiraProjects()
                                setProjects(items)
                              } catch (e) {
                                setStatus({ ok: false, text: apiService.errorMessage(e) })
                              }
                            }
                          }}
                          disabled={!canEdit}
                          className="btn-ghost !px-2 !py-1 text-xs"
                        >
                          Reset
                        </button>
                      )}
                      <button
                        onClick={() => void handleConnectSelected()}
                        disabled={!canEdit || !selectedProject || connecting}
                        className="btn-primary !px-2 !py-1 text-xs"
                      >
                        {connecting ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} Connect Selected Project
                      </button>
                      <button onClick={() => void loadJiraState()} className="btn-ghost !px-2 !py-1 text-xs">
                        <RefreshCcw size={12} /> Refresh
                      </button>
                    </div>
                  </div>

                  {!connectedProjectKey && (
                    <div className="border-b border-gray-200 px-4 py-2 dark:border-gray-700">
                      <div className="relative">
                        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                          value={search}
                          onChange={e => setSearch(e.target.value)}
                          placeholder="Search by key or project name"
                          className="form-input !pl-8"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex-1 overflow-y-auto">
                    {loading ? (
                      <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                        <Loader2 size={14} className="animate-spin" /> Loading Jira projects...
                      </div>
                    ) : displayProjects.length === 0 ? (
                      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-gray-500 dark:text-gray-400">
                        <ServerCrash size={20} className="text-gray-400" />
                        No Jira projects match your search.
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                        {displayProjects.map(project => (
                          <button
                            key={project.id}
                            onClick={() => setSelectedProjectKey(project.key)}
                            className={`flex w-full items-center justify-between px-4 py-3 text-left transition ${selectedProjectKey === project.key ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}
                          >
                            <div>
                              <p className="text-sm font-semibold text-gray-900 dark:text-white">{project.key} - {project.name}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">Type: {project.project_type || 'unknown'}</p>
                            </div>
                            <CheckCircle2 size={14} className={project.key === connectedProjectKey ? 'text-emerald-500' : 'text-gray-300 dark:text-gray-600'} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {connectedProjectKey && (
                <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <FolderOpen size={16} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Epic and Story Management</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {epicsAll.length} epics loaded · {connectedProjectKey}
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

              {availableStatuses.length > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <label htmlFor="status-filter" className="text-xs font-medium text-gray-600 dark:text-gray-300">
                    Status:
                  </label>
                  <select
                    id="status-filter"
                    value={selectedStatus}
                    onChange={e => setSelectedStatus(e.target.value)}
                    className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  >
                    <option value="">All</option>
                    {availableStatuses.map(statusOption => (
                      <option key={statusOption} value={statusOption}>
                        {statusOption}
                      </option>
                    ))}
                  </select>
                </div>
              )}
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
            ) : hierarchyData.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-gray-500 dark:text-gray-400">
                <CheckCircle2 size={20} className="text-gray-400" />
                <p>No epics/stories match the current filter.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700/40">
                {hierarchyData.map(yearNode => {
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
                                          <div className="min-w-0 flex-1">
                                            <a
                                              href={story.url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="truncate text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                                            >
                                              {story.key} - {story.summary}
                                            </a>
                                          </div>
                                          <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                                            {story.status || 'Story'}
                                          </span>
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

        {/* Test Case Automation Status panel */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
          <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Test Case Automation Status</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
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

              <div className="mt-2 flex items-center gap-2">
                <label htmlFor="automation-filter" className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  Filter:
                </label>
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
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {epicsLoading ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Loader2 size={14} className="animate-spin" /> Loading test cases with automation status
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
                                        const st = automationState[story.key] ?? { toBeAutomated: false, inProgress: false }
                                        return (
                                          <div key={story.key} className="px-5 py-2.5">
                                            <div className="mb-1.5 pl-14">
                                              <a href={story.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">
                                                {story.key}
                                              </a>
                                              <p className="truncate text-xs text-gray-500 dark:text-gray-400">{story.summary}</p>
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
                                                  onChange={e =>
                                                    setAutomationState(prev => ({
                                                      ...prev,
                                                      [story.key]: { ...(prev[story.key] ?? { toBeAutomated: false, inProgress: false }), toBeAutomated: e.target.checked },
                                                    }))
                                                  }
                                                  className="h-3.5 w-3.5 rounded accent-blue-500"
                                                />
                                                To be automated
                                              </label>
                                              <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                                <input
                                                  type="checkbox"
                                                  checked={st.inProgress}
                                                  onChange={e =>
                                                    setAutomationState(prev => ({
                                                      ...prev,
                                                      [story.key]: { ...(prev[story.key] ?? { toBeAutomated: false, inProgress: false }), inProgress: e.target.checked },
                                                    }))
                                                  }
                                                  className="h-3.5 w-3.5 rounded accent-blue-500"
                                                />
                                                Automation In progress
                                              </label>
                                              <label className="flex cursor-default items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                                <input type="checkbox" checked={st.inProgress} readOnly className="h-3.5 w-3.5 rounded accent-emerald-500" />
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
          </section>

          <section className="h-full shrink-0 px-0" style={{ width: `${100 / totalSlides}%` }}>
            <div className="flex h-full min-h-0 flex-col rounded-2xl border border-dashed border-gray-300 bg-white p-6 shadow-soft dark:border-gray-600 dark:bg-gray-800/90">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Slide 2</h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Add your future sections here. This second carousel object is ready for additional Jira-related widgets.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
