import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ClipboardList, Code2, Loader2, Plus, RefreshCcw, RotateCcw, Search, ServerCrash, SlidersHorizontal, UserCheck, UserMinus, Users, X } from 'lucide-react'
import { apiService } from '@/services/api'
import { useAppStore } from '@/store/useAppStore'
import type { Task, TaskStatus } from '@/types/domain'

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
}

const STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'done']

type SearchMode = 'basic' | 'advanced'
type AdvancedMode = 'structured' | 'raw'

type RawClause = { field: string; op: '=' | '!=' | '~'; value: string }

function parseRawTaskQuery(raw: string): RawClause[] {
  const clauses: RawClause[] = []
  const parts = raw.split(/\s+AND\s+/i).map(p => p.trim()).filter(Boolean)
  for (const part of parts) {
    const m = part.match(/^(\w+)\s*(!=|=|~)\s*"?([^"]*)"?$/)
    if (m) {
      clauses.push({ field: m[1].toLowerCase(), op: m[2] as RawClause['op'], value: m[3].trim() })
    }
  }
  return clauses
}

function matchesRawClause(task: Task, clause: RawClause, currentUserId?: string): boolean {
  if (clause.field === 'assignee') {
    const value = clause.value.toLowerCase()
    let isMatch: boolean
    if (value === 'me') isMatch = !!currentUserId && task.assignee_id === currentUserId
    else if (value === 'unassigned') isMatch = !task.assignee_id
    else isMatch = (task.assignee_name || '').toLowerCase() === value
    return clause.op === '!=' ? !isMatch : isMatch
  }

  let fieldValue = ''
  if (clause.field === 'status') fieldValue = task.status
  else if (clause.field === 'title') fieldValue = task.title
  else if (clause.field === 'description') fieldValue = task.description || ''
  else return true

  const a = fieldValue.toLowerCase()
  const b = clause.value.toLowerCase()
  if (clause.op === '=') return a === b
  if (clause.op === '!=') return a !== b
  return a.includes(b)
}

interface TaskManagementPanelProps {
  suggestedTeams: string[]
}

export default function TaskManagementPanel({ suggestedTeams }: TaskManagementPanelProps) {
  const currentUser = useAppStore(s => s.user)

  const [teamName, setTeamName] = useState('')
  const [teamInput, setTeamInput] = useState('')
  const [teamLoading, setTeamLoading] = useState(true)
  const [savingTeam, setSavingTeam] = useState(false)
  const [resettingTeam, setResettingTeam] = useState(false)

  const [tasks, setTasks] = useState<Task[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksError, setTasksError] = useState<string | null>(null)

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null)

  // Search & advanced filters
  const [taskSearch, setTaskSearch] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('basic')
  const [advancedMode, setAdvancedMode] = useState<AdvancedMode>('structured')
  const [structStatuses, setStructStatuses] = useState<TaskStatus[]>([])
  const [structAssignees, setStructAssignees] = useState<string[]>([])
  const [rawQuery, setRawQuery] = useState('')


  useEffect(() => {
    let mounted = true
    ;(async () => {
      setTeamLoading(true)
      try {
        const settings = await apiService.getTaskTeamSettings()
        if (!mounted) return
        setTeamName(settings.team_name || '')
        setTeamInput(settings.team_name || '')
      } catch {
        if (!mounted) return
      } finally {
        if (mounted) setTeamLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [])

  const loadTasks = async (team: string) => {
    if (!team) return
    setTasksLoading(true)
    setTasksError(null)
    try {
      const data = await apiService.listTasks(team)
      setTasks(data)
    } catch (e) {
      setTasksError(apiService.errorMessage(e))
      setTasks([])
    } finally {
      setTasksLoading(false)
    }
  }

  useEffect(() => {
    if (teamName) void loadTasks(teamName)
  }, [teamName])

  const saveTeam = async () => {
    const trimmed = teamInput.trim()
    setSavingTeam(true)
    try {
      const result = await apiService.saveTaskTeamSettings(trimmed)
      setTeamName(result.team_name || '')
    } catch (e) {
      setTasksError(apiService.errorMessage(e))
    } finally {
      setSavingTeam(false)
    }
  }

  const resetTeam = async () => {
    setResettingTeam(true)
    try {
      await apiService.saveTaskTeamSettings('')
      setTeamName('')
      setTeamInput('')
      setTasks([])
      setTasksError(null)
    } catch (e) {
      setTasksError(apiService.errorMessage(e))
    } finally {
      setResettingTeam(false)
    }
  }

  const createTask = async () => {
    if (!newTitle.trim() || !teamName) return
    setCreating(true)
    try {
      await apiService.createTask({ title: newTitle.trim(), description: newDescription.trim() || undefined, team_name: teamName })
      setNewTitle('')
      setNewDescription('')
      setShowCreateForm(false)
      await loadTasks(teamName)
    } catch (e) {
      setTasksError(apiService.errorMessage(e))
    } finally {
      setCreating(false)
    }
  }

  const toggleAssignToMe = async (task: Task) => {
    setBusyTaskId(task.id)
    try {
      const isMine = currentUser && task.assignee_id === currentUser.id
      const updated = isMine ? await apiService.unassignTask(task.id) : await apiService.assignTaskToMe(task.id)
      setTasks(prev => prev.map(t => (t.id === task.id ? updated : t)))
    } catch (e) {
      setTasksError(apiService.errorMessage(e))
    } finally {
      setBusyTaskId(null)
    }
  }

  const changeStatus = async (task: Task, status: TaskStatus) => {
    if (status === task.status) return
    setBusyTaskId(task.id)
    try {
      const updated = await apiService.updateTaskStatus(task.id, status)
      setTasks(prev => prev.map(t => (t.id === task.id ? updated : t)))
    } catch (e) {
      setTasksError(apiService.errorMessage(e))
    } finally {
      setBusyTaskId(null)
    }
  }

  const myTasks = useMemo(
    () => tasks.filter(t => currentUser && t.assignee_id === currentUser.id),
    [tasks, currentUser],
  )

  const availableAssignees = useMemo(() => {
    const names = new Set<string>()
    for (const t of tasks) {
      if (t.assignee_name) names.add(t.assignee_name)
    }
    return Array.from(names).sort()
  }, [tasks])

  const toggleInList = <T,>(list: T[], setList: (v: T[]) => void, value: T) => {
    setList(list.includes(value) ? list.filter(v => v !== value) : [...list, value])
  }

  const hasStructuredFilters = structStatuses.length > 0 || structAssignees.length > 0

  const clearStructuredFilters = () => {
    setStructStatuses([])
    setStructAssignees([])
  }

  const matchesAssigneeFilter = (task: Task, sel: string): boolean => {
    if (sel === 'me') return !!currentUser && task.assignee_id === currentUser.id
    if (sel === 'unassigned') return !task.assignee_id
    return task.assignee_name === sel
  }

  const filteredTasks = useMemo(() => {
    if (searchMode === 'advanced' && advancedMode === 'raw') {
      const q = rawQuery.trim()
      if (!q) return tasks
      const clauses = parseRawTaskQuery(q)
      if (clauses.length === 0) return tasks
      return tasks.filter(t => clauses.every(c => matchesRawClause(t, c, currentUser?.id)))
    }

    let filtered = tasks
    if (searchMode === 'advanced' && advancedMode === 'structured') {
      if (structStatuses.length > 0) {
        filtered = filtered.filter(t => structStatuses.includes(t.status))
      }
      if (structAssignees.length > 0) {
        filtered = filtered.filter(t => structAssignees.some(sel => matchesAssigneeFilter(t, sel)))
      }
    }

    const q = taskSearch.trim().toLowerCase()
    if (!q) return filtered
    return filtered.filter(
      t => t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, taskSearch, searchMode, advancedMode, structStatuses, structAssignees, rawQuery, currentUser])

  if (teamLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 size={16} className="animate-spin" /> Loading team settings…
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Team configuration */}
      <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <div className="flex items-center gap-2 mb-2">
          <Users size={16} className="text-blue-600 dark:text-blue-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">My Team</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={teamInput}
            onChange={e => setTeamInput(e.target.value)}
            list="task-management-team-suggestions"
            placeholder="e.g. QA Team"
            className="w-56 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
          />
          <datalist id="task-management-team-suggestions">
            {suggestedTeams.map(team => (
              <option key={team} value={team} />
            ))}
          </datalist>
          <button
            onClick={() => void saveTeam()}
            disabled={savingTeam || teamInput.trim() === teamName}
            className="btn-primary !px-3 !py-1.5 text-xs disabled:opacity-50"
          >
            {savingTeam ? <Loader2 size={12} className="animate-spin" /> : 'Save Team'}
          </button>
          <button
            onClick={() => void resetTeam()}
            disabled={resettingTeam || !teamName}
            className="btn-ghost !px-3 !py-1.5 text-xs disabled:opacity-50"
            title="Clear your configured team"
          >
            {resettingTeam ? <Loader2 size={12} className="animate-spin" /> : <><RotateCcw size={12} /> Reset Team</>}
          </button>
          {teamName && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Current team: <span className="font-medium text-gray-700 dark:text-gray-300">{teamName}</span>
            </span>
          )}
        </div>
      </div>

      {!teamName ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <ClipboardList size={26} className="text-gray-300 dark:text-gray-600" />
          <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">No team configured</p>
          <p className="max-w-sm text-xs text-gray-500 dark:text-gray-400">
            Set the team you belong to above to see and manage tasks.
          </p>
        </div>
      ) : (
        <>
        {/* Search & Advanced Filters */}
        <div className="shrink-0 rounded-2xl border border-gray-200/80 bg-white p-3 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={taskSearch}
                onChange={e => setTaskSearch(e.target.value)}
                placeholder="Search tasks by title/description..."
                className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-7 pr-3 text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-0.5 dark:border-gray-600">
              <button
                onClick={() => setSearchMode('basic')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                  searchMode === 'basic'
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
                    : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                Basic
              </button>
              <button
                onClick={() => setSearchMode('advanced')}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                  searchMode === 'advanced'
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
                    : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <SlidersHorizontal size={12} /> Advanced
              </button>
            </div>
          </div>

          {searchMode === 'advanced' && (
            <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700/50">
              <div className="mb-2 flex w-fit items-center gap-1 rounded-lg border border-gray-200 p-0.5 dark:border-gray-600">
                <button
                  onClick={() => setAdvancedMode('structured')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                    advancedMode === 'structured'
                      ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400'
                      : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  Structured
                </button>
                <button
                  onClick={() => setAdvancedMode('raw')}
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                    advancedMode === 'raw'
                      ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400'
                      : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  <Code2 size={12} /> Raw query
                </button>
              </div>

              {advancedMode === 'structured' ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-start gap-4">
                    <div>
                      <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Status</p>
                      <div className="flex flex-wrap gap-1">
                        {STATUS_ORDER.map(st => (
                          <button
                            key={st}
                            onClick={() => toggleInList(structStatuses, setStructStatuses, st)}
                            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                              structStatuses.includes(st)
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                            }`}
                          >
                            {STATUS_LABELS[st]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Assignee</p>
                      <div className="flex flex-wrap gap-1">
                        {['me', 'unassigned', ...availableAssignees].map(sel => (
                          <button
                            key={sel}
                            onClick={() => toggleInList(structAssignees, setStructAssignees, sel)}
                            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                              structAssignees.includes(sel)
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                            }`}
                          >
                            {sel === 'me' ? 'Assigned to me' : sel === 'unassigned' ? 'Unassigned' : sel}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {hasStructuredFilters && (
                    <button
                      onClick={clearStructuredFilters}
                      className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-red-500 dark:text-gray-400"
                    >
                      <X size={12} /> Clear filters
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={rawQuery}
                      onChange={e => setRawQuery(e.target.value)}
                      placeholder='e.g. status = done AND assignee = me'
                      className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 font-mono text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                    />
                    {rawQuery && (
                      <button
                        onClick={() => setRawQuery('')}
                        className="btn-ghost !px-2 !py-1.5 text-xs"
                        title="Clear query"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">
                    Fields: status, title, description, assignee (use "me" or "unassigned"). Combine with AND, e.g.{' '}
                    <code>status = todo AND assignee = unassigned</code>.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Tasks — {teamName}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {filteredTasks.length} shown · {tasks.length} total · {myTasks.length} assigned to me
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => void loadTasks(teamName)}
                disabled={tasksLoading}
                className="btn-ghost !px-2 !py-1 text-xs"
                title="Refresh tasks"
              >
                <RefreshCcw size={12} className={tasksLoading ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={() => setShowCreateForm(v => !v)}
                className="btn-primary !px-2.5 !py-1 text-xs"
              >
                <Plus size={12} /> New Task
              </button>
            </div>
          </div>

          {showCreateForm && (
            <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-700/50">
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="Task title"
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                />
                <textarea
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  placeholder="Description (optional)"
                  rows={2}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowCreateForm(false)} className="btn-ghost !px-3 !py-1 text-xs">Cancel</button>
                  <button
                    onClick={() => void createTask()}
                    disabled={creating || !newTitle.trim()}
                    className="btn-primary !px-3 !py-1 text-xs disabled:opacity-50"
                  >
                    {creating ? <Loader2 size={12} className="animate-spin" /> : 'Create'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {tasksLoading ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Loader2 size={14} className="animate-spin" /> Loading tasks...
              </div>
            ) : tasksError ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <ServerCrash size={20} className="text-red-400" />
                <p className="text-sm text-red-600 dark:text-red-400">{tasksError}</p>
              </div>
            ) : tasks.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-gray-500 dark:text-gray-400">
                <CheckCircle2 size={20} className="text-gray-400" />
                <p>No tasks yet for this team.</p>
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-gray-500 dark:text-gray-400">
                <CheckCircle2 size={20} className="text-gray-400" />
                <p>No tasks match your search/filters.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700/40">
                {filteredTasks.map(task => {
                  const isMine = !!currentUser && task.assignee_id === currentUser.id
                  const busy = busyTaskId === task.id
                  return (
                    <div key={task.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{task.title}</p>
                        {task.description && (
                          <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{task.description}</p>
                        )}
                        <div className="mt-1.5 flex items-center gap-2">
                          <select
                            value={task.status}
                            onChange={e => void changeStatus(task, e.target.value as TaskStatus)}
                            disabled={busy}
                            className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                          >
                            {STATUS_ORDER.map(s => (
                              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                            ))}
                          </select>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {task.assignee_name ? `Assigned to ${task.assignee_name}` : 'Unassigned'}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => void toggleAssignToMe(task)}
                        disabled={busy}
                        className={`shrink-0 btn-ghost !px-2 !py-1 text-xs ${isMine ? 'text-blue-600 dark:text-blue-400' : ''}`}
                        title={isMine ? 'Unassign from me' : 'Assign to me'}
                      >
                        {busy ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : isMine ? (
                          <><UserMinus size={12} /> Unassign</>
                        ) : (
                          <><UserCheck size={12} /> Assign to me</>
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
        </>
      )}
    </div>
  )
}
