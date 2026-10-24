import { useNavigate } from 'react-router-dom'
import { KeyRound, LogOut, SlidersHorizontal, User } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { DropdownMenu, MenuItem, MenuLabel, MenuSeparator } from '@/ui'
import { ROLE_LABELS, SCOPE_TAG_LABELS } from '@/types/domain'
import type { UserRole } from '@/types/domain'

/** Name, role and tag; profile, connections, preferences and sign-out. */
export default function UserMenu() {
  const user = useAppStore(s => s.user)
  const logout = useAppStore(s => s.logout)
  const navigate = useNavigate()
  const initial = (user?.full_name?.[0] || user?.email?.[0] || 'U').toUpperCase()
  const role = ROLE_LABELS[user?.role as UserRole] ?? user?.role
  const tag = user?.scope_tag ? SCOPE_TAG_LABELS[user.scope_tag] : null

  return (
    <DropdownMenu
      trigger={(
        <button type="button" aria-label="Account menu"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-fg">
          {initial}
        </button>
      )}
    >
      <MenuLabel>
        <p className="truncate text-[13px] font-semibold text-fg">{user?.full_name || user?.email || 'User'}</p>
        <p className="text-xs text-fg-muted">{role}{tag ? ` · ${tag}` : ''}</p>
      </MenuLabel>
      <MenuSeparator />
      <MenuItem icon={<User size={14} />} onSelect={() => navigate('/settings/profile')}>Profile</MenuItem>
      <MenuItem icon={<KeyRound size={14} />} onSelect={() => navigate('/settings/mcp/jira')}>Connections</MenuItem>
      <MenuItem icon={<SlidersHorizontal size={14} />} onSelect={() => navigate('/settings/preferences')}>Preferences</MenuItem>
      <MenuSeparator />
      <MenuItem icon={<LogOut size={14} />} danger onSelect={() => { logout(); navigate('/login') }}>Sign out</MenuItem>
    </DropdownMenu>
  )
}
