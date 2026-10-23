import { Outlet, useNavigate, NavLink } from 'react-router-dom'
import {
  BookOpen, FolderGit2, GraduationCap, LayoutDashboard,
  LogOut, Settings, Users, X, Zap,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { ROLE_LABELS, canAccess } from '@/types/domain'
import type { UserRole } from '@/types/domain'
import TopNavBar from './TopNavBar'

const NAV = [
  { to: '/',          label: 'Dashboard', icon: LayoutDashboard },
  { to: '/projects',  label: 'Projects',  icon: FolderGit2 },
  { to: '/jira-confluence', label: 'Jira and Confluence', icon: BookOpen },
  { to: '/upskilling', label: 'Upskilling', icon: GraduationCap },
  { to: '/users',     label: 'Users',      icon: Users },
  { to: '/settings',  label: 'Settings',   icon: Settings },
]

export default function AppLayout() {
  const user = useAppStore(s => s.user)
  const projects = useAppStore(s => s.projects)
  const selectedProjectId = useAppStore(s => s.selectedProjectId)
  const setSelectedProjectId = useAppStore(s => s.setSelectedProjectId)
  const runs = useAppStore(s => s.runs)
  const logout = useAppStore(s => s.logout)
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  // Connection status lives in the global store (see useAppStore) so it
  // survives AppLayout being remounted on every route change (the animated
  // <Routes key={location.pathname}> in App.tsx unmounts/remounts this
  // component on navigation). It's only refreshed on login or when Settings
  // reports a connection change — never merely from switching pages.
  const jiraProjects = useAppStore(s => s.jiraProjects)
  const activeJiraProjectKey = useAppStore(s => s.activeJiraProjectKey)
  const activeConfluenceProjectLabel = useAppStore(s => s.activeConfluenceProjectLabel)
  const ghStatus = useAppStore(s => s.ghStatus)
  const jiraStatus = useAppStore(s => s.jiraStatus)
  const confluenceStatus = useAppStore(s => s.confluenceStatus)
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains('dark') ||
    localStorage.getItem('theme') === 'dark' ||
    (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
  }, [isDark])

  const hasRunning = runs.some(r => r.status === 'running')
  const handleLogout = () => { logout(); navigate('/login') }
  const activeJiraProjectLabel =
    jiraProjects.find(p => p.key === activeJiraProjectKey)
      ? `${activeJiraProjectKey} - ${jiraProjects.find(p => p.key === activeJiraProjectKey)?.name}`
      : (activeJiraProjectKey || 'No Jira project selected')
  const activeGitHubProjectLabel =
    projects.find(p => p.id === selectedProjectId)?.name || 'No GitHub project selected'

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-200 dark:border-gray-700">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
          <Zap size={16} className="text-white" />
        </div>
        <div>
          <span className="text-sm font-bold text-gray-900 dark:text-white">AutomationTestManager</span>
          <p className="text-[10px] text-gray-500 dark:text-gray-400">(ATM)</p>
        </div>
      </div>

      {/* Project selectors */}
      <div className="px-4 py-4">
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
          Active Project
        </label>
        {projects.length === 0 ? (
          <div className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
            No projects yet
          </div>
        ) : (
          <select
            value={selectedProjectId || ''}
            onChange={e => setSelectedProjectId(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-300"
          >
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}

        <label className="mb-1.5 mt-3 block text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
          Active Jira Project
        </label>
        <div className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 px-3 py-2 text-xs text-gray-700 dark:text-gray-300">
          {activeJiraProjectLabel}
        </div>

        <label className="mb-1.5 mt-3 block text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
          Active Confluence Project
        </label>
        <div className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 px-3 py-2 text-xs text-gray-700 dark:text-gray-300">
          {activeConfluenceProjectLabel}
        </div>
      </div>

      <div className="mx-4 border-t border-gray-200 dark:border-gray-700" />

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV.filter(item => canAccess(user?.role, item.to)).map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                  isActive
                    ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400'
                    : 'text-gray-500 dark:text-gray-500 group-hover:text-gray-700 dark:group-hover:text-gray-300'
                }`}>
                  <item.icon size={16} />
                </div>
                {item.label}
                {item.to === '/projects' && hasRunning && (
                  <span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User section */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white shadow-soft">
            {user?.full_name?.[0] || user?.email?.[0] || 'U'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {user?.full_name || user?.email || 'User'}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {ROLE_LABELS[user?.role as UserRole] ?? user?.role}
            </p>
          </div>
          <button
            onClick={handleLogout}
            title="Logout"
            className="rounded-lg p-2 text-gray-400 transition hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </>
  )

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface-50 dark:bg-surface-950">
      {/* Top Navigation Bar */}
      <TopNavBar
        jiraProjects={jiraProjects}
        activeJiraProjectKey={activeJiraProjectKey}
        activeGitHubProjectLabel={activeGitHubProjectLabel}
        hasRunning={hasRunning}
        isDark={isDark}
        ghStatus={ghStatus}
        jiraStatus={jiraStatus}
        confluenceStatus={confluenceStatus}
        activeConfluenceProjectLabel={activeConfluenceProjectLabel}
        onThemeToggle={() => setIsDark(d => !d)}
        onMobileMenuToggle={() => setMobileOpen(true)}
      />

      {/* Mobile menu button and content */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-[280px] flex-col glass shadow-2xl overflow-y-auto animate-slide-up">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-3 rounded-lg p-2 text-gray-400 hover:text-gray-900 dark:hover:text-white z-10">
              <X size={18} />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main content - now full width */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Page content */}
        <main className="flex-1 overflow-hidden p-3 md:p-6">
          <div className="mx-auto h-full max-w-full animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
