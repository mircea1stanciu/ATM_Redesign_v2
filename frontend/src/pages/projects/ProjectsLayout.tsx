import { FormEvent, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity, BarChart2, CheckCircle2, FolderGit2, Github, Info, Loader2, Package, Plus, Sparkles, X,
} from 'lucide-react'
import Can from '@/components/ui/Can'
import { useAppStore } from '@/store/useAppStore'
import ProjectOpenInIde from '@/components/ai/ProjectOpenInIde'
import type { Project } from '@/types/domain'

const TABS = [
  { to: '/projects', label: 'Overview', icon: Info, end: true },
  { to: '/projects/repository', label: 'Local and GIT project Management', icon: FolderGit2, end: false },
  { to: '/projects/ai', label: 'AI Driven implementation', icon: Sparkles, end: false },
  { to: '/projects/runs', label: 'Test Runs', icon: Activity, end: false },
  { to: '/projects/library', label: 'Library', icon: Package, end: false },
  { to: '/projects/analytics', label: 'Analytics', icon: BarChart2, end: false },
]

export default function ProjectsLayout() {
  const projects = useAppStore(s => s.projects)
  const selectedProjectId = useAppStore(s => s.selectedProjectId)
  const setSelectedProjectId = useAppStore(s => s.setSelectedProjectId)
  const projectForm = useAppStore(s => s.projectForm)
  const setProjectForm = useAppStore(s => s.setProjectForm)
  const createProject = useAppStore(s => s.createProject)
  const deleteProject = useAppStore(s => s.deleteProject)
  const error = useAppStore(s => s.error)

  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createdProject, setCreatedProject] = useState<Project | null>(null)

  const activeProject = projects.find(p => p.id === selectedProjectId) || projects[0] || null

  const openCreate = () => {
    useAppStore.setState({ error: null })
    setProjectForm(p => ({ ...p, name: '', description: '', git_repo_url: '' }))
    setCreatedProject(null)
    setShowCreate(true)
  }

  const closeCreate = () => {
    setShowCreate(false)
    setCreatedProject(null)
  }

  const handleCreateProject = async (e: FormEvent) => {
    e.preventDefault()
    setCreating(true)
    const created = await createProject()
    setCreating(false)
    if (created) setCreatedProject(created)
  }

  const connectCreatedProject = () => {
    if (createdProject) setSelectedProjectId(createdProject.id)
    closeCreate()
    navigate('/settings/mcp/github')
  }

  const handleDelete = () => {
    if (!activeProject) return
    if (window.confirm(`Delete project "${activeProject.name}"? This will remove all suites and runs.`)) {
      void deleteProject(activeProject.id)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Create modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={closeCreate}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-lg rounded-3xl border border-gray-200/80 dark:border-gray-700/70 glass p-6 shadow-soft-lg"
            >
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">{createdProject ? 'Project created' : 'New Project'}</h2>
                <button onClick={closeCreate} className="rounded-lg p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700"><X size={16} /></button>
              </div>
              {createdProject ? (
                <div className="space-y-5">
                  <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                    <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-600" />
                    <p className="text-sm text-gray-700 dark:text-gray-200">
                      <span className="font-semibold">{createdProject.name}</span> is ready.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Github size={20} className="mt-0.5 shrink-0 text-gray-700 dark:text-gray-300" />
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">Connect it to GitHub now?</p>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Add the repository URL and an access token in Settings. The project overview then detects the
                        languages, test frameworks, CI status and test files automatically.
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-1">
                    <button type="button" onClick={closeCreate} className="btn-ghost">Later</button>
                    <button type="button" onClick={connectCreatedProject} className="btn-primary"><Github size={15} /> Connect GitHub</button>
                  </div>
                </div>
              ) : (
              <form onSubmit={handleCreateProject} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Project name</label>
                  <input className="form-input" placeholder="My Test Suite" value={projectForm.name} autoFocus
                    onChange={e => setProjectForm(p => ({ ...p, name: e.target.value }))} required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Description</label>
                  <textarea className="form-input" placeholder="Optional..." value={projectForm.description}
                    onChange={e => setProjectForm(p => ({ ...p, description: e.target.value }))} rows={3} />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">You can connect the GitHub repository right after the project is created.</p>
                {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={closeCreate} className="btn-ghost">Cancel</button>
                  <button type="submit" disabled={creating || !projectForm.name.trim()} className="btn-primary">
                    {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Create project
                  </button>
                </div>
              </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hub header: project switcher + tabs */}
      <div className="shrink-0 rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
            <FolderGit2 size={18} className="text-white" />
          </div>
          <div className="mr-auto min-w-0">
            <p className="kicker">Project</p>
            {projects.length === 0 ? (
              <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">No projects yet</p>
            ) : (
              <select
                value={activeProject?.id || ''}
                onChange={e => setSelectedProjectId(e.target.value)}
                className="max-w-[240px] truncate rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeProject && (
              <ProjectOpenInIde key={activeProject.id} projectId={activeProject.id} projectName={activeProject.name} />
            )}
            {activeProject && (
              <Can permission="project.delete">
                <button onClick={handleDelete} className="btn-ghost !px-2.5 !py-1.5 text-xs text-red-500 hover:text-red-600">
                  Delete
                </button>
              </Can>
            )}
            <Can permission="project.create">
              <button onClick={openCreate} className="btn-primary !px-3 !py-1.5 text-xs">
                <Plus size={14} /> New Project
              </button>
            </Can>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 overflow-x-auto px-3 py-2">
          {TABS.map(tab => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 shadow-soft'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/70 dark:hover:bg-gray-800/70 hover:text-gray-900 dark:hover:text-gray-100'
                }`
              }
            >
              <tab.icon size={14} />
              {tab.label}
            </NavLink>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  )
}
