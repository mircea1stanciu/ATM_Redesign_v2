import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiService } from '@/services/api'

export const workspaceKeys = {
  all: (projectId: string) => ['workspace', projectId] as const,
  status: (projectId: string) => ['workspace', projectId, 'status'] as const,
  uncommitted: (projectId: string) => ['workspace', projectId, 'uncommitted'] as const,
}

/** Branch, ahead/behind and whether the checkout is dirty. */
export function useRepoStatus(projectId: string) {
  return useQuery({ queryKey: workspaceKeys.status(projectId), queryFn: () => apiService.getLocalRepoStatus(projectId) })
}

/** The files changed in the checkout and not committed yet. */
export function useUncommitted(projectId: string) {
  return useQuery({
    queryKey: workspaceKeys.uncommitted(projectId),
    queryFn: () => apiService.getLocalChanges(projectId, { committed: false }),
  })
}

/** Refresh the branch and the changes after a save, a commit, a push or a branch switch. */
export function useRefreshWorkspace(projectId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: workspaceKeys.all(projectId) })
}
