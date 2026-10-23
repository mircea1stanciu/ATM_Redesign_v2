import type { ReactNode } from 'react'
import { usePermission } from '@/hooks/usePermission'

/** Renders its children only when the signed-in user has the permission. */
export default function Can({ permission, children, fallback = null }: {
  permission: string
  children: ReactNode
  fallback?: ReactNode
}) {
  return <>{usePermission(permission) ? children : fallback}</>
}
