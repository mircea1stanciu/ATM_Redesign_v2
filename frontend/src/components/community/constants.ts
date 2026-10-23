export interface CommunityMeta {
  id: string
  name: string
  icon: string
  color: string // tailwind bg color classes
  accent: string // tailwind text color
}

export const COMMUNITIES: CommunityMeta[] = [
  { id: 'qa', name: 'Quality Assurance', icon: '🧪', color: 'bg-purple-500', accent: 'text-purple-600 dark:text-purple-400' },
]

export function communityById(id: string): CommunityMeta {
  return COMMUNITIES.find((c) => c.id === id) || {
    id,
    name: id,
    icon: '💬',
    color: 'bg-gray-500',
    accent: 'text-gray-600 dark:text-gray-400',
  }
}

/**
 * Which communities the given user can access. If the user has no explicit
 * assignments (or is an admin-level role), all communities are available —
 * this mirrors the backend's soft access rules.
 */
export function accessibleCommunities(user: { role?: string; assigned_communities?: string[] | null } | null): CommunityMeta[] {
  const adminRoles = ['super_admin', 'admin', 'org_admin']
  if (!user) return COMMUNITIES
  if (user.role && adminRoles.includes(user.role)) return COMMUNITIES
  const assigned = user.assigned_communities
  if (!assigned || assigned.length === 0) return COMMUNITIES
  const filtered = COMMUNITIES.filter((c) => assigned.includes(c.id))
  return filtered.length > 0 ? filtered : COMMUNITIES
}

export function formatFileSize(bytes: number | null): string {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
