import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FolderGit2, Github, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import { usePermission } from '@/hooks/usePermission'
import { Badge, Button, Card, Checkbox, ConfirmDialog, Dialog, EmptyState, IconButton, Input, Textarea, useToast } from '@/ui'
import type { Project } from '@/types/domain'
import ServiceAccountSection from './ServiceAccountSection'

/** Admin › Projects: create and delete projects, and choose each project's Jira project and Confluence space. */
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
  const canConfigureDeployments = usePermission('deployment.configure')
  const canSetServiceAccount = usePermission('project.service_account')
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const createOpen = params.get('new') === '1'
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<Project | null>(null)
  const [toDelete, setToDelete] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [jiraKey, setJiraKey] = useState('')
  const [spaceKey, setSpaceKey] = useState('')
  const [parentPage, setParentPage] = useState('')
  const [teamsUrl, setTeamsUrl] = useState('')
  const [removeTeams, setRemoveTeams] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const openEdit = (project: Project) => {
    setEditing(project)
    setJiraKey(project.jira_project_key ?? '')
    setSpaceKey(project.confluence_space_key ?? '')
    setParentPage(project.confluence_parent_page_id ?? '')
    setTeamsUrl('')
    setRemoveTeams(false)
    setSaveError(null)
  }

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing) return
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await apiService.updateProject(editing.id, {
        jira_project_key: jiraKey, confluence_space_key: spaceKey, confluence_parent_page_id: parentPage,
        // Write-only: sent when replaced or removed.
        ...(teamsUrl.trim() ? { teams_webhook: teamsUrl.trim() } : removeTeams ? { teams_webhook: '' } : {}),
      })
      useAppStore.setState(state => ({
        projects: state.projects.map(p => p.id === updated.id ? { ...p, ...updated } : p),
      }))
      toast({ title: `Saved ${updated.name}`, tone: 'success' })
      setEditing(null)
    } catch (e) {
      setSaveError(apiService.errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

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
                  <p className="truncate text-xs text-fg-muted">
                    Jira: {project.jira_project_key || '—'} · Confluence: {project.confluence_space_key || '—'}
                  </p>
                </div>
                {project.id === selectedProjectId && <Badge tone="accent">Selected</Badge>}
                <IconButton label={`Edit ${project.name}`} icon={<Pencil size={14} />} onClick={() => openEdit(project)} />
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

      <Dialog open={editing !== null} onOpenChange={open => { if (!open) setEditing(null) }}
        title={`Edit ${editing?.name ?? 'project'}`}
        description="Where the project's stories and requirement pages live. Work › Inbox lists them.">
        <form onSubmit={handleSave} className="space-y-4">
          <Input label="Jira project key" placeholder="ABC" value={jiraKey} onChange={e => setJiraKey(e.target.value)}
            help="Empty: the team's Jira project from Settings › Connections." />
          <Input label="Confluence space key" placeholder="REQ" value={spaceKey} onChange={e => setSpaceKey(e.target.value)}
            help="Empty: the team's Confluence space from Settings › Connections." />
          <Input label="Confluence parent page id (test reports)" placeholder="123456" value={parentPage}
            onChange={e => setParentPage(e.target.value)} inputMode="numeric"
            help="Test report pages are published under this page (its number is in the page's URL)." />
          {canConfigureDeployments && (
            <div className="space-y-2">
              <Input label="Microsoft Teams webhook (deployments)" type="url" value={teamsUrl} onChange={e => setTeamsUrl(e.target.value)}
                placeholder={editing?.teams_webhook_set ? 'Set: enter a new URL to replace it' : 'https://…'}
                help="Deployments and their checks are posted to this channel. Create it in Teams: Workflows › Post to a channel when a webhook request is received." />
              {editing?.teams_webhook_set && !teamsUrl && (
                <Checkbox label="Stop posting to Teams" checked={removeTeams} onChange={e => setRemoveTeams(e.target.checked)} />
              )}
            </div>
          )}
          {canSetServiceAccount && editing && <ServiceAccountSection projectId={editing.id} />}
          {saveError && <p role="alert" className="text-[13px] text-danger">{saveError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving}>Save</Button>
          </div>
        </form>
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
