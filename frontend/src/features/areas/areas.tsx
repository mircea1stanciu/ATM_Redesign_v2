import { Navigate, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { GitPullRequest, Play, Rocket, Terminal } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import RunDialog from '@/features/testing/RunDialog'
import LocalScriptsPanel from '@/pages/projects/LocalScriptsPanel'
import { useAppStore } from '@/store/useAppStore'
import ProjectOpenInIde from '@/components/ai/ProjectOpenInIde'
import { visibleTabs } from '@/app/navigation'
import { Button, Card, EmptyState, PageHeader } from '@/ui'
import AreaLayout from './AreaLayout'

export function WorkLayout() {
  const project = useAppStore(s => s.projects.find(p => p.id === s.selectedProjectId))
  return (
    <AreaLayout
      areaId="work"
      title="Work"
      description="Stories and requirement pages, the board and the workspace."
      actions={project && <ProjectOpenInIde key={project.id} projectId={project.id} projectName={project.name} />}
    />
  )
}

export function TestsLayout() {
  const canRun = usePermission('run.execute')
  const [running, setRunning] = useState(false)
  return (
    <>
      <AreaLayout areaId="tests" title="Tests" description="Runs, suites, environments and the project's test setup."
        actions={canRun && <Button variant="primary" icon={<Play size={14} />} onClick={() => setRunning(true)}>Run tests</Button>} />
      {running && <RunDialog open onOpenChange={setRunning} />}
    </>
  )
}

export function ReportsLayout() {
  return <AreaLayout areaId="reports" title="Reports" description="Results, trends and Allure reports." />
}

// Before phase 07 the Repository tab had its own views; they are workspace views now, Scripts moved to Tests.
const REPOSITORY_VIEWS: Record<string, string> = {
  parallel: '/work/workspace?view=three-panel',
  compare: '/work/workspace?view=compare',
  editor: '/work/workspace?view=editor',
  publish: '/work/workspace?view=editor',
  structure: '/work/workspace?view=three-panel',
  analyzer: '/work/workspace?view=analysis',
  scripts: '/tests/scripts',
}

export function RepositoryRedirect() {
  const [params] = useSearchParams()
  return <Navigate to={REPOSITORY_VIEWS[params.get('view') ?? ''] ?? '/work/workspace?view=three-panel'} replace />
}

export function ScriptsPage() {
  const projectId = useAppStore(s => s.selectedProjectId)
  if (!projectId) return <EmptyState icon={Terminal} title="Choose a project">Pick a project in the top bar.</EmptyState>
  return <div className="h-full overflow-hidden rounded-xl border border-line bg-surface p-3"><LocalScriptsPanel projectId={projectId} /></div>
}

export function AdminLayout() {
  return <AreaLayout areaId="admin" title="Admin" description="Users and projects." />
}

/** /admin opens its first tab the user can see. */
export function AdminIndex() {
  const user = useAppStore(s => s.user)
  const first = visibleTabs(user, 'admin')[0]
  return <Navigate to={first?.to ?? '/'} replace />
}

export function ReviewsPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reviews" description="Pull requests waiting for you, and every open pull request of your projects." />
      <Card>
        <EmptyState icon={GitPullRequest} title="Reviews in ATM are coming">
          Seniors will review, comment on and approve pull requests here. Until then, open a pull request from
          Work › Repository and review it on GitHub.
        </EmptyState>
      </Card>
    </div>
  )
}

export function DeploymentsPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Deploys" description="Deployments per environment, so you know when to test." />
      <Card>
        <EmptyState icon={Rocket} title="No deployments yet">
          Deployments will show here once your lead connects the deployment notifications of your projects.
        </EmptyState>
      </Card>
    </div>
  )
}
