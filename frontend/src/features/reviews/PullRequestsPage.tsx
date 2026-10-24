import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { GitPullRequest } from 'lucide-react'
import { apiService } from '@/services/api'
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '@/ui'
import { reviewKeys, reviewsApi } from './api'

function since(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : ''
}

/** Reviews › Waiting for me / All open: the open pull requests of the user's projects. */
export default function PullRequestsPage({ scope }: { scope: 'mine' | 'all' }) {
  const pulls = useQuery({ queryKey: reviewKeys.pulls(scope), queryFn: () => reviewsApi.pulls(scope), refetchInterval: 60_000 })
  if (pulls.isPending) return <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
  if (pulls.isError) return <ErrorState title="Could not load the pull requests">{apiService.errorMessage(pulls.error)}</ErrorState>
  const { items, missing_token: missing, errors } = pulls.data
  return (
    <div className="flex flex-col gap-3">
      {missing.length > 0 && (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-fg">
          Add your GitHub token in Settings › Connections to see the pull requests of: {missing.join(', ')}.
        </p>
      )}
      {errors.map(e => <ErrorState key={e.project} title={`Could not load ${e.project}`}>{e.detail}</ErrorState>)}
      <Card>
        {items.length === 0 ? (
          <EmptyState icon={GitPullRequest} title={scope === 'mine' ? 'Nothing waiting for you' : 'No open pull requests'}>
            {scope === 'mine'
              ? 'Pull requests where your review is requested show here, on GitHub or opened from ATM.'
              : 'Open pull requests of your projects show here.'}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line" aria-label="Pull requests">
            {items.map(pr => (
              <li key={`${pr.project_id}-${pr.number}`} className="flex items-start gap-3 px-4 py-3">
                <GitPullRequest size={16} className="mt-0.5 shrink-0 text-success" aria-hidden />
                <div className="min-w-0 flex-1">
                  <Link to={`/reviews/${pr.project_id}/${pr.number}`} className="text-[13px] font-semibold text-fg hover:text-accent hover:underline">
                    {pr.title}
                  </Link>
                  <p className="text-xs text-fg-muted">
                    {pr.project} #{pr.number} · {pr.author} · <code>{pr.head}</code> → <code>{pr.base}</code> · updated {since(pr.updated_at)}
                  </p>
                </div>
                {pr.draft && <Badge>Draft</Badge>}
                {pr.waiting_for_me && <Badge tone="accent">Waiting for you</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
