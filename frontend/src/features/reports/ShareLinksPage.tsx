import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import { Button, Card, EmptyState, ErrorState, Skeleton, useToast } from '@/ui'
import { reportKeys, reportsApi } from './api'

/** Reports › Share links (leads, phase 19): every link of the project that works without signing in, to revoke. */
export default function ShareLinksPage() {
  const projectId = useAppStore(s => s.selectedProjectId) ?? ''
  const toast = useToast()
  const queryClient = useQueryClient()
  const links = useQuery({ queryKey: reportKeys.projectShareLinks(projectId), queryFn: () => reportsApi.projectShareLinks(projectId), enabled: Boolean(projectId) })
  const revoke = useMutation({
    mutationFn: (id: number) => reportsApi.revokeShareLink(projectId, id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['reports'] }); toast({ title: 'Link revoked', tone: 'success' }) },
    onError: error => toast({ title: 'Not revoked', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  if (!projectId) return <EmptyState icon={Link2} title="Choose a project">Pick a project in the top bar.</EmptyState>
  return (
    <Card className="overflow-x-auto">
      {links.isPending ? <Skeleton className="m-4 h-16" /> : links.isError ? (
        <div className="p-4"><ErrorState title="Could not load the share links">{apiService.errorMessage(links.error)}</ErrorState></div>
      ) : links.data.length === 0 ? (
        <EmptyState icon={Link2} title="No share links">Links made from a report page with "Share link" show here.</EmptyState>
      ) : (
        <table className="w-full text-left text-[13px]" aria-label="Share links">
          <thead className="border-b border-line text-xs text-fg-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Report</th>
              <th className="px-2 py-2 font-medium">Shared by</th>
              <th className="px-2 py-2 font-medium">Views</th>
              <th className="px-4 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {links.data.map(link => (
              <tr key={link.id}>
                <td className="px-4 py-2"><Link to={`/reports/runs/${link.run_id}`} className="font-medium text-accent hover:underline">{link.run ?? link.run_id}</Link></td>
                <td className="px-2 py-2 text-fg-muted">{link.created_by ?? '—'} · {new Date(`${link.created_at}Z`).toLocaleDateString()}</td>
                <td className="px-2 py-2">{link.views}</td>
                <td className="px-4 py-2 text-right">
                  <Button size="sm" variant="ghost" loading={revoke.isPending && revoke.variables === link.id} onClick={() => revoke.mutate(link.id)}
                    aria-label={`Revoke the share link of ${link.run ?? link.run_id}`}>Revoke</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
