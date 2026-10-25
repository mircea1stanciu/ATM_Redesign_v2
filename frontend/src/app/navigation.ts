import {
  BarChart3, ClipboardList, GitPullRequest, GraduationCap, Home, PlayCircle, Rocket, Settings, Shield,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { hasPermission } from '@/hooks/usePermission'
import type { UserResponse } from '@/types/domain'

export interface Area {
  id: string
  label: string
  to: string
  icon: LucideIcon
  /** The area is shown when the user has any of these; none = every signed-in user. */
  permissions?: string[]
  /** Key pressed after `g` to jump here. */
  shortcut?: string
  description: string
}

/** The seven areas (docs/redesign/05-design.md, sections 5.3 and 5.4). */
export const AREAS: Area[] = [
  { id: 'home', label: 'Home', to: '/', icon: Home, shortcut: 'h', description: 'Your start page' },
  { id: 'work', label: 'Work', to: '/work', icon: ClipboardList, permissions: ['work.view'], shortcut: 'w',
    description: 'Jira stories and Confluence pages, the board and the workspace' },
  { id: 'tests', label: 'Tests', to: '/tests', icon: PlayCircle, permissions: ['run.view'], shortcut: 't',
    description: 'Runs, suites, environments, the project overview, scripts and libraries' },
  { id: 'reports', label: 'Reports', to: '/reports', icon: BarChart3, permissions: ['report.view'], shortcut: 'r',
    description: 'Results, trends and Allure reports' },
  { id: 'reviews', label: 'Reviews', to: '/reviews', icon: GitPullRequest, permissions: ['pr.view'], shortcut: 'v',
    description: 'Pull requests waiting for review' },
  { id: 'deployments', label: 'Deploys', to: '/deployments', icon: Rocket, permissions: ['deployment.view'],
    shortcut: 'd', description: 'Deployments to check' },
  { id: 'learning', label: 'Learning', to: '/learning', icon: GraduationCap, permissions: ['learning.use'],
    shortcut: 'l', description: 'Paths, lessons and practice' },
]

export const SECONDARY_AREAS: Area[] = [
  { id: 'admin', label: 'Admin', to: '/admin', icon: Shield, permissions: ['user.view', 'project.create', 'settings.system'],
    description: 'Users, projects, audit and e-mail' },
  { id: 'settings', label: 'Settings', to: '/settings', icon: Settings,
    description: 'Profile, connections and preferences' },
]

export function canOpen(user: UserResponse | null | undefined, permissions?: string[]): boolean {
  return !permissions || permissions.some(permission => hasPermission(user, permission))
}

export function visibleAreas(user: UserResponse | null | undefined, areas: Area[]): Area[] {
  return areas.filter(area => canOpen(user, area.permissions))
}

export interface AreaTab {
  to: string
  label: string
  permissions?: string[]
}

/** The tabs of each area; every tab is a URL. Used by the area layouts and the command palette. */
export const AREA_TABS: Record<string, AreaTab[]> = {
  work: [
    { to: '/work/inbox', label: 'Inbox' },
    { to: '/work/board', label: 'Board' },
    { to: '/work/jira', label: 'Jira tools' },
    { to: '/work/confluence', label: 'Confluence releases' },
    { to: '/work/confluence-analyzer', label: 'Release analyzer' },
    { to: '/work/workspace', label: 'Workspace' },
  ],
  tests: [
    { to: '/tests/runs', label: 'Runs' },
    { to: '/tests/suites', label: 'Suites' },
    { to: '/tests/environments', label: 'Environments' },
    { to: '/tests/project', label: 'Project' },
    { to: '/tests/scripts', label: 'Scripts' },
    { to: '/tests/libraries', label: 'Libraries' },
  ],
  reports: [
    { to: '/reports/list', label: 'Reports' },
    { to: '/reports/trends', label: 'Trends' },
    { to: '/reports/overview', label: 'Overview' },
    { to: '/reports/analytics', label: 'Analytics' },
    { to: '/reports/share-links', label: 'Share links', permissions: ['report.manage'] },
  ],
  reviews: [
    { to: '/reviews/waiting', label: 'Waiting for me' },
    { to: '/reviews/open', label: 'All open' },
  ],
  learning: [
    { to: '/learning/paths', label: 'Paths' },
    { to: '/learning/practice', label: 'Practice' },
    { to: '/learning/hints', label: 'Hints' },
    { to: '/learning/mentor', label: 'Mentor', permissions: ['learning.mentor'] },
    { to: '/learning/readiness', label: 'Readiness' },
  ],
  deployments: [
    { to: '/deployments/timeline', label: 'Timeline' },
    { to: '/deployments/services', label: 'Services' },
  ],
  admin: [
    { to: '/admin/users', label: 'Users', permissions: ['user.view'] },
    { to: '/admin/projects', label: 'Projects', permissions: ['project.create'] },
    { to: '/admin/audit', label: 'Audit', permissions: ['audit.view'] },
    { to: '/admin/email', label: 'E-mail', permissions: ['settings.system'] },
  ],
}

export function visibleTabs(user: UserResponse | null | undefined, areaId: string): AreaTab[] {
  return (AREA_TABS[areaId] ?? []).filter(tab => canOpen(user, tab.permissions))
}
