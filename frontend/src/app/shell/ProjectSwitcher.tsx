import { useMemo, useState } from 'react'
import { Command } from 'cmdk'
import { Check, ChevronsUpDown, FolderGit2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { Popover } from '@/ui'

const RECENT_LIMIT = 5

function recentKey(userId: string | undefined) {
  return `atm_recent_projects:${userId ?? ''}`
}

function readRecent(userId: string | undefined): string[] {
  try {
    return JSON.parse(localStorage.getItem(recentKey(userId)) || '[]') as string[]
  } catch {
    return []
  }
}

/** Remembers a project as recently used, for the switcher's "Recent" group. */
export function rememberProject(userId: string | undefined, projectId: string) {
  try {
    const next = [projectId, ...readRecent(userId).filter(id => id !== projectId)].slice(0, RECENT_LIMIT)
    localStorage.setItem(recentKey(userId), JSON.stringify(next))
  } catch {
    // Storage unavailable: no recent list.
  }
}

/** The top bar's project switcher. It searches as you type and shows recent projects first. */
export default function ProjectSwitcher() {
  const projects = useAppStore(s => s.projects)
  const selectedProjectId = useAppStore(s => s.selectedProjectId)
  const setSelectedProjectId = useAppStore(s => s.setSelectedProjectId)
  const userId = useAppStore(s => s.user?.id)
  const [open, setOpen] = useState(false)

  const current = projects.find(p => p.id === selectedProjectId)
  const { recent, others } = useMemo(() => {
    const recentIds = readRecent(userId)
    const byId = new Map(projects.map(p => [p.id, p]))
    const recentProjects = recentIds.map(id => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))
    return { recent: recentProjects, others: projects.filter(p => !recentIds.includes(p.id)) }
    // Recompute whenever the menu opens, so a switch made elsewhere shows up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, userId, open])

  const choose = (projectId: string) => {
    setSelectedProjectId(projectId)
    rememberProject(userId, projectId)
    setOpen(false)
  }

  const item = (project: { id: string; name: string }) => (
    <Command.Item
      key={project.id}
      value={`${project.name} ${project.id}`}
      onSelect={() => choose(project.id)}
      className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-fg data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent"
    >
      <FolderGit2 size={14} className="shrink-0 text-fg-muted" aria-hidden />
      <span className="flex-1 truncate">{project.name}</span>
      {project.id === selectedProjectId && <Check size={14} aria-label="Selected" />}
    </Command.Item>
  )

  const heading = '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-muted'

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      className="w-72 p-0"
      trigger={(
        <button
          type="button"
          aria-label={`Switch project (current: ${current?.name ?? 'none'})`}
          className="flex h-8 max-w-[220px] items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-fg hover:bg-surface-2"
        >
          <FolderGit2 size={14} className="shrink-0 text-fg-muted" aria-hidden />
          <span className="truncate font-medium">{current?.name ?? (projects.length ? 'Choose a project' : 'No projects')}</span>
          <ChevronsUpDown size={14} className="shrink-0 text-fg-muted" aria-hidden />
        </button>
      )}
    >
      <Command label="Projects" className="flex flex-col">
        <Command.Input
          autoFocus
          placeholder="Search projects…"
          className="h-10 border-b border-line bg-transparent px-3 text-[13px] text-fg outline-none placeholder:text-fg-muted focus-visible:outline-none"
        />
        <Command.List className="max-h-72 overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-4 text-center text-[13px] text-fg-muted">No project found.</Command.Empty>
          {recent.length > 0 && <Command.Group heading="Recent" className={heading}>{recent.map(item)}</Command.Group>}
          {others.length > 0 && (
            <Command.Group heading={recent.length ? 'All projects' : 'Projects'} className={heading}>{others.map(item)}</Command.Group>
          )}
        </Command.List>
      </Command>
    </Popover>
  )
}
