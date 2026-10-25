import { useQuery } from '@tanstack/react-query'
import { learningApi, learningKeys } from './api'
import { pathById } from './paths'

/** The learning paths leads built (phase 21), in their order; `byId` finds one. */
export function usePaths() {
  const query = useQuery({ queryKey: learningKeys.paths, queryFn: learningApi.paths, staleTime: 5 * 60_000 })
  const paths = query.data ?? []
  return { query, paths, byId: (id: string | null | undefined) => pathById(paths, id) }
}
