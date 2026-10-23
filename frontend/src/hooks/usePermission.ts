import { useAppStore } from '@/store/useAppStore'
import type { UserResponse } from '@/types/domain'

/** Whether the user (from /api/me) has the permission. Hiding is for clarity only; the backend decides. */
export function hasPermission(user: UserResponse | null | undefined, permission: string): boolean {
  return Boolean(user?.permissions?.includes(permission))
}

export function usePermission(permission: string): boolean {
  return useAppStore(s => hasPermission(s.user, permission))
}
