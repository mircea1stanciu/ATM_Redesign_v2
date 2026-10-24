import { useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart3, CheckCircle2, CircleDashed, ClipboardList, GitPullRequest, GraduationCap, PlayCircle, Users, XCircle,
} from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import { queryKeys } from '@/lib/queryKeys'
import { hasPermission } from '@/hooks/usePermission'
import { Badge, buttonStyles, EmptyState, ErrorState, Hint, PageHeader, Section, Skeleton, StatusPill } from '@/ui'
import { ROLE_LABELS } from '@/types/domain'
import type { UserRole } from '@/types/domain'
import { runDisplayName } from '@/utils/runName'
import { workApi, workKeys } from '@/features/work/api'
import { WORK_STATUS_LABELS } from '@/features/work/types'

function greeting(): string {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

function LinkButton({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="text-xs font-semibold text-accent hover:underline">{children}</Link>
}

/** The latest runs of the selected project. */
function LatestRuns({ title = 'Latest runs', failedOnly = false }: { title?: string; failedOnly?: boolean }) {
  const runs = useAppStore(s => s.runs)
  const latest = useMemo(() => [...runs]
    .filter(run => !failedOnly || run.status === 'failed' || run.status === 'error')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5), [runs, failedOnly])

  return (
    <Section title={title} actions={<LinkButton to="/tests/runs">All runs</LinkButton>}>
      {latest.length === 0 ? (
        <EmptyState icon={PlayCircle} title={failedOnly ? 'Nothing is failing' : 'No runs yet'}>
          {failedOnly ? 'The latest runs of this project passed.' : 'Runs of the selected project show here.'}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {latest.map(run => (
            <li key={run.id}>
              <Link
                to="/tests/runs"
                onClick={() => useAppStore.getState().setSelectedRunId(run.id)}
                className="flex items-center gap-3 py-2 text-[13px] hover:text-accent"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-fg">{runDisplayName(run)}</span>
                <span className="hidden text-xs text-fg-muted sm:inline">{new Date(run.created_at).toLocaleString()}</span>
                <StatusPill status={run.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

/** A part of Home whose feature comes in a later phase: says what will be here and where to go meanwhile. */
function Upcoming({ title, icon, children, link }: {
  title: string
  icon: typeof ClipboardList
  children: ReactNode
  link?: { to: string; label: string }
}) {
  return (
    <Section title={title} actions={link && <LinkButton to={link.to}>{link.label}</LinkButton>}>
      <EmptyState icon={icon} title="Nothing here yet">{children}</EmptyState>
    </Section>
  )
}

/** Work items of the selected project: mine (not done), or everything in progress and in review. */
function WorkItems({ title, mine = false }: { title: string; mine?: boolean }) {
  const projectId = useAppStore(s => s.selectedProjectId)
  const me = useAppStore(s => s.user?.id)
  const query = useQuery({
    queryKey: workKeys.items(projectId ?? ''),
    queryFn: () => workApi.items(projectId!),
    enabled: Boolean(projectId),
  })
  const items = (query.data ?? []).filter(item => mine
    ? item.assignee_id === me && item.status !== 'done'
    : item.status === 'in_progress' || item.status === 'in_review')
  return (
    <Section title={title} actions={<LinkButton to="/work/board">Board</LinkButton>}>
      {query.isPending && projectId ? <Skeleton className="h-20" /> : query.isError ? (
        <ErrorState title="Could not load work items">{apiService.errorMessage(query.error)}</ErrorState>
      ) : items.length === 0 ? (
        <EmptyState icon={ClipboardList} title={mine ? 'Nothing in progress' : 'No work in progress'}
          action={<Link to="/work/inbox" className={buttonStyles('secondary', 'sm')}>Open the inbox</Link>}>
          {mine ? 'Pick a story in Work › Inbox and start work on it.' : 'Nobody has started work on a story yet.'}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {items.slice(0, 6).map(item => (
            <li key={item.id}>
              <Link to={`/work/board?item=${item.id}`} className="flex items-center gap-3 py-2 text-[13px] hover:text-accent">
                <code className="shrink-0 text-xs text-fg-muted">{item.external_key}</code>
                <span className="min-w-0 flex-1 truncate font-medium text-fg">{item.title}</span>
                {!mine && <span className="hidden text-xs text-fg-muted sm:inline">{item.assignee_name || 'Unassigned'}</span>}
                <Badge tone="accent">{WORK_STATUS_LABELS[item.status]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function useUsers(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.users, queryFn: () => apiService.listUsers(), enabled })
}

function MyTeam() {
  const me = useAppStore(s => s.user)
  const { data, isPending, isError, error } = useUsers(true)
  const people = (data ?? []).filter(u => u.assigned_lead_id === me?.id)
  return (
    <Section title="My team" actions={<LinkButton to="/admin/users">Manage</LinkButton>}>
      {isPending ? <Skeleton className="h-20" /> : isError ? (
        <ErrorState title="Could not load your team">{apiService.errorMessage(error)}</ErrorState>
      ) : people.length === 0 ? (
        <EmptyState icon={Users} title="Nobody is assigned to you yet">
          Add people in Admin › Users; the people you create are assigned to you.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {people.map(person => (
            <li key={person.id} className="flex items-center gap-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate text-fg">{person.full_name || person.email}</span>
              <Badge>{ROLE_LABELS[person.role as UserRole] ?? person.role}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function SystemHealth() {
  const statuses = {
    GitHub: useAppStore(s => s.ghStatus),
    Jira: useAppStore(s => s.jiraStatus),
    Confluence: useAppStore(s => s.confluenceStatus),
  }
  const projects = useAppStore(s => s.projects)
  const users = useUsers(true)
  const icons = { ok: CheckCircle2, error: XCircle, none: CircleDashed }
  const tones = { ok: 'text-success', error: 'text-danger', none: 'text-fg-muted' }
  const words = { ok: 'Connected', error: 'Failing', none: 'Not configured' }
  return (
    <Section title="System health" actions={<LinkButton to="/settings/mcp/jira">Connections</LinkButton>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          {Object.entries(statuses).map(([name, status]) => {
            const Icon = icons[status]
            return (
              <div key={name} className="flex items-center gap-2 text-[13px]">
                <Icon size={14} className={tones[status]} aria-hidden />
                <span className="flex-1 text-fg">{name}</span>
                <span className="text-fg-muted">{words[status]}</span>
              </div>
            )
          })}
        </div>
        <dl className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-surface-2 p-3">
            <dt className="text-xs text-fg-muted">Users</dt>
            <dd className="text-[22px] font-semibold text-fg">{users.data ? users.data.filter(u => u.is_active).length : '…'}</dd>
          </div>
          <div className="rounded-lg bg-surface-2 p-3">
            <dt className="text-xs text-fg-muted">Projects</dt>
            <dd className="text-[22px] font-semibold text-fg">{projects.length}</dd>
          </div>
        </dl>
      </div>
    </Section>
  )
}

const TRAINEE_HINTS = [
  'A test without an assertion always passes. Check that every test ends with an expect(…).',
  'Name a branch after its story, for example feature/ABC-123-login-error, so reviewers find the context.',
  'Run the tests you changed before you open a pull request; reviewers see the run on the PR.',
  'Prefer stable selectors such as data-testid or roles over CSS classes that designers change.',
  'Keep one behaviour per test: when it fails, its name says what broke.',
]

export default function HomePage() {
  const user = useAppStore(s => s.user)
  const selectedProjectId = useAppStore(s => s.selectedProjectId)
  const projectName = useAppStore(s => s.projects.find(p => p.id === s.selectedProjectId)?.name)
  const loadProjectData = useAppStore(s => s.loadProjectData)
  const canViewRuns = hasPermission(user, 'run.view')

  useEffect(() => {
    if (selectedProjectId && canViewRuns) void loadProjectData(selectedProjectId)
  }, [selectedProjectId, canViewRuns, loadProjectData])

  const role = user?.role as UserRole | undefined
  const firstName = (user?.full_name || '').split(' ')[0]
  const description = [role ? ROLE_LABELS[role] : null, projectName].filter(Boolean).join(' · ')

  let content: ReactNode
  switch (role) {
    case undefined:
      content = (
        <>
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </>
      )
      break
    case 'super_admin':
      content = (
        <>
          <SystemHealth />
          <LatestRuns />
        </>
      )
      break
    case 'automation_lead':
      content = (
        <>
          <MyTeam />
          <WorkItems title="Work in progress" />
          <LatestRuns title="Failing runs" failedOnly />
          <Upcoming title="Open reviews" icon={GitPullRequest} link={{ to: '/reviews', label: 'Reviews' }}>
            Pull requests of your team that wait for a review will show here.
          </Upcoming>
          <Upcoming title="Trainees' progress" icon={GraduationCap} link={{ to: '/learning', label: 'Learning' }}>
            Lessons, practice and readiness requests of your trainees will show here.
          </Upcoming>
        </>
      )
      break
    case 'automation_trainee':
      content = (
        <>
          <Section title="My learning path">
            <EmptyState
              icon={GraduationCap}
              title="Continue where you left off"
              action={<Link to="/learning" className={buttonStyles('primary')}>Open Learning</Link>}
            >
              Lessons, quizzes and practice tasks that take you from manual testing to automation.
            </EmptyState>
          </Section>
          <WorkItems title="My work items" mine />
          <Section title="Hint for today">
            <Hint id={`daily-${new Date().toDateString()}`}>{TRAINEE_HINTS[new Date().getDate() % TRAINEE_HINTS.length]}</Hint>
          </Section>
        </>
      )
      break
    case 'viewer':
      content = (
        <>
          <LatestRuns title="Latest results" />
          <Section title="Reports" actions={<LinkButton to="/reports">Open Reports</LinkButton>}>
            <EmptyState icon={BarChart3} title="Pass rates and trends">
              Reports show the pass rate, duration and Allure reports of your projects.
            </EmptyState>
          </Section>
        </>
      )
      break
    default:
      content = (
        <>
          <WorkItems title="My work items" mine />
          {role === 'automation_senior' && (
            <Upcoming title="Waiting for my review" icon={GitPullRequest} link={{ to: '/reviews', label: 'Reviews' }}>
              Pull requests where you are a requested reviewer will show here.
            </Upcoming>
          )}
          <LatestRuns />
        </>
      )
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <PageHeader title={`${greeting()}${firstName ? `, ${firstName}` : ''}`} description={description} />
      <div className="grid gap-4 lg:grid-cols-2">{content}</div>
    </div>
  )
}
