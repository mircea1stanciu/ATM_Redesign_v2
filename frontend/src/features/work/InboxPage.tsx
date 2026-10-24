import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { BookOpen, ClipboardList, Search } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, Tabs, buttonStyles, useTabParam } from '@/ui'
import { workApi, workKeys } from './api'
import type { JiraInboxFilters } from './api'
import StoryPanel from './StoryPanel'
import { KIND_LABELS, WORK_STATUS_LABELS } from './types'
import type { InboxEntry, InboxPage as Page, WorkSource } from './types'

const SOURCES = ['jira', 'confluence'] as const
const SEARCH_DELAY_MS = 300

const SELECT = 'h-8 rounded-lg border border-line bg-surface px-2 text-[13px] text-fg focus:border-brand focus:outline-none'

/** A filter kept in the URL, so refresh and shared links keep the view. */
function useParam(name: string): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(name) ?? ''
  // Read the live URL: the delayed search update must not write back filters from an older render.
  const set = (next: string) => {
    const current = new URLSearchParams(window.location.search)
    if (next) current.set(name, next)
    else current.delete(name)
    setParams(current, { replace: true })
  }
  return [value, set]
}

function NotConfigured({ message }: { message: string }) {
  return (
    <ErrorState title="Not connected yet" action={(
      <div className="flex gap-2">
        <Link to="/settings/mcp/jira" className={buttonStyles('secondary', 'sm')}>Settings › Connections</Link>
        <Link to="/admin/projects" className={buttonStyles('ghost', 'sm')}>Admin › Projects</Link>
      </div>
    )}>
      {message}
    </ErrorState>
  )
}

function Row({ entry, source, onOpen }: { entry: InboxEntry; source: WorkSource; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] hover:bg-surface-2 focus-visible:bg-surface-2">
        <code className="w-24 shrink-0 truncate text-xs text-fg-muted">{source === 'jira' ? entry.key : `#${entry.key}`}</code>
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{entry.title}</span>
        {entry.work_item && <Badge tone="accent">{WORK_STATUS_LABELS[entry.work_item.status]}</Badge>}
        {source === 'jira' && <Badge tone="info" className="hidden sm:inline-flex">{entry.issue_type || KIND_LABELS[entry.kind]}</Badge>}
        {entry.status && <Badge className="hidden md:inline-flex">{entry.status}</Badge>}
        <span className="hidden w-32 shrink-0 truncate text-xs text-fg-muted lg:inline">
          {source === 'jira' ? (entry.assignee || 'Unassigned') : (entry.author || '')}
        </span>
      </button>
    </li>
  )
}

/** Work › Inbox: the project's Jira stories and Confluence requirement pages, with the detail panel. */
export default function InboxPage() {
  const projectId = useAppStore(s => s.selectedProjectId)
  const source = useTabParam('source', SOURCES)
  const [openKey, setOpenKey] = useParam('item')
  const [q, setQ] = useParam('q')
  const [status, setStatus] = useParam('status')
  const [type, setType] = useParam('type')
  const [assignee, setAssignee] = useParam('assignee')
  const [sprint, setSprint] = useParam('sprint')
  const [label, setLabel] = useParam('label')
  const [search, setSearch] = useState(q)

  useEffect(() => {
    const timer = window.setTimeout(() => { if (search !== q) setQ(search) }, SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
    // setQ changes identity with the URL; only the typed text matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const filters: JiraInboxFilters = {
    q, status, type, label,
    assignee: assignee as JiraInboxFilters['assignee'],
    sprint: sprint as JiraInboxFilters['sprint'],
  }
  const jiraFilters = useQuery({
    queryKey: workKeys.jiraFilters(projectId ?? ''),
    queryFn: () => workApi.jiraFilters(projectId!),
    enabled: Boolean(projectId) && source === 'jira',
    retry: false,
  })
  const list = useInfiniteQuery<Page>({
    queryKey: source === 'jira' ? workKeys.jiraIssues(projectId ?? '', filters) : workKeys.confluencePages(projectId ?? '', q),
    queryFn: ({ pageParam }) => source === 'jira'
      ? workApi.jiraIssues(projectId!, filters, pageParam as number)
      : workApi.confluencePages(projectId!, q, pageParam as number),
    initialPageParam: 0,
    getNextPageParam: last => last.next_cursor ?? undefined,
    enabled: Boolean(projectId),
    retry: false,
  })

  if (!projectId) {
    return <EmptyState icon={ClipboardList} title="Choose a project">Pick a project in the top bar to see its stories.</EmptyState>
  }

  const entries = list.data?.pages.flatMap(page => page.items) ?? []
  const total = list.data?.pages[0]?.total

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Tabs label="Inbox source" param="source" items={[
        { to: 'jira', label: 'Jira stories', icon: ClipboardList },
        { to: 'confluence', label: 'Confluence pages', icon: BookOpen },
      ]} />

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search {source === 'jira' ? 'stories' : 'pages'}</span>
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" aria-hidden />
          <input data-list-search value={search} onChange={e => setSearch(e.target.value)}
            placeholder={source === 'jira' ? 'Search text or a key like ABC-123' : 'Search page titles and text'}
            className="h-8 w-full rounded-lg border border-line bg-surface pl-8 pr-3 text-[13px] text-fg placeholder:text-fg-muted focus:border-brand focus:outline-none" />
        </label>
        {source === 'jira' && (
          <>
            <select aria-label="Type" value={type} onChange={e => setType(e.target.value)} className={SELECT}>
              <option value="">Stories</option>
              <option value="all">All types</option>
              {jiraFilters.data?.issue_types.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <select aria-label="Status" value={status} onChange={e => setStatus(e.target.value)} className={SELECT}>
              <option value="">Any status</option>
              {jiraFilters.data?.statuses.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <select aria-label="Assignee" value={assignee} onChange={e => setAssignee(e.target.value)} className={SELECT}>
              <option value="">Anyone</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
            </select>
            <select aria-label="Sprint" value={sprint} onChange={e => setSprint(e.target.value)} className={SELECT}>
              <option value="">Any sprint</option>
              <option value="current">Current sprint</option>
            </select>
            <input aria-label="Label" value={label} onChange={e => setLabel(e.target.value.trim())} placeholder="Label"
              className={`${SELECT} w-28`} />
          </>
        )}
      </div>

      <Card className="min-h-0 flex-1 overflow-y-auto">
        {list.isPending ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-8" />)}</div>
        ) : list.isError ? (
          <div className="p-4">
            <NotConfigured message={apiService.errorMessage(list.error)} />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState icon={source === 'jira' ? ClipboardList : BookOpen} title="Nothing found">
            {q || status || type || assignee || sprint || label ? 'No match for these filters.' : 'This project has none yet.'}
          </EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-line" aria-label={source === 'jira' ? 'Jira stories' : 'Confluence pages'}>
              {entries.map(entry => (
                <Row key={entry.key} entry={entry} source={source} onOpen={() => setOpenKey(entry.key)} />
              ))}
            </ul>
            <div className="flex items-center justify-between px-4 py-3 text-xs text-fg-muted">
              <span>{total !== undefined ? `${entries.length} of ${total}` : `${entries.length} shown`}</span>
              {list.hasNextPage && (
                <Button size="sm" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button>
              )}
            </div>
          </>
        )}
      </Card>

      {/* Jira keys look like ABC-123, Confluence page ids are numbers: a key left over from the other tab stays closed. */}
      <StoryPanel projectId={projectId} source={source}
        itemKey={openKey && (source === 'jira' ? openKey.includes('-') : /^\d+$/.test(openKey)) ? openKey : null}
        onClose={() => setOpenKey('')} />
    </div>
  )
}
