import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import {
  BookOpen,
  CheckCircle2,
  ExternalLink,
  Link2,
  Loader2,
  Search,
  Settings,
  Unlink,
  RefreshCcw,
} from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { useAppStore } from '@/store/useAppStore'
import { apiService, CONNECTION_STATUS_CHANGED_EVENT } from '@/services/api'
import type { ConfluencePageItem } from '@/types/domain'

interface ConfluenceSettingsView {
  confluence_token_set: boolean
  confluence_mcp_base_url: string
  confluence_space_key?: string | null
  confluence_space_name?: string | null
  confluence_release_container_id?: string | null
  confluence_release_container_title?: string | null
  confluence_release_container_url?: string | null
  confluence_selected_release_page_id?: string | null
  confluence_selected_release_page_title?: string | null
  confluence_selected_release_page_url?: string | null
}

const CONFLUENCE_RELEASE_CONFIG_SPLIT_STORAGE_KEY = 'projects.confluence.releaseConfig.leftPanelWidth'

function ConfluenceSubnav() {
  return (
    <div className="mb-4 flex items-center gap-2 overflow-x-auto rounded-xl border border-gray-200/80 bg-white p-2 dark:border-gray-700/70 dark:bg-gray-800/90">
      <NavLink
        to="/jira-confluence/confluence/configuration"
        className={({ isActive }) => `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
          isActive
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/60'
        }`}
      >
        Release Page Configuration
      </NavLink>
      <NavLink
        to="/jira-confluence/confluence/analyzer"
        className={({ isActive }) => `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
          isActive
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/60'
        }`}
      >
        Release Management Analyzer
      </NavLink>
    </div>
  )
}

export default function ConfluenceReleaseManagementTab() {
  const user = useAppStore(s => s.user)
  const canManageConfig = usePermission('project.members.manage') || Boolean(user?.assigned_lead_id)

  const [settings, setSettings] = useState<ConfluenceSettingsView | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  const [containerSearch, setContainerSearch] = useState('')
  const [containerSearchLoading, setContainerSearchLoading] = useState(false)
  const [containerResults, setContainerResults] = useState<ConfluencePageItem[]>([])

  const [releasePagesLoading, setReleasePagesLoading] = useState(false)
  const [releasePagesError, setReleasePagesError] = useState<string | null>(null)
  const [releasePages, setReleasePages] = useState<ConfluencePageItem[]>([])
  const [releaseFilter, setReleaseFilter] = useState('')
  const [selectedReleaseId, setSelectedReleaseId] = useState('')
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [browseItems, setBrowseItems] = useState<ConfluencePageItem[]>([])
  const [browseStack, setBrowseStack] = useState<Array<{ id: string; title: string }>>([])
  const [browseRoot, setBrowseRoot] = useState<{ id: string; title: string } | null>(null)
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return 50
    const raw = Number(window.localStorage.getItem(CONFLUENCE_RELEASE_CONFIG_SPLIT_STORAGE_KEY) || '')
    return Number.isFinite(raw) ? Math.min(70, Math.max(32, raw)) : 50
  })
  const [isResizing, setIsResizing] = useState(false)
  const panelsRef = useRef<HTMLDivElement | null>(null)

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true)
    setSettingsError(null)
    try {
      const data = await apiService.getConfluenceSettings()
      setSettings(data)
      setSelectedReleaseId(data.confluence_selected_release_page_id || '')
    } catch (e) {
      setSettingsError(apiService.errorMessage(e))
    } finally {
      setSettingsLoading(false)
    }
  }, [])

  const loadReleasePages = useCallback(async (containerId?: string) => {
    if (!containerId) {
      setReleasePages([])
      return
    }
    setReleasePagesLoading(true)
    setReleasePagesError(null)
    try {
      const pages = await apiService.listConfluenceReleasePages(containerId)
      setReleasePages(pages)
    } catch (e) {
      setReleasePagesError(apiService.errorMessage(e))
      setReleasePages([])
    } finally {
      setReleasePagesLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  // If the Confluence connection (token, base URL or linked space/container)
  // is changed/reset from Settings, drop everything derived from the old
  // connection and reload fresh — otherwise this page would keep showing
  // release pages/browse results fetched under the previous configuration.
  useEffect(() => {
    const onConnectionChanged = (event: Event) => {
      const kind = (event as CustomEvent<{ kind?: 'github' | 'jira' | 'confluence' }>).detail?.kind
      if (kind !== 'confluence') return
      setContainerSearch('')
      setContainerResults([])
      setReleasePages([])
      setReleaseFilter('')
      setBrowseItems([])
      setBrowseStack([])
      setBrowseRoot(null)
      void loadSettings()
    }
    window.addEventListener(CONNECTION_STATUS_CHANGED_EVENT, onConnectionChanged)
    return () => window.removeEventListener(CONNECTION_STATUS_CHANGED_EVENT, onConnectionChanged)
  }, [loadSettings])

  useEffect(() => {
    const containerId = settings?.confluence_release_container_id || ''
    if (containerId) {
      void loadReleasePages(containerId)
    } else {
      setReleasePages([])
    }
  }, [settings?.confluence_release_container_id, loadReleasePages])

  const loadBrowseChildren = useCallback(async (containerId: string, nextStack: Array<{ id: string; title: string }>) => {
    setBrowseLoading(true)
    setBrowseError(null)
    try {
      const pages = await apiService.listConfluenceReleasePages(containerId)
      setBrowseItems(pages)
      setBrowseStack(nextStack)
    } catch (e) {
      setBrowseError(apiService.errorMessage(e))
      setBrowseItems([])
    } finally {
      setBrowseLoading(false)
    }
  }, [])

  useEffect(() => {
    const containerId = settings?.confluence_release_container_id || ''
    const containerTitle = settings?.confluence_release_container_title || 'Linked container'
    if (!containerId) {
      return
    }
    const rootStack = [{ id: containerId, title: containerTitle }]
    setBrowseRoot({ id: containerId, title: containerTitle })
    void loadBrowseChildren(containerId, rootStack)
  }, [settings?.confluence_release_container_id, settings?.confluence_release_container_title, loadBrowseChildren])

  useEffect(() => {
    if (!isResizing) return

    const onMove = (event: MouseEvent) => {
      const container = panelsRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return

      const raw = ((event.clientX - rect.left) / rect.width) * 100
      const clamped = Math.min(70, Math.max(32, raw))
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
    window.localStorage.setItem(CONFLUENCE_RELEASE_CONFIG_SPLIT_STORAGE_KEY, String(leftPanelWidth))
  }, [leftPanelWidth])

  const handleSearchContainers = async () => {
    setContainerSearchLoading(true)
    setSettingsError(null)
    try {
      const pages = await apiService.searchConfluenceReleaseContainers(containerSearch.trim())
      setContainerResults(pages)
    } catch (e) {
      setSettingsError(apiService.errorMessage(e))
      setContainerResults([])
    } finally {
      setContainerSearchLoading(false)
    }
  }

  const handleLinkContainer = async (page: ConfluencePageItem) => {
    setSettingsMsg(null)
    setSettingsError(null)
    try {
      const updated = await apiService.saveConfluenceSettings({
        confluence_release_container_id: page.id,
        confluence_release_container_title: page.title,
        confluence_release_container_url: page.url,
        confluence_selected_release_page_id: '',
        confluence_selected_release_page_title: '',
        confluence_selected_release_page_url: '',
      })
      setSettings(updated)
      setSelectedReleaseId('')
      setSettingsMsg('Main release page container linked.')
      await loadReleasePages(page.id)
      setBrowseRoot({ id: page.id, title: page.title })
      await loadBrowseChildren(page.id, [{ id: page.id, title: page.title }])
    } catch (e) {
      setSettingsError(apiService.errorMessage(e))
    }
  }

  const handleUnlinkContainer = async () => {
    setSettingsMsg(null)
    setSettingsError(null)
    try {
      const updated = await apiService.saveConfluenceSettings({
        confluence_release_container_id: '',
        confluence_release_container_title: '',
        confluence_release_container_url: '',
        confluence_selected_release_page_id: '',
        confluence_selected_release_page_title: '',
        confluence_selected_release_page_url: '',
      })
      setSettings(updated)
      setSelectedReleaseId('')
      setReleasePages([])
      setSettingsMsg('Main release page container unlinked.')
    } catch (e) {
      setSettingsError(apiService.errorMessage(e))
    }
  }

  const handleStartBrowse = async (page: ConfluencePageItem) => {
    setBrowseRoot({ id: page.id, title: page.title })
    await loadBrowseChildren(page.id, [{ id: page.id, title: page.title }])
  }

  const handleOpenSubfolder = async (page: ConfluencePageItem) => {
    const nextStack = [...browseStack, { id: page.id, title: page.title }]
    await loadBrowseChildren(page.id, nextStack)
  }

  const handleBrowseBack = async () => {
    if (browseStack.length <= 1) return
    const nextStack = browseStack.slice(0, -1)
    const parent = nextStack[nextStack.length - 1]
    if (!parent) return
    await loadBrowseChildren(parent.id, nextStack)
  }

  const handleSaveSelectedRelease = async () => {
    const selected = releasePages.find(p => p.id === selectedReleaseId)
    if (!selected) return

    setSettingsMsg(null)
    setSettingsError(null)
    try {
      const updated = await apiService.saveConfluenceSettings({
        confluence_selected_release_page_id: selected.id,
        confluence_selected_release_page_title: selected.title,
        confluence_selected_release_page_url: selected.url,
      })
      setSettings(updated)
      setSettingsMsg('Release page selection saved.')
    } catch (e) {
      setSettingsError(apiService.errorMessage(e))
    }
  }

  const handleUnlinkSelectedRelease = async () => {
    setSettingsMsg(null)
    setSettingsError(null)
    try {
      const updated = await apiService.saveConfluenceSettings({
        confluence_selected_release_page_id: '',
        confluence_selected_release_page_title: '',
        confluence_selected_release_page_url: '',
      })
      setSettings(updated)
      setSelectedReleaseId('')
      setSettingsMsg('Selected release page unlinked.')
    } catch (e) {
      setSettingsError(apiService.errorMessage(e))
    }
  }

  const filteredReleasePages = useMemo(() => {
    const q = releaseFilter.trim().toLowerCase()
    if (!q) return releasePages
    return releasePages.filter(p => p.title.toLowerCase().includes(q))
  }, [releasePages, releaseFilter])

  const hasConfluenceConnection = Boolean(settings?.confluence_token_set && settings?.confluence_space_key)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <ConfluenceSubnav />

      {settingsLoading ? (
        <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 size={16} className="animate-spin" /> Loading Confluence settings...
        </div>
      ) : settingsError ? (
        <div className="flex h-full items-center justify-center px-6 text-sm text-red-600 dark:text-red-400">
          {settingsError}
        </div>
      ) : !hasConfluenceConnection ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <BookOpen size={30} className="text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Confluence is not fully configured</p>
          <p className="max-w-sm text-xs text-gray-500 dark:text-gray-400">
            Configure token and connected space first, then you can set the main release page container.
          </p>
          <Link to="/settings/confluence" className="btn-primary mt-1">
            <Settings size={14} /> Open Confluence Settings
          </Link>
        </div>
      ) : (
        <div
          ref={panelsRef}
          className={`flex min-h-0 flex-1 gap-2 overflow-hidden ${isResizing ? 'select-none' : ''}`}
        >
          <section
            className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90"
            style={{ width: `${leftPanelWidth}%` }}
          >
            <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Main Release Page Container</h3>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Search any page in space {settings?.confluence_space_key} and link it as root release container.
              </p>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {!canManageConfig && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                  This configuration is managed by your Automation Lead.
                </div>
              )}

              {settings?.confluence_release_container_id && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
                  <p className="font-semibold">Linked container: {settings.confluence_release_container_title}</p>
                  {settings.confluence_release_container_url && (
                    <a
                      href={settings.confluence_release_container_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 underline"
                    >
                      Open linked container <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={containerSearch}
                    onChange={e => setContainerSearch(e.target.value)}
                    placeholder="Search page title to link as container..."
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-7 pr-3 text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                    disabled={!canManageConfig}
                  />
                </div>
                <button
                  onClick={() => void handleSearchContainers()}
                  disabled={containerSearchLoading || !canManageConfig}
                  className="btn-ghost !px-3 !py-2 text-xs"
                >
                  {containerSearchLoading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} Search
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-700">
                {containerResults.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-gray-500 dark:text-gray-400">No search results yet.</div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {containerResults.map(page => (
                      <div key={page.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">{page.title}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => void handleStartBrowse(page)}
                            className="btn-ghost !px-2.5 !py-1 text-[11px]"
                          >
                            Browse
                          </button>
                          <button
                            onClick={() => void handleLinkContainer(page)}
                            disabled={!canManageConfig}
                            className="btn-primary !px-2.5 !py-1 text-[11px]"
                          >
                            <Link2 size={11} /> Link
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-gray-100 p-3 dark:border-gray-700">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    Folder/Subfolder Browser
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void handleBrowseBack()}
                      disabled={browseLoading || browseStack.length <= 1}
                      className="btn-ghost !px-2 !py-1 text-[11px]"
                    >
                      Back
                    </button>
                    <button
                      onClick={() => {
                        if (browseRoot) {
                          void loadBrowseChildren(browseRoot.id, [{ id: browseRoot.id, title: browseRoot.title }])
                        }
                      }}
                      disabled={browseLoading || !browseRoot}
                      className="btn-ghost !px-2 !py-1 text-[11px]"
                    >
                      Root
                    </button>
                  </div>
                </div>

                {!browseRoot ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Search for a folder/page and click Browse to start navigating subfolders before linking.
                  </p>
                ) : (
                  <>
                    <p className="mb-2 truncate text-[11px] text-gray-500 dark:text-gray-400">
                      Path: {browseStack.map(s => s.title).join(' / ')}
                    </p>
                    <div className="max-h-60 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-700">
                      {browseLoading ? (
                        <div className="flex items-center gap-2 px-3 py-4 text-xs text-gray-500 dark:text-gray-400">
                          <Loader2 size={12} className="animate-spin" /> Loading subfolders...
                        </div>
                      ) : browseError ? (
                        <div className="px-3 py-4 text-xs text-red-600 dark:text-red-400">{browseError}</div>
                      ) : browseItems.length === 0 ? (
                        <div className="px-3 py-4 text-xs text-gray-500 dark:text-gray-400">No child pages in this folder.</div>
                      ) : (
                        <div className="divide-y divide-gray-100 dark:divide-gray-700">
                          {browseItems.map(page => (
                            <div key={page.id} className="flex items-center justify-between gap-2 px-3 py-2">
                              <p className="min-w-0 flex-1 truncate text-xs font-medium text-gray-800 dark:text-gray-200">{page.title}</p>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => void handleOpenSubfolder(page)}
                                  className="btn-ghost !px-2 !py-1 text-[11px]"
                                >
                                  Open
                                </button>
                                <button
                                  onClick={() => void handleLinkContainer(page)}
                                  disabled={!canManageConfig}
                                  className="btn-primary !px-2 !py-1 text-[11px]"
                                >
                                  <Link2 size={10} /> Link
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleUnlinkContainer()}
                  disabled={!canManageConfig || !settings?.confluence_release_container_id}
                  className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  <Unlink size={12} /> Unlink Container
                </button>
              </div>

              {settingsMsg && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
                  <CheckCircle2 size={12} /> {settingsMsg}
                </div>
              )}
            </div>
          </section>

          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize release configuration panels"
            onMouseDown={() => setIsResizing(true)}
            className={`group relative w-2 shrink-0 cursor-col-resize ${isResizing ? 'bg-blue-100 dark:bg-blue-500/30' : ''}`}
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gray-200 transition group-hover:bg-blue-400 dark:bg-gray-700 dark:group-hover:bg-blue-400" />
          </div>

          <section
            className="min-h-0 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90"
            style={{ width: `${100 - leftPanelWidth}%` }}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Release Selection</h3>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  View subpages from the configured container and choose the active release.
                </p>
              </div>
              <button
                onClick={() => void loadReleasePages(settings?.confluence_release_container_id || '')}
                disabled={releasePagesLoading || !settings?.confluence_release_container_id}
                className="btn-ghost !px-2 !py-1 text-xs"
                title="Refresh release subpages"
              >
                <RefreshCcw size={12} className={releasePagesLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            <div className="space-y-3 p-4">
              {settings?.confluence_selected_release_page_title && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
                  <p className="font-semibold">Selected release: {settings.confluence_selected_release_page_title}</p>
                  {settings.confluence_selected_release_page_url && (
                    <a
                      href={settings.confluence_selected_release_page_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 underline"
                    >
                      Open selected release <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              )}

              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={releaseFilter}
                  onChange={e => setReleaseFilter(e.target.value)}
                  placeholder="Filter subpages by title..."
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-7 pr-3 text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                />
              </div>

              <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-700">
                {releasePagesLoading ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-xs text-gray-500 dark:text-gray-400">
                    <Loader2 size={12} className="animate-spin" /> Loading subpages...
                  </div>
                ) : releasePagesError ? (
                  <div className="px-3 py-4 text-xs text-red-600 dark:text-red-400">{releasePagesError}</div>
                ) : filteredReleasePages.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-gray-500 dark:text-gray-400">No subpages found under this container.</div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {filteredReleasePages.map(page => (
                      <label key={page.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <input
                          type="radio"
                          name="release-page"
                          value={page.id}
                          checked={selectedReleaseId === page.id}
                          onChange={() => setSelectedReleaseId(page.id)}
                          className="h-3.5 w-3.5"
                        />
                        <span className="min-w-0 flex-1 truncate text-xs text-gray-800 dark:text-gray-200">{page.title}</span>
                        <a href={page.url} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                          <ExternalLink size={12} />
                        </a>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleSaveSelectedRelease()}
                  disabled={!canManageConfig || !selectedReleaseId}
                  className="btn-primary !px-3 !py-1.5 text-xs"
                >
                  Save Selected Release
                </button>
                <button
                  onClick={() => void handleUnlinkSelectedRelease()}
                  disabled={!canManageConfig || !settings?.confluence_selected_release_page_id}
                  className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  <Unlink size={12} /> Unlink Release
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
