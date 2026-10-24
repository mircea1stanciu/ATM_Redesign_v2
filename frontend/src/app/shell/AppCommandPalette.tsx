import { useNavigate } from 'react-router-dom'
import { ArrowRight, FolderGit2, Keyboard, LogOut, Moon, Play, Plus } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { useTheme } from '@/app/theme'
import { AREAS, SECONDARY_AREAS, visibleAreas, visibleTabs } from '@/app/navigation'
import { hasPermission } from '@/hooks/usePermission'
import { CommandPalette, Kbd } from '@/ui'
import type { CommandGroup } from '@/ui'
import { runDisplayName } from '@/utils/runName'
import { rememberProject } from './ProjectSwitcher'

const RECENT_RUNS = 8

/** The ⌘K palette: areas and their tabs, projects, recent runs and actions. */
export default function AppCommandPalette({ open, onOpenChange, onShowShortcuts }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onShowShortcuts: () => void
}) {
  const navigate = useNavigate()
  const user = useAppStore(s => s.user)
  const projects = useAppStore(s => s.projects)
  const runs = useAppStore(s => s.runs)
  const toggleTheme = useTheme(s => s.toggle)

  const areas = [...visibleAreas(user, AREAS), ...visibleAreas(user, SECONDARY_AREAS)]
  const groups: CommandGroup[] = [
    {
      heading: 'Go to',
      items: areas.flatMap(area => [
        {
          id: area.to,
          label: area.label,
          keywords: [area.description],
          icon: <area.icon size={14} />,
          shortcut: area.shortcut ? <span className="flex gap-0.5"><Kbd>G</Kbd><Kbd>{area.shortcut.toUpperCase()}</Kbd></span> : undefined,
          onSelect: () => navigate(area.to),
        },
        ...visibleTabs(user, area.id).map(tab => ({
          id: tab.to,
          label: `${area.label} › ${tab.label}`,
          icon: <ArrowRight size={14} />,
          onSelect: () => navigate(tab.to),
        })),
      ]),
    },
    {
      heading: 'Projects',
      items: projects.map(project => ({
        id: `project-${project.id}`,
        label: `Switch to ${project.name}`,
        icon: <FolderGit2 size={14} />,
        onSelect: () => {
          useAppStore.getState().setSelectedProjectId(project.id)
          rememberProject(user?.id, project.id)
        },
      })),
    },
    {
      heading: 'Recent runs',
      items: hasPermission(user, 'run.view')
        ? [...runs]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, RECENT_RUNS)
          .map(run => ({
            id: `run-${run.id}`,
            label: `${runDisplayName(run)} (${run.status})`,
            icon: <Play size={14} />,
            onSelect: () => {
              useAppStore.getState().setSelectedRunId(run.id)
              navigate('/tests/runs')
            },
          }))
        : [],
    },
    {
      heading: 'Actions',
      items: [
        ...(hasPermission(user, 'project.create')
          ? [{ id: 'new-project', label: 'New project', icon: <Plus size={14} />, onSelect: () => navigate('/admin/projects?new=1') }]
          : []),
        { id: 'theme', label: 'Toggle theme', icon: <Moon size={14} />, onSelect: toggleTheme },
        { id: 'shortcuts', label: 'Keyboard shortcuts', icon: <Keyboard size={14} />, shortcut: <Kbd>?</Kbd>, onSelect: onShowShortcuts },
        {
          id: 'sign-out',
          label: 'Sign out',
          icon: <LogOut size={14} />,
          onSelect: () => { useAppStore.getState().logout(); navigate('/login') },
        },
      ],
    },
  ]

  return <CommandPalette open={open} onOpenChange={onOpenChange} groups={groups} />
}
