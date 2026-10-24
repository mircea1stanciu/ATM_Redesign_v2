import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { apiService, CONNECTION_STATUS_CHANGED_EVENT } from '@/services/api'
import { canOpen } from '@/app/navigation'
import AppShell from '@/app/shell/AppShell'
import { Button, Skeleton } from '@/ui'
import LoginPage from '@/pages/LoginPage'
import HomePage from '@/features/home/HomePage'
import {
  AdminIndex, AdminLayout, DeploymentsPage, ReportsLayout, ReviewsPage, TestsLayout, WorkLayout,
} from '@/features/areas/areas'

const DashboardPage = lazy(() => import('@/pages/DashboardPage'))
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
const AdminProjectsPage = lazy(() => import('@/features/admin/AdminProjectsPage'))
const InboxPage = lazy(() => import('@/features/work/InboxPage'))
const BoardPage = lazy(() => import('@/features/work/BoardPage'))

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000
const INACTIVITY_WARNING_MS = 60 * 1000
const LAST_ACTIVITY_KEY = 'tm_last_activity_at'
const AUTH_EXPIRED_EVENT = 'atm:auth-expired'

function AuthGuard({ children }: { children: React.ReactNode }) {
  const token = useAppStore(s => s.token)
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** Opens the screen when the user has any of the permissions; otherwise goes Home. */
function RequirePermission({ any, children }: { any: string[]; children: React.ReactNode }) {
  const user = useAppStore(s => s.user)

  useEffect(() => {
    if (!user) {
      void apiService.me().then(profile => useAppStore.setState({ user: profile }))
    }
  }, [user])

  if (!user) return <>{children}</>
  if (!canOpen(user, any)) return <Navigate to="/" replace />
  return <>{children}</>
}

/** A moved screen: sends its old URL to the new one and keeps the query string (for example ?tab=assistant). */
function Moved({ to }: { to: string }) {
  const { search } = useLocation()
  return <Navigate to={`${to}${search}`} replace />
}

const MOVED: Array<[string, string]> = [
  ['projects', '/tests/project'],
  ['projects/repository', '/work/repository'],
  ['projects/ai', '/work/workspace'],
  ['projects/runs', '/tests/runs'],
  ['projects/library', '/tests/libraries'],
  ['projects/analytics', '/reports/analytics'],
  ['projects/requirements', '/work/jira'],
  ['projects/confluence/*', '/work/confluence'],
  ['jira-confluence', '/work/jira'],
  ['jira-confluence/jira', '/work/jira'],
  ['jira-confluence/confluence', '/work/confluence'],
  ['jira-confluence/confluence/configuration', '/work/confluence'],
  ['jira-confluence/confluence/analyzer', '/work/confluence-analyzer'],
  ['jira-projects', '/work/jira'],
  ['runs', '/tests/runs'],
  ['analytics', '/reports/analytics'],
  ['upskilling', '/learning'],
  ['users', '/admin/users'],
]

function PageFallback() {
  return (
    <div className="space-y-3" aria-label="Loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40" />
    </div>
  )
}

function InitLoader({ children }: { children: React.ReactNode }) {
  const token = useAppStore(s => s.token)
  const loadInitialData = useAppStore(s => s.loadInitialData)
  const refreshGithubStatus = useAppStore(s => s.refreshGithubStatus)
  const refreshJiraAndConfluenceStatus = useAppStore(s => s.refreshJiraAndConfluenceStatus)

  useEffect(() => {
    if (token) void loadInitialData()
  }, [token, loadInitialData])

  // Connection status refreshes on login (loadInitialData above) or when Settings reports a connection change,
  // never merely from switching pages.
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
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
          <div role="alertdialog" aria-labelledby="session-expiring" className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-float">
            <h2 id="session-expiring" className="text-[15px] font-semibold text-fg">Session expiring soon</h2>
            <p className="mt-2 text-[13px] text-fg-muted">
              You have been inactive. Your session will expire in {warningSecondsLeft}s.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={forceLogoutToLogin}>Logout now</Button>
              <Button variant="primary" onClick={() => setSessionRefreshKey(k => k + 1)}>Stay signed in</Button>
            </div>
          </div>
        </div>
      )}
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={<LoginGuard />} />
          <Route element={<AuthGuard><AppShell /></AuthGuard>}>
            <Route index element={<HomePage />} />
            <Route path="work" element={<RequirePermission any={['work.view']}><WorkLayout /></RequirePermission>}>
              <Route index element={<Navigate to="inbox" replace />} />
              <Route path="inbox" element={<InboxPage />} />
              <Route path="board" element={<BoardPage />} />
              <Route path="jira" element={<RequirementsTab />} />
              <Route path="confluence" element={<ConfluenceReleaseManagementTab />} />
              <Route path="confluence-analyzer" element={<ConfluenceReleaseManagementAnalyzerTab />} />
              <Route path="workspace" element={<AiImplementationTab />} />
              <Route path="repository" element={<RepositoryTab />} />
            </Route>
            <Route path="tests" element={<RequirePermission any={['run.view']}><TestsLayout /></RequirePermission>}>
              <Route index element={<Navigate to="runs" replace />} />
              <Route path="runs" element={<RunsPage />} />
              <Route path="project" element={<OverviewTab />} />
              <Route path="libraries" element={<LibraryTab />} />
            </Route>
            <Route path="reports" element={<RequirePermission any={['report.view']}><ReportsLayout /></RequirePermission>}>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<DashboardPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
            </Route>
            <Route path="reviews" element={<RequirePermission any={['pr.view']}><ReviewsPage /></RequirePermission>} />
            <Route path="deployments" element={<RequirePermission any={['deployment.view']}><DeploymentsPage /></RequirePermission>} />
            <Route path="learning" element={<RequirePermission any={['learning.use']}><UpskillingPage /></RequirePermission>} />
            {/* Community is hidden until phase 13 decides whether Q&A stays inside Learning; /community now
                falls through to Home. Its code stays in pages/CommunityPage.tsx and components/community/. */}
            <Route path="admin" element={<RequirePermission any={['user.view', 'project.create']}><AdminLayout /></RequirePermission>}>
              <Route index element={<AdminIndex />} />
              <Route path="users" element={<RequirePermission any={['user.view']}><UsersPage /></RequirePermission>} />
              <Route path="projects" element={<RequirePermission any={['project.create']}><AdminProjectsPage /></RequirePermission>} />
            </Route>
            <Route path="settings" element={<SettingsPage />} />
            <Route path="settings/:section" element={<SettingsPage />} />
            <Route path="settings/mcp/:mcp" element={<SettingsPage />} />
            {MOVED.map(([from, to]) => <Route key={from} path={from} element={<Moved to={to} />} />)}
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </InitLoader>
  )
}
