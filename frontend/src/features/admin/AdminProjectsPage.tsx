import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FolderGit2, Github, Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { usePermission } from '@/hooks/usePermission'
import { Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, IconButton, Input, Textarea, useToast } from '@/ui'
import type { Project } from '@/types/domain'

/** Admin › Projects: create and delete projects. Each project's links live in Settings › Connections for now. */
export default function AdminProjectsPage() {
  const projects = useAppStore(s => s.projects)
  const selectedProjectId = useAppStore(s => s.selectedProjectId)
  const setSelectedProjectId = useAppStore(s => s.setSelectedProjectId)
  const projectForm = useAppStore(s => s.projectForm)
  const setProjectForm = useAppStore(s => s.setProjectForm)
  const createProject = useAppStore(s => s.createProject)
  const deleteProject = useAppStore(s => s.deleteProject)
  const error = useAppStore(s => s.error)
  const canDelete = usePermission('project.delete')
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const createOpen = params.get('new') === '1'
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<Project | null>(null)
  const [toDelete, setToDelete] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState(false)

  const setCreateOpen = (open: boolean) => {
    if (open) {
      useAppStore.setState({ error: null })
      setProjectForm(p => ({ ...p, name: '', description: '', git_repo_url: '' }))
      setCreated(null)
    }
    setParams(p => { if (open) p.set('new', '1'); else p.delete('new'); return p }, { replace: true })
  }

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    setCreating(true)
    const project = await createProject()
    setCreating(false)
    if (project) setCreated(project)
  }

  const handleDelete = async () => {
    if (!toDelete) return
    setDeleting(true)
    await deleteProject(toDelete.id)
    setDeleting(false)
    toast({ title: `Deleted ${toDelete.name}`, tone: 'success' })
    setToDelete(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-fg-muted">{projects.length} project{projects.length === 1 ? '' : 's'} in your scope</p>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>New project</Button>
      </div>

      <Card>
        {projects.length === 0 ? (
          <EmptyState icon={FolderGit2} title="No projects yet">
            Create a project, then connect its GitHub repository, Jira project and Confluence space.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {projects.map(project => (
              <li key={project.id} className="flex items-center gap-3 px-4 py-3">
                <FolderGit2 size={16} className="shrink-0 text-fg-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-fg">{project.name}</p>
                  {project.description && <p className="truncate text-xs text-fg-muted">{project.description}</p>}
                </div>
                {project.id === selectedProjectId && <Badge tone="accent">Selected</Badge>}
                {canDelete && (
                  <IconButton label={`Delete ${project.name}`} icon={<Trash2 size={14} />} onClick={() => setToDelete(project)} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={created ? 'Project created' : 'New project'}>
        {created ? (
          <div className="space-y-4">
            <p className="text-[13px] text-fg"><span className="font-semibold">{created.name}</span> is ready.</p>
            <div className="flex items-start gap-3">
              <Github size={18} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden />
              <p className="text-[13px] text-fg-muted">
                Connect it to GitHub now: add the repository URL and an access token in Settings. Tests › Project then
                detects the languages, test frameworks, CI status and test files.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>Later</Button>
              <Button
                variant="primary"
                icon={<Github size={14} />}
                onClick={() => { setSelectedProjectId(created.id); setCreateOpen(false); navigate('/settings/mcp/github') }}
              >
                Connect GitHub
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreate} className="space-y-4">
            <Input label="Project name" placeholder="My Test Suite" required autoFocus value={projectForm.name}
              onChange={e => setProjectForm(p => ({ ...p, name: e.target.value }))} />
            <Textarea label="Description" placeholder="Optional" rows={3} value={projectForm.description}
              onChange={e => setProjectForm(p => ({ ...p, description: e.target.value }))} />
            {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={creating} disabled={!projectForm.name.trim()} icon={<Plus size={14} />}>
                Create project
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={open => { if (!open) setToDelete(null) }}
        title={`Delete ${toDelete?.name ?? 'project'}?`}
        description="This removes the project with all its suites and runs. It cannot be undone."
        confirmLabel="Delete project"
        destructive
        loading={deleting}
        onConfirm={() => void handleDelete()}
      />
    </div>
  )
}
