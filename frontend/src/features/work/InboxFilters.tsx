import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, SlidersHorizontal, Trash2 } from 'lucide-react'
import { apiService } from '@/services/api'
import { Badge, Button, Checkbox, Dialog, ErrorState, IconButton, Input, Textarea, useToast } from '@/ui'
import type { JiraInboxFilters, SavedFilter } from './api'
import { FILTER_KEYS, workApi, workKeys } from './api'

const SELECT = 'h-8 rounded-lg border border-line bg-surface px-2 text-[13px] text-fg focus:border-brand focus:outline-none'

export type FilterValues = Required<Pick<JiraInboxFilters, 'q' | 'type' | 'status' | 'assignee' | 'sprint' | 'label' | 'jql'>>

const list = (value: string) => value.split(',').map(v => v.trim()).filter(Boolean)
const join = (values: string[]) => values.join(',')
const onlyFilters = (values: FilterValues): Record<string, string> =>
  Object.fromEntries(FILTER_KEYS.map(key => [key, values[key]]).filter(([, v]) => v))

function MoreFilters({ values, issueTypes, statuses, onApply, onClose }: {
  values: FilterValues
  issueTypes: string[]
  statuses: string[]
  onApply: (changes: Partial<FilterValues>) => void
  onClose: () => void
}) {
  const [types, setTypes] = useState(list(values.type))
  const [chosenStatuses, setStatuses] = useState(list(values.status))
  const [labels, setLabels] = useState(values.label)
  const [jql, setJql] = useState(values.jql)
  const toggle = (setter: (fn: (v: string[]) => string[]) => void, value: string) =>
    setter(current => current.includes(value) ? current.filter(v => v !== value) : [...current, value])
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }} title="More filters" className="max-w-lg"
      footer={(
        <>
          <Button variant="ghost" onClick={() => { setTypes([]); setStatuses([]); setLabels(''); setJql('') }}>Clear</Button>
          <Button variant="primary" onClick={() => { onApply({ type: join(types), status: join(chosenStatuses), label: labels.trim(), jql: jql.trim() }); onClose() }}>
            Apply
          </Button>
        </>
      )}>
      <div className="space-y-4">
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-fg-muted">Issue types (none: all types)</legend>
          <div className="grid grid-cols-2 gap-1">
            <Checkbox label="Stories (user and technical)" checked={types.includes('stories')} onChange={() => toggle(setTypes, 'stories')} />
            {issueTypes.map(name => <Checkbox key={name} label={name} checked={types.includes(name)} onChange={() => toggle(setTypes, name)} />)}
          </div>
        </fieldset>
        {statuses.length > 0 && (
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-fg-muted">Statuses (none: any status)</legend>
            <div className="grid grid-cols-2 gap-1">
              {statuses.map(name => <Checkbox key={name} label={name} checked={chosenStatuses.includes(name)} onChange={() => toggle(setStatuses, name)} />)}
            </div>
          </fieldset>
        )}
        <Input label="Labels" value={labels} onChange={e => setLabels(e.target.value)} placeholder="checkout, ui" help="Several labels separated by commas." />
        <Textarea label="Advanced JQL (optional)" value={jql} onChange={e => setJql(e.target.value)} rows={2} placeholder='priority = High AND reporter = currentUser()'
          help="Added to the other filters with AND. The project and the order are set by ATM." />
      </div>
    </Dialog>
  )
}

function SaveFilterDialog({ projectId, values, onClose }: { projectId: string; values: FilterValues; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const save = useMutation({
    mutationFn: () => workApi.saveFilter(projectId, name.trim(), onlyFilters(values), isDefault),
    onSuccess: saved => {
      void queryClient.invalidateQueries({ queryKey: workKeys.savedFilters(projectId) })
      toast({ title: `Saved filter "${saved.name}"`, tone: 'success' })
      onClose()
    },
  })
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }} title="Save these filters" className="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        <Input label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="My open bugs" autoFocus
          help="Saved to your account for this project. The same name replaces an earlier filter." />
        <Checkbox label="Open the inbox with this filter" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
        {save.isError && <ErrorState title="Not saved">{apiService.errorMessage(save.error)}</ErrorState>}
      </div>
    </Dialog>
  )
}

/** Jira inbox filters (phase 16): quick filters, more filters, real sprints, and filters saved to the account. */
export default function InboxFilters({ projectId, values, onChange, hasUrlFilters }: {
  projectId: string
  values: FilterValues
  /** Replace the given filters; keys left out keep their value. */
  onChange: (changes: Partial<FilterValues>) => void
  /** The URL already sets filters: the default saved filter is not applied over them. */
  hasUrlFilters: boolean
}) {
  const queryClient = useQueryClient()
  const [more, setMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const meta = useQuery({ queryKey: workKeys.jiraFilters(projectId), queryFn: () => workApi.jiraFilters(projectId), retry: false })
  const sprints = useQuery({ queryKey: workKeys.sprints(projectId), queryFn: () => workApi.sprints(projectId), retry: false })
  const saved = useQuery({ queryKey: workKeys.savedFilters(projectId), queryFn: () => workApi.savedFilters(projectId) })
  const remove = useMutation({
    mutationFn: (filter: SavedFilter) => workApi.deleteFilter(projectId, filter.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: workKeys.savedFilters(projectId) }),
  })
  const applySaved = (filter: SavedFilter) =>
    onChange(Object.fromEntries(FILTER_KEYS.map(key => [key, filter.filters[key] ?? ''])) as Partial<FilterValues>)

  // The default saved filter opens the inbox (once, and only when the URL sets no filters).
  const appliedDefault = useRef(false)
  useEffect(() => {
    if (appliedDefault.current || !saved.data) return
    appliedDefault.current = true
    const preferred = saved.data.find(f => f.is_default)
    if (preferred && !hasUrlFilters) applySaved(preferred)
    // Only when the saved filters arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.data])

  const current = saved.data?.find(f => FILTER_KEYS.every(key => (f.filters[key] ?? '') === values[key]))
  const types = list(values.type)
  const statuses = list(values.status)
  const extra = (types.length > 1 ? 1 : 0) + (statuses.length > 1 ? 1 : 0) + (list(values.label).length > 1 ? 1 : 0) + (values.jql ? 1 : 0)
  const activeSprints = (sprints.data ?? []).filter(s => s.state === 'active')
  const futureSprints = (sprints.data ?? []).filter(s => s.state === 'future')
  const closedSprints = (sprints.data ?? []).filter(s => s.state === 'closed')

  return (
    <>
      <select aria-label="Type" value={values.type} onChange={e => onChange({ type: e.target.value })} className={SELECT}>
        <option value="">All types</option>
        <option value="stories">Stories</option>
        {meta.data?.issue_types.map(name => <option key={name} value={name}>{name}</option>)}
        {types.length > 1 && <option value={values.type}>{types.length} types</option>}
      </select>
      <select aria-label="Status" value={values.status} onChange={e => onChange({ status: e.target.value })} className={SELECT}>
        <option value="">Any status</option>
        {meta.data?.statuses.map(name => <option key={name} value={name}>{name}</option>)}
        {statuses.length > 1 && <option value={values.status}>{statuses.length} statuses</option>}
      </select>
      <select aria-label="Assignee" value={values.assignee} onChange={e => onChange({ assignee: e.target.value as FilterValues['assignee'] })} className={SELECT}>
        <option value="">Anyone</option>
        <option value="me">Assigned to me</option>
        <option value="unassigned">Unassigned</option>
      </select>
      <select aria-label="Sprint" value={values.sprint} onChange={e => onChange({ sprint: e.target.value })} className={SELECT}>
        <option value="">Any sprint</option>
        <option value="current">Current sprint</option>
        {activeSprints.length > 0 && <optgroup label="Active">{activeSprints.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}</optgroup>}
        {futureSprints.length > 0 && <optgroup label="Future">{futureSprints.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}</optgroup>}
        {closedSprints.length > 0 && <optgroup label="Closed">{closedSprints.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}</optgroup>}
      </select>
      <Button size="sm" icon={<SlidersHorizontal size={13} />} onClick={() => setMore(true)}>
        More filters{extra > 0 && <Badge tone="accent">{extra}</Badge>}
      </Button>
      <select aria-label="Saved filters" value={current ? String(current.id) : ''} className={SELECT}
        onChange={e => { const found = saved.data?.find(f => String(f.id) === e.target.value); if (found) applySaved(found) }}>
        <option value="">Saved filters…</option>
        {(saved.data ?? []).map(f => <option key={f.id} value={String(f.id)}>{f.name}{f.is_default ? ' (default)' : ''}</option>)}
      </select>
      {current
        ? <IconButton size="sm" label={`Delete the saved filter ${current.name}`} icon={<Trash2 size={13} />} onClick={() => remove.mutate(current)} />
        : <IconButton size="sm" label="Save these filters" icon={<Bookmark size={13} />} onClick={() => setSaving(true)} />}
      {more && <MoreFilters values={values} issueTypes={meta.data?.issue_types ?? []} statuses={meta.data?.statuses ?? []} onApply={onChange} onClose={() => setMore(false)} />}
      {saving && <SaveFilterDialog projectId={projectId} values={values} onClose={() => setSaving(false)} />}
    </>
  )
}
