'use client'

import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  BookOpen, FolderGit2, Github, GraduationCap, LayoutDashboard,
  LogOut, Moon, Settings, Sun, Users, Zap, ChevronDown, Menu,
} from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { ROLE_LABELS, ROUTE_PERMISSIONS } from '@/types/domain'
import { hasPermission } from '@/hooks/usePermission'
import type { UserRole } from '@/types/domain'
import type { JiraProject } from '@/types/domain'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/projects', label: 'Projects', icon: FolderGit2 },
  { to: '/jira-confluence', label: 'Jira and Confluence', icon: BookOpen },
  { to: '/upskilling', label: 'Upskilling', icon: GraduationCap },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/settings', label: 'Settings', icon: Settings },
]

interface TopNavBarProps {
  jiraProjects: JiraProject[]
  activeJiraProjectKey: string
  activeConfluenceProjectLabel: string
  activeGitHubProjectLabel: string
  hasRunning: boolean
  isDark: boolean
  ghStatus: 'none' | 'ok' | 'error'
  jiraStatus: 'none' | 'ok' | 'error'
  confluenceStatus: 'none' | 'ok' | 'error'
  onThemeToggle: () => void
  onMobileMenuToggle: () => void
}

export default function TopNavBar({
  jiraProjects,
  activeJiraProjectKey,
  activeConfluenceProjectLabel,
  activeGitHubProjectLabel,
  hasRunning,
  isDark,
  ghStatus,
  jiraStatus,
  confluenceStatus,
  onThemeToggle,
  onMobileMenuToggle,
}: TopNavBarProps) {
  const user = useAppStore(s => s.user)
  const projects = useAppStore(s => s.projects)
  const selectedProjectId = useAppStore(s => s.selectedProjectId)
  const setSelectedProjectId = useAppStore(s => s.setSelectedProjectId)
  const logout = useAppStore(s => s.logout)
  const navigate = useNavigate()

  const [projectsDropdownOpen, setProjectsDropdownOpen] = useState(false)
  const [userDropdownOpen, setUserDropdownOpen] = useState(false)
  const projectsRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const activeJiraProjectLabel =
    jiraProjects.find(p => p.key === activeJiraProjectKey)
      ? `${activeJiraProjectKey} - ${jiraProjects.find(p => p.key === activeJiraProjectKey)?.name}`
      : (activeJiraProjectKey || 'No Jira project')

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (projectsRef.current && !projectsRef.current.contains(e.target as Node)) {
        setProjectsDropdownOpen(false)
      }
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setUserDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <header className="sticky top-0 z-40 w-full border-b border-gray-200/70 dark:border-gray-700/60 glass shadow-soft">
      <div className="h-16 px-4 flex items-center justify-between gap-4">
        {/* Mobile Menu Button */}
        <button
          onClick={onMobileMenuToggle}
          className="lg:hidden rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-all"
          title="Toggle menu"
        >
          <Menu size={18} />
        </button>

        {/* Logo Section */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
            <Zap size={16} className="text-white" />
          </div>
          <div className="hidden sm:block leading-tight">
            <p className="text-sm font-bold text-gray-900 dark:text-white">ATM</p>
            <p className="text-[9px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">TestManager</p>
          </div>
        </div>

        {/* Main Navigation */}
        <nav className="hidden lg:flex items-center gap-0.5 flex-1 mx-4">
          {NAV.filter(item => !ROUTE_PERMISSIONS[item.to] || hasPermission(user, ROUTE_PERMISSIONS[item.to])).map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `group relative flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 shadow-soft'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/70 dark:hover:bg-gray-800/70 hover:text-gray-900 dark:hover:text-gray-100'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon size={14} className={isActive ? '' : 'opacity-80 group-hover:opacity-100'} />
                  <span className="hidden xl:inline">{item.label}</span>
                  {item.to === '/projects' && hasRunning && (
                    <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                  )}
                  {isActive && (
                    <span className="absolute -bottom-px left-3 right-3 h-0.5 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Project Switcher Dropdown */}
        <div ref={projectsRef} className="relative hidden md:block">
          <button
            onClick={() => setProjectsDropdownOpen(!projectsDropdownOpen)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all group"
          >
            <span className="max-w-[140px] truncate text-xs">{activeGitHubProjectLabel}</span>
            <ChevronDown size={14} className={`transition-transform ${projectsDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {projectsDropdownOpen && (
            <div className="absolute right-0 mt-2 w-72 glass rounded-2xl border border-gray-200/70 dark:border-gray-700/60 shadow-soft-lg p-3 space-y-3 animate-scale-in origin-top-right">
              <div>
                <p className="kicker mb-2">Active Project</p>
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
              </div>

              <div>
                <p className="kicker mb-2">Active Jira Project</p>
                <div className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 truncate">
                  {activeJiraProjectLabel}
                </div>
              </div>

              <div>
                <p className="kicker mb-2">Active Confluence Project</p>
                <div className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 truncate">
                  {activeConfluenceProjectLabel}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-2">
          {/* Connection Status Indicators */}
          <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400" title={ghStatus === 'ok' ? 'GitHub: Connected' : ghStatus === 'error' ? 'GitHub: Connection failed or misconfigured' : 'GitHub: Not configured'}>
            <Github size={12} className={ghStatus === 'ok' ? 'text-emerald-500' : ghStatus === 'error' ? 'text-red-500' : 'text-gray-400'} />
            <span className={`h-1.5 w-1.5 rounded-full ${ghStatus === 'ok' ? 'bg-emerald-500' : ghStatus === 'error' ? 'bg-red-500' : 'bg-gray-400'}`} />
          </div>

          <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400" title={jiraStatus === 'ok' ? 'Jira: Connected' : jiraStatus === 'error' ? 'Jira: Connection failed or misconfigured' : 'Jira: Not configured'}>
            <span className="text-[10px] font-semibold">J</span>
            <span className={`h-1.5 w-1.5 rounded-full ${jiraStatus === 'ok' ? 'bg-emerald-500' : jiraStatus === 'error' ? 'bg-red-500' : 'bg-gray-400'}`} />
          </div>

          <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400" title={confluenceStatus === 'ok' ? 'Confluence: Connected' : confluenceStatus === 'error' ? 'Confluence: Connection failed or misconfigured' : 'Confluence: Not configured'}>
            <span className="text-[10px] font-semibold">C</span>
            <span className={`h-1.5 w-1.5 rounded-full ${confluenceStatus === 'ok' ? 'bg-emerald-500' : confluenceStatus === 'error' ? 'bg-red-500' : 'bg-gray-400'}`} />
          </div>

          {/* Theme Toggle */}
          <button
            onClick={onThemeToggle}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-all"
            title="Toggle theme"
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* User Dropdown */}
          <div ref={userRef} className="relative">
            <button
              onClick={() => setUserDropdownOpen(!userDropdownOpen)}
              aria-label="Account menu"
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-all group"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white shadow-soft">
                {user?.full_name?.[0] || user?.email?.[0] || 'U'}
              </div>
              <ChevronDown size={14} className={`text-gray-500 transition-transform ${userDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {userDropdownOpen && (
              <div className="absolute right-0 mt-2 w-48 glass rounded-2xl border border-gray-200/70 dark:border-gray-700/60 shadow-soft-lg p-3 space-y-2 animate-scale-in origin-top-right">
                <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {user?.full_name || user?.email || 'User'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {ROLE_LABELS[user?.role as UserRole] ?? user?.role}
                  </p>
                </div>

                <NavLink
                  to="/settings"
                  onClick={() => setUserDropdownOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
                >
                  <Settings size={14} />
                  Settings
                </NavLink>

                <button
                  onClick={() => {
                    setUserDropdownOpen(false)
                    handleLogout()
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                >
                  <LogOut size={14} />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
