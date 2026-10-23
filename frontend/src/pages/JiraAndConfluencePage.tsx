import { BookOpen, ClipboardList } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'

const TABS = [
  { to: '/jira-confluence/jira', label: 'Jira Management', icon: ClipboardList },
  { to: '/jira-confluence/confluence', label: 'Confluence Release Management', icon: BookOpen },
]

export default function JiraAndConfluencePage() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header className="shrink-0 rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-glow">
            <BookOpen size={18} />
          </div>
          <div>
            <p className="kicker">Integrations</p>
            <h1 className="text-sm font-semibold text-gray-900 dark:text-white">Jira and Confluence</h1>
          </div>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto px-3 py-2">
          {TABS.map(tab => {
            const Icon = tab.icon
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) => `flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-blue-50 text-blue-600 shadow-soft dark:bg-blue-500/10 dark:text-blue-400'
                    : 'text-gray-600 hover:bg-gray-100/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/70 dark:hover:text-gray-100'
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </NavLink>
            )
          })}
        </nav>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  )
}