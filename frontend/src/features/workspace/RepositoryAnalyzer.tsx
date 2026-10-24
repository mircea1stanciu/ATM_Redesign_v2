import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { apiService } from '@/services/api'
import { Badge, Button, ErrorState, Section, Skeleton } from '@/ui'

/** What the GitHub repository contains: frameworks, projects and collections, and their environments. */
export default function RepositoryAnalyzer({ projectId }: { projectId: string }) {
  const analysis = useQuery({
    queryKey: ['workspace', projectId, 'repository-analysis'],
    queryFn: () => apiService.analyzeProjectRepo(projectId),
    retry: false,
  })
  return (
    <Section
      title="Repository on GitHub"
      actions={<Button size="sm" icon={<RefreshCw size={13} />} loading={analysis.isFetching} onClick={() => void analysis.refetch()}>Re-analyze</Button>}
    >
      {analysis.isPending ? <Skeleton className="h-24" /> : analysis.isError ? (
        <ErrorState title="Could not analyse the repository">
          {apiService.errorMessage(analysis.error)} Make sure GitHub is connected and the token has repo access.
        </ErrorState>
      ) : (
        <div className="space-y-3 text-[13px]">
          <p className="text-fg-muted">{analysis.data.files_count} files</p>
          <div className="flex flex-wrap gap-1.5" aria-label="Detected frameworks">
            {analysis.data.frameworks.length === 0 ? <span className="text-fg-muted">No frameworks detected</span>
              : analysis.data.frameworks.map(fw => <Badge key={fw} tone="accent">{fw}</Badge>)}
          </div>
          {analysis.data.projects.length > 0 && (
            <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Detected projects and collections">
              {analysis.data.projects.map(project => (
                <li key={project.path} className="px-3 py-2">
                  <code className="break-all text-xs text-fg">{project.path}</code>
                  {project.environments.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {project.environments.map(env => <Badge key={env} tone="info">{env}</Badge>)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  )
}
