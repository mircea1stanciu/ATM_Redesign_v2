import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useSearchParams } from 'react-router-dom'
import {
  CheckCircle2, Edit2, Loader2, Search, Shield, UserCheck,
  UserCog, Users, X, Eye, AlertCircle, Trash2, Filter, Plus,
} from 'lucide-react'
import { apiService } from '@/services/api'
import { useAppStore } from '@/store/useAppStore'
import type { UserResponse, UserRole } from '@/types/domain'
import { ROLE_LABELS, ROLE_COLORS } from '@/types/domain'

const ALL_ROLES: UserRole[] = ['admin', 'automation_lead', 'automation_user', 'viewer', 'user', 'super_admin', 'org_admin', 'community_lead']

const ROLE_ORDER: Record<UserRole, number> = {
  super_admin: 0,
  admin: 1,
  org_admin: 2,
  community_lead: 3,
  automation_lead: 4,
  automation_user: 5,
  viewer: 6,
  user: 7,
}

const ROLE_ICONS: Record<UserRole, React.ReactNode> = {
  super_admin: <Shield size={13} />,
  admin: <Shield size={13} />,
  org_admin: <Shield size={13} />,
  community_lead: <UserCog size={13} />,
  automation_lead: <UserCog size={13} />,
  automation_user: <UserCheck size={13} />,
  viewer: <Eye size={13} />,
  user: <Eye size={13} />,
}

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  super_admin: 'Super admin — full system access',
  admin: 'Full access — manage users, projects, runs and all settings',
  org_admin: 'Organization admin — manage org users and projects',
  community_lead: 'Community lead — manage community members',
  automation_lead: 'Configure projects, suites and schedulers; execute runs',
  automation_user: 'Execute test runs; read project and suite details',
  viewer: 'Read-only access to runs, results and analytics',
  user: 'Registered user — default role for new registrations',
}

interface EditState {
  userId: string
  email: string
  full_name: string
  role: UserRole
  assigned_lead_id: string
  is_active: boolean
  password: string
  passwordConfirm: string
}

export default function UsersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const roleFromQuery = searchParams.get('role')
  const initialRole = roleFromQuery && ALL_ROLES.includes(roleFromQuery as UserRole)
    ? (roleFromQuery as UserRole)
    : ''

  const currentUser = useAppStore(s => s.user)
  const [users, setUsers] = useState<UserResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState(searchParams.get('q') || '')
  const [filterRole, setFilterRole] = useState<UserRole | ''>(initialRole)
  const [filterUnassigned, setFilterUnassigned] = useState(
    (searchParams.get('unassigned') || '').toLowerCase() === '1'
    || (searchParams.get('unassigned') || '').toLowerCase() === 'true'
  )
  const [filterLeadId, setFilterLeadId] = useState<string>(searchParams.get('lead') || '')
  const [editState, setEditState] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successId, setSuccessId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState({
    email: '',
    password: '',
    full_name: '',
    role: 'automation_user' as UserRole,
  })
  const [creatingUser, setCreatingUser] = useState(false)

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin' || currentUser?.role === 'org_admin'
  const isLead = currentUser?.role === 'automation_lead'
  const isManager = isAdmin || isLead
  const visibleRoleFilters = isLead
    ? ALL_ROLES.filter(role => role !== 'admin')
    : ALL_ROLES
  const leadOptions = users.filter(u => u.role === 'automation_lead')

  const canEditUser = (u: UserResponse) => {
    if (isAdmin) return true
    if (isLead) return u.role === 'automation_user' || u.role === 'viewer'
    return false
  }

  const canDeleteUser = (u: UserResponse) => {
    if (!currentUser) return false
    if (u.id === currentUser.id) return false
    if (isAdmin) return true
    if (isLead) return Boolean(u.assigned_lead_id && u.assigned_lead_id === currentUser.id)
    return false
  }

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const data = await apiService.listUsers()
      setUsers(data)
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void fetchUsers() }, [])

  useEffect(() => {
    const next = new URLSearchParams()
    if (search.trim()) next.set('q', search.trim())
    if (filterRole) next.set('role', filterRole)
    if (filterLeadId) next.set('lead', filterLeadId)
    if (filterUnassigned) next.set('unassigned', '1')

    const nextString = next.toString()
    const currentString = searchParams.toString()
    if (nextString !== currentString) {
      setSearchParams(next, { replace: true })
    }
  }, [search, filterRole, filterLeadId, filterUnassigned, searchParams, setSearchParams])

  useEffect(() => {
    if (isLead && filterRole === 'admin') {
      setFilterRole('')
    }
  }, [isLead, filterRole])

  const openEdit = (u: UserResponse) => {
    setError(null)
    setEditState({
      userId: u.id,
      email: u.email,
      full_name: u.full_name || '',
      role: u.role as UserRole,
      assigned_lead_id: u.assigned_lead_id || '',
      is_active: u.is_active,
      password: '',
      passwordConfirm: '',
    })
  }

  const handleSave = async () => {
    if (!editState) return
    
    // Validate password confirmation
    if (editState.password && editState.password !== editState.passwordConfirm) {
      setError('Passwords do not match')
      return
    }
    
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = isAdmin
        ? {
            email: editState.email,
            full_name: editState.full_name || undefined,
            role: editState.role,
            assigned_lead_id: editState.assigned_lead_id || null,
            is_active: editState.is_active,
          }
        : {
            assigned_lead_id: editState.assigned_lead_id || null,
          }
      if (isAdmin && editState.password) payload.password = editState.password
      const updatedUser = await apiService.updateUser(editState.userId, payload)

      // Optimistic local update so assignment is visible even if refresh fails.
      setUsers(prev => prev.map(u => (u.id === updatedUser.id ? { ...u, ...updatedUser } : u)))

      setSuccessId(editState.userId)
      setTimeout(() => setSuccessId(null), 2500)
      setEditState(null)
      await fetchUsers()
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (u: UserResponse) => {
    if (!canDeleteUser(u)) return

    const displayName = u.full_name || u.email
    const confirmed = window.confirm(`Delete user "${displayName}"? This action cannot be undone.`)
    if (!confirmed) return

    setDeletingId(u.id)
    setError(null)
    try {
      await apiService.deleteUser(u.id)
      setUsers(prev => prev.filter(item => item.id !== u.id))
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setDeletingId(null)
    }
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!createForm.email || !createForm.password || !createForm.full_name) {
      alert('Please fill in all fields')
      return
    }

    setCreatingUser(true)
    setError(null)
    try {
      const newUser = await apiService.createUser({
        email: createForm.email,
        password: createForm.password,
        full_name: createForm.full_name,
        role: createForm.role,
      })
      setUsers(prev => [...prev, newUser])
      setShowCreateModal(false)
      setCreateForm({ email: '', password: '', full_name: '', role: 'automation_user' })
    } catch (e) {
      setError(apiService.errorMessage(e))
    } finally {
      setCreatingUser(false)
    }
  }

  const filtered = users
    .filter(u => {
      // Text search: all visible fields
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const leadName = (
          u.assigned_lead_name ||
          users.find(l => l.id === u.assigned_lead_id)?.full_name ||
          users.find(l => l.id === u.assigned_lead_id)?.email ||
          ''
        ).toLowerCase()
        const roleLabel = (ROLE_LABELS[u.role as UserRole] ?? u.role).toLowerCase()
        const status = u.is_active ? 'active' : 'inactive'
        const matches =
          u.email.toLowerCase().includes(q) ||
          (u.full_name || '').toLowerCase().includes(q) ||
          roleLabel.includes(q) ||
          leadName.includes(q) ||
          status.includes(q)
        if (!matches) return false
      }

      // Role filter
      if (filterRole && u.role !== filterRole) return false

      // Unassigned filter: only Automation User / Viewer without assigned lead
      if (filterUnassigned) {
        const isAssignableRole = u.role === 'automation_user' || u.role === 'viewer'
        if (!isAssignableRole || Boolean(u.assigned_lead_id)) return false
      }

      // Lead group filter: show the lead + their assigned users
      if (filterLeadId) {
        const isTheLead = u.id === filterLeadId
        const isAssignedToLead = u.assigned_lead_id === filterLeadId
        if (!isTheLead && !isAssignedToLead) return false
      }

      return true
    })
    .sort((a, b) => {
      const isUnassignedAssignable = (u: UserResponse) =>
        (u.role === 'automation_user' || u.role === 'viewer') && !u.assigned_lead_id

      // Unassigned assignable users are always shown at the bottom.
      const unassignedA = isUnassignedAssignable(a)
      const unassignedB = isUnassignedAssignable(b)
      if (unassignedA !== unassignedB) return unassignedA ? 1 : -1

      // Primary: role order
      const roleA = ROLE_ORDER[a.role as UserRole] ?? 99
      const roleB = ROLE_ORDER[b.role as UserRole] ?? 99
      if (roleA !== roleB) return roleA - roleB

      // Secondary: assigned lead name (for users/viewers grouped under same lead)
      const leadNameA = (
        a.assigned_lead_name ||
        users.find(l => l.id === a.assigned_lead_id)?.full_name ||
        users.find(l => l.id === a.assigned_lead_id)?.email ||
        ''
      ).toLowerCase()
      const leadNameB = (
        b.assigned_lead_name ||
        users.find(l => l.id === b.assigned_lead_id)?.full_name ||
        users.find(l => l.id === b.assigned_lead_id)?.email ||
        ''
      ).toLowerCase()
      if (leadNameA !== leadNameB) return leadNameA.localeCompare(leadNameB)

      // Tertiary: name / email
      const nameA = (a.full_name || a.email).toLowerCase()
      const nameB = (b.full_name || b.email).toLowerCase()
      return nameA.localeCompare(nameB)
    })

  if (!isManager) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Shield size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
          <p className="text-base font-semibold text-gray-700 dark:text-gray-300">Access Denied</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Only Admin and Automation Lead can manage user assignments.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4">

      {/* Edit modal */}
      <AnimatePresence>
        {editState && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setEditState(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.18 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md rounded-3xl border border-gray-200/80 dark:border-gray-700/70 glass shadow-soft-lg flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-6 py-4 shrink-0">
                <h2 className="text-base font-bold text-gray-900 dark:text-white">Edit User</h2>
                <button onClick={() => setEditState(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-white">
                  <X size={16} />
                </button>
              </div>

              <div className="overflow-y-auto flex-1 space-y-4 px-6 py-4">
                {isAdmin && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Email</label>
                    <input className="form-input" type="email" value={editState.email}
                      onChange={e => setEditState(s => s ? { ...s, email: e.target.value } : s)} />
                  </div>
                )}

                {isAdmin && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Full Name</label>
                    <input className="form-input" value={editState.full_name}
                      onChange={e => setEditState(s => s ? { ...s, full_name: e.target.value } : s)} />
                  </div>
                )}

                {isAdmin && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Role</label>
                    <div className="space-y-2">
                      {ALL_ROLES.map(role => (
                        <label key={role}
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-all ${
                            editState.role === role
                              ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                          }`}
                        >
                          <input type="radio" name="role" value={role} checked={editState.role === role}
                            onChange={() => setEditState(s => s ? { ...s, role } : s)}
                            className="mt-0.5 accent-blue-600" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${ROLE_COLORS[role]}`}>
                                {ROLE_ICONS[role]} {ROLE_LABELS[role]}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{ROLE_DESCRIPTIONS[role]}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {(editState.role === 'automation_user' || editState.role === 'viewer') && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Assigned Automation Lead</label>
                    <select
                      className="form-input"
                      value={editState.assigned_lead_id}
                      onChange={e => setEditState(s => (s ? { ...s, assigned_lead_id: e.target.value } : s))}
                    >
                      <option value="">Unassigned</option>
                      {leadOptions
                        .filter(l => (isLead ? l.id === currentUser?.id : true))
                        .map(lead => (
                          <option key={lead.id} value={lead.id}>
                            {(lead.full_name || lead.email)}
                          </option>
                        ))}
                    </select>
                    <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                      {isAdmin
                        ? 'Admin can assign Automation User and Viewer accounts to any Automation Lead.'
                        : 'Automation Leads can assign Automation User and Viewer accounts to themselves.'}
                    </p>
                  </div>
                )}

                {isAdmin && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">New Password <span className="text-gray-400">(leave blank to keep current)</span></label>
                    <input className="form-input" type="password" placeholder="••••••••" value={editState.password}
                      onChange={e => setEditState(s => s ? { ...s, password: e.target.value } : s)} />
                  </div>
                )}

                {isAdmin && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Confirm Password</label>
                    <input className="form-input" type="password" placeholder="••••••••" value={editState.passwordConfirm}
                      onChange={e => setEditState(s => s ? { ...s, passwordConfirm: e.target.value } : s)} />
                  </div>
                )}

                {isAdmin && (
                  <label className="flex cursor-pointer items-center justify-between rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/20 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 transition hover:border-blue-300 dark:hover:border-blue-500/50">
                    Account Active
                    <input type="checkbox" checked={editState.is_active}
                      onChange={e => setEditState(s => s ? { ...s, is_active: e.target.checked } : s)}
                      className="h-4 w-4 accent-blue-600" />
                  </label>
                )}

                {error && (
                  <div className="flex items-center gap-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/20 px-3 py-2.5 text-sm text-red-700 dark:text-red-300">
                    <AlertCircle size={14} /> {error}
                  </div>
                )}
              </div>

              <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 px-6 py-4">
                <button onClick={() => setEditState(null)} className="btn-ghost">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary">
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  {saving ? 'Saving...' : (isAdmin ? 'Save changes' : 'Save assignment')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">User Management</h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Manage users and assign Automation User/Viewer accounts to Automation Leads</p>
        </div>
        <div className="flex items-center gap-3">
          {currentUser?.role === 'super_admin' && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              <Plus size={16} />
              Add User
            </button>
          )}
          <div className="flex items-center gap-2">
            {loading && <Loader2 size={16} className="animate-spin text-gray-400" />}
            <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-300">
              {filtered.length} / {users.length} users
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex shrink-0 items-center gap-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/20 px-3 py-2.5 text-sm text-red-700 dark:text-red-300">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Role legend */}
      <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">
        {visibleRoleFilters.map(role => (
          <div key={role} className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 p-3 shadow-soft">
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${ROLE_COLORS[role]}`}>
                {ROLE_ICONS[role]} {ROLE_LABELS[role]}
              </span>
            </div>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">{ROLE_DESCRIPTIONS[role]}</p>
          </div>
        ))}
      </div>

      {/* Search + Table */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft">
        {/* Search + filters bar */}
        <div className="shrink-0 border-b border-gray-200 dark:border-gray-700 px-4 py-3 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="form-input !pl-8 !py-2"
              placeholder="Search name, email, role, assigned lead, status…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filter row */}
          <div className="flex flex-wrap items-center gap-2">
            <Filter size={13} className="shrink-0 text-gray-400" />

            {/* Role filter chips */}
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setFilterRole('')}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
                  filterRole === ''
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                All Roles
              </button>
              {visibleRoleFilters.map(role => (
                <button
                  key={role}
                  onClick={() => setFilterRole(filterRole === role ? '' : role)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
                    filterRole === role
                      ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-gray-800 ' + ROLE_COLORS[role]
                      : 'opacity-60 hover:opacity-100 ' + ROLE_COLORS[role]
                  }`}
                >
                  {ROLE_ICONS[role]} {ROLE_LABELS[role]}
                </button>
              ))}
              <button
                onClick={() => setFilterUnassigned(v => !v)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
                  filterUnassigned
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/35'
                }`}
              >
                Unassigned
              </button>
            </div>

            {/* Divider */}
            <span className="h-4 w-px bg-gray-200 dark:bg-gray-600 mx-1" />

            {/* Lead group filter */}
            <div className="flex items-center gap-1.5">
              <UserCog size={13} className="shrink-0 text-gray-400" />
              <select
                value={filterLeadId}
                onChange={e => setFilterLeadId(e.target.value)}
                className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Lead Groups</option>
                {leadOptions.map(lead => (
                  <option key={lead.id} value={lead.id}>
                    {lead.full_name || lead.email}
                  </option>
                ))}
              </select>
              {filterLeadId && (
                <button
                  onClick={() => setFilterLeadId('')}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Active filters summary */}
            {(filterRole || filterLeadId || filterUnassigned || search) && (
              <button
                onClick={() => { setSearch(''); setFilterRole(''); setFilterUnassigned(false); setFilterLeadId('') }}
                className="ml-auto text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-medium"
              >
                Clear all filters
              </button>
            )}
          </div>
        </div>

        {/* User list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-gray-400 dark:text-gray-500">
              <Loader2 size={16} className="animate-spin" /> Loading users…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-2 text-gray-400 dark:text-gray-500">
              <Users size={20} /> No users found
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {filtered.map(u => {
                const role = u.role as UserRole
                const isMe = u.id === currentUser?.id
                const editable = canEditUser(u)
                const resolvedAssignedLeadName =
                  u.assigned_lead_name ||
                  (u.assigned_lead_id
                    ? (users.find(candidate => candidate.id === u.assigned_lead_id)?.full_name ||
                       users.find(candidate => candidate.id === u.assigned_lead_id)?.email)
                    : null)
                return (
                  <div key={u.id}
                    className="flex items-center gap-4 px-4 py-3.5 transition hover:bg-gray-50 dark:hover:bg-gray-700/20"
                  >
                    {/* Avatar */}
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white shadow-soft">
                      {(u.full_name?.[0] || u.email[0]).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                          {u.full_name || '—'}
                        </p>
                        {isMe && (
                          <span className="rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:text-blue-300">You</span>
                        )}
                        {!u.is_active && (
                          <span className="rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400">Inactive</span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{u.email}</p>
                    </div>

                    {/* Role badge */}
                    <span className={`hidden shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold sm:inline-flex ${ROLE_COLORS[role] ?? ''}`}>
                      {ROLE_ICONS[role]} {ROLE_LABELS[role] ?? role}
                    </span>

                    {/* Assigned lead */}
                    {(u.role === 'automation_user' || u.role === 'viewer') && (
                      <span className="hidden shrink-0 text-xs text-gray-500 dark:text-gray-400 lg:inline">
                        Lead: {resolvedAssignedLeadName || 'Unassigned'}
                      </span>
                    )}

                    {/* Joined */}
                    <p className="hidden shrink-0 text-xs text-gray-400 dark:text-gray-500 md:block">
                      {new Date(u.created_at).toLocaleDateString()}
                    </p>

                    {/* Success tick */}
                    {successId === u.id && (
                      <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />
                    )}

                    {/* Edit button */}
                    {editable && (
                      <button
                        onClick={() => openEdit(u)}
                        className="btn-ghost !px-2.5 !py-1.5 shrink-0"
                        title={isAdmin ? 'Edit user' : 'Assign Automation Lead'}
                      >
                        <Edit2 size={13} />
                      </button>
                    )}

                    {canDeleteUser(u) && (
                      <button
                        onClick={() => void handleDelete(u)}
                        disabled={deletingId === u.id}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                        title="Delete user"
                      >
                        {deletingId === u.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        Delete
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Create User Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-6 py-4">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Create New User</h2>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleCreateUser} className="space-y-4 px-6 py-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Full Name</label>
                  <input
                    type="text"
                    required
                    value={createForm.full_name}
                    onChange={e => setCreateForm(f => ({ ...f, full_name: e.target.value }))}
                    placeholder="John Doe"
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Email</label>
                  <input
                    type="email"
                    required
                    value={createForm.email}
                    onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="john@example.com"
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Password</label>
                  <input
                    type="password"
                    required
                    value={createForm.password}
                    onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="••••••••"
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Role</label>
                  <select
                    value={createForm.role}
                    onChange={e => setCreateForm(f => ({ ...f, role: e.target.value as UserRole }))}
                    className="form-input"
                  >
                    <option value="admin">Admin</option>
                    <option value="automation_lead">Automation Lead</option>
                    <option value="automation_user">Automation User</option>
                    <option value="user">User</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>

                {error && (
                  <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/20 px-3 py-2.5 text-sm text-red-700 dark:text-red-300">
                    <AlertCircle size={14} /> {error}
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="btn-ghost"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingUser}
                    className="btn-primary"
                  >
                    {creatingUser && <Loader2 size={14} className="animate-spin" />}
                    {creatingUser ? 'Creating...' : 'Create User'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
