import { Navigate } from 'react-router-dom'
import { GitPullRequest, Rocket } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import ProjectOpenInIde from '@/components/ai/ProjectOpenInIde'
import { visibleTabs } from '@/app/navigation'
import { Card, EmptyState, PageHeader } from '@/ui'
import AreaLayout from './AreaLayout'

export function WorkLayout() {
  const project = useAppStore(s => s.projects.find(p => p.id === s.selectedProjectId))
  return (
    <AreaLayout
      areaId="work"
      title="Work"
      description="Stories and requirement pages, the board, the workspace and the repository."
      actions={project && <ProjectOpenInIde key={project.id} projectId={project.id} projectName={project.name} />}
    />
  )
}

export function TestsLayout() {
  return <AreaLayout areaId="tests" title="Tests" description="Runs, the project's test setup and libraries." />
}

export function ReportsLayout() {
  return <AreaLayout areaId="reports" title="Reports" description="Results, trends and Allure reports." />
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
