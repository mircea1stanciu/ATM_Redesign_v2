import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store/useAppStore'
import { apiService, CONNECTION_STATUS_CHANGED_EVENT } from '@/services/api'
import { canAccess } from '@/types/domain'
import AppLayout from '@/components/layout/AppLayout'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'

const JiraAndConfluencePage = lazy(() => import('@/pages/JiraAndConfluencePage'))
const ProjectsLayout = lazy(() => import('@/pages/projects/ProjectsLayout'))
const OverviewTab = lazy(() => import('@/pages/projects/OverviewTab'))
const ConfluenceReleaseManagementTab = lazy(() => import('@/pages/projects/ConfluenceReleaseManagementTab'))
const ConfluenceReleaseManagementAnalyzerTab = lazy(() => import('@/pages/projects/ConfluenceReleaseManagementAnalyzerTab'))
const RequirementsTab = lazy(() => import('@/pages/projects/RequirementsTab'))
const RepositoryTab = lazy(() => import('@/pages/projects/RepositoryTab'))
const RunsPage = lazy(() => import('@/pages/RunsPage'))
const AiImplementationTab = lazy(() => import('@/pages/projects/AiImplementationTab'))
const LibraryTab = lazy(() => import('@/pages/projects/LibraryTab'))
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage'))
const UpskillingPage = lazy(() => import('@/pages/UpskillingPage'))
const UsersPage = lazy(() => import('@/pages/UsersPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000
const INACTIVITY_WARNING_MS = 60 * 1000
const LAST_ACTIVITY_KEY = 'tm_last_activity_at'
const AUTH_EXPIRED_EVENT = 'atm:auth-expired'

function AuthGuard({ children }: { children: React.ReactNode }) {
  const token = useAppStore(s => s.token)
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RoleGuard({ path, children }: { path: string; children: React.ReactNode }) {
  const user = useAppStore(s => s.user)

  useEffect(() => {
    if (!user) {
      void apiService.me().then(profile => useAppStore.setState({ user: profile }))
    }
  }, [user])

  if (!user) return <>{children}</>
  if (!canAccess(user?.role, path)) return <Navigate to="/" replace />
  return <>{children}</>
}

function InitLoader({ children }: { children: React.ReactNode }) {
  const token = useAppStore(s => s.token)
  const loadInitialData = useAppStore(s => s.loadInitialData)
  const refreshGithubStatus = useAppStore(s => s.refreshGithubStatus)
  const refreshJiraAndConfluenceStatus = useAppStore(s => s.refreshJiraAndConfluenceStatus)

  useEffect(() => {
    if (token) void loadInitialData()
  }, [token, loadInitialData])

  // Registered once here (outside the animated/keyed <Routes> tree, which
  // remounts AppLayout on every navigation) so connection status only
  // refreshes on login (loadInitialData above) or when Settings reports a
  // connection change — never merely from switching pages.
  useEffect(() => {
    const onConnectionChanged = (event: Event) => {
      const kind = (event as CustomEvent<{ kind?: 'github' | 'jira' | 'confluence' }>).detail?.kind
      if (kind === 'github') {
        void refreshGithubStatus()
      } else if (kind === 'jira' || kind === 'confluence') {
        void refreshJiraAndConfluenceStatus()
      }
    }
    window.addEventListener(CONNECTION_STATUS_CHANGED_EVENT, onConnectionChanged)
    return () => window.removeEventListener(CONNECTION_STATUS_CHANGED_EVENT, onConnectionChanged)
  }, [refreshGithubStatus, refreshJiraAndConfluenceStatus])

  return <>{children}</>
}

function LoginGuard() {
  const token = useAppStore(s => s.token)
  if (token) return <Navigate to="/" replace />
  return <LoginPage />
}

export default function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const token = useAppStore(s => s.token)
  const logout = useAppStore(s => s.logout)
  const [showInactivityWarning, setShowInactivityWarning] = useState(false)
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0)
  const [warningSecondsLeft, setWarningSecondsLeft] = useState(60)

  const forceLogoutToLogin = useCallback(() => {
    setShowInactivityWarning(false)
    logout()
    navigate('/login', { replace: true })
  }, [logout, navigate])

  useEffect(() => {
    if (!token) {
      setShowInactivityWarning(false)
      return
    }

    const now = Date.now()
    const saved = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || now)
    const elapsedMs = now - saved
    if (elapsedMs >= INACTIVITY_TIMEOUT_MS) {
      forceLogoutToLogin()
      return
    }

    let warningTimeoutId: number | undefined
    let logoutTimeoutId: number | undefined

    const clearTimers = () => {
      if (warningTimeoutId) window.clearTimeout(warningTimeoutId)
      if (logoutTimeoutId) window.clearTimeout(logoutTimeoutId)
    }

    const scheduleTimeouts = (remainingMs: number) => {
      clearTimers()

      const warningDelay = remainingMs - INACTIVITY_WARNING_MS
      if (warningDelay <= 0) {
        setShowInactivityWarning(true)
        setWarningSecondsLeft(Math.max(1, Math.ceil(remainingMs / 1000)))
      } else {
        setShowInactivityWarning(false)
        warningTimeoutId = window.setTimeout(() => {
          setShowInactivityWarning(true)
          setWarningSecondsLeft(60)
        }, warningDelay)
      }

      logoutTimeoutId = window.setTimeout(() => {
        forceLogoutToLogin()
      }, remainingMs)
    }

    const resetInactivityTimer = () => {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()))
      setShowInactivityWarning(false)
      setWarningSecondsLeft(60)
      scheduleTimeouts(INACTIVITY_TIMEOUT_MS)
    }

    const activityEvents: Array<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
      'click',
    ]

    for (const eventName of activityEvents) {
      window.addEventListener(eventName, resetInactivityTimer, { passive: true })
    }

    scheduleTimeouts(INACTIVITY_TIMEOUT_MS - elapsedMs)

    return () => {
      clearTimers()
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, resetInactivityTimer)
      }
    }
  }, [token, forceLogoutToLogin, sessionRefreshKey])

  useEffect(() => {
    if (!showInactivityWarning || !token) return

    const intervalId = window.setInterval(() => {
      setWarningSecondsLeft((prev) => Math.max(0, prev - 1))
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [showInactivityWarning, token])

  useEffect(() => {
    const onAuthExpired = () => {
      forceLogoutToLogin()
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired)
  }, [forceLogoutToLogin])

  return (
    <InitLoader>
      {showInactivityWarning && token && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/55 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Session expiring soon</h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              You have been inactive. Your session will expire in {warningSecondsLeft}s.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={forceLogoutToLogin}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Logout now
              </button>
              <button
                type="button"
                onClick={() => setSessionRefreshKey(k => k + 1)}
                className="rounded-md bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700"
              >
                Stay signed in
              </button>
            </div>
          </div>
        </div>
      )}
      <AnimatePresence mode="wait">
        <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading…</div>}>
        <Routes location={location} key={location.pathname}>
          <Route path="/login" element={<LoginGuard />} />
          <Route element={<AuthGuard><AppLayout /></AuthGuard>}>
            <Route index element={<DashboardPage />} />
            <Route path="projects" element={<RoleGuard path="/projects"><ProjectsLayout /></RoleGuard>}>
              <Route index element={<OverviewTab />} />
              <Route path="confluence/*" element={<Navigate to="/jira-confluence/confluence/configuration" replace />} />
              <Route path="requirements" element={<Navigate to="/jira-confluence/jira" replace />} />
              <Route path="repository" element={<RepositoryTab />} />
              <Route path="ai" element={<AiImplementationTab />} />
              <Route path="runs" element={<RunsPage />} />
              <Route path="library" element={<LibraryTab />} />
              <Route path="analytics" element={<AnalyticsPage />} />
            </Route>
            <Route path="jira-confluence" element={<RoleGuard path="/jira-confluence"><JiraAndConfluencePage /></RoleGuard>}>
              <Route index element={<Navigate to="jira" replace />} />
              <Route path="jira" element={<RequirementsTab />} />
              <Route path="confluence" element={<Navigate to="configuration" replace />} />
              <Route path="confluence/configuration" element={<ConfluenceReleaseManagementTab />} />
              <Route path="confluence/analyzer" element={<ConfluenceReleaseManagementAnalyzerTab />} />
            </Route>
            <Route path="upskilling" element={<RoleGuard path="/upskilling"><UpskillingPage /></RoleGuard>} />
            {/* Community is hidden until phase 13 decides whether Q&A stays inside Learning; /community now
                falls through to Home. Its code stays in pages/CommunityPage.tsx and components/community/. */}
            {/* Legacy route redirects into the unified Projects hub */}
            <Route path="jira-projects" element={<Navigate to="/jira-confluence/jira" replace />} />
            <Route path="runs" element={<Navigate to="/projects/runs" replace />} />
            <Route path="analytics" element={<Navigate to="/projects/analytics" replace />} />
            <Route path="users"     element={<RoleGuard path="/users"><UsersPage /></RoleGuard>} />
            <Route path="settings"  element={<RoleGuard path="/settings"><SettingsPage /></RoleGuard>} />
            <Route path="settings/:section" element={<RoleGuard path="/settings"><SettingsPage /></RoleGuard>} />
            <Route path="settings/mcp/:mcp" element={<RoleGuard path="/settings"><SettingsPage /></RoleGuard>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </AnimatePresence>
    </InitLoader>
  )
}
