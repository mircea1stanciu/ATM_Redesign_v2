import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, FileText, Loader2, Plus, RotateCcw, Save, Search, X } from 'lucide-react'
import { apiService } from '@/services/api'
import type { GitFileStatus, PropertiesFileSummary, PropertiesFileView } from '@/types/domain'

function GitBadge({ status }: { status: GitFileStatus }) {
  if (status === 'clean' || status === 'unknown') return null
  const label = status === 'modified' ? 'modified' : 'untracked'
  return (
    <span className="rounded bg-amber-100 px-1 py-px text-[9px] font-semibold uppercase text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
      {label}
    </span>
  )
}

type EditorKind = 'properties' | 'bruno'

/**
 * Editor for key/value config files in the linked checkout:
 * Java `.properties` files (Appium) or a Bruno collection's `environments/*.bru` files.
 */
export default function PropertiesEditorModal({
  projectId,
  canEdit,
  onClose,
  onSaved,
  kind = 'properties',
  collection,
  initialPath,
  initialEnvironment,
}: {
  projectId: string
  canEdit: boolean
  onClose: () => void
  onSaved: (path: string) => void
  kind?: EditorKind
  /** Bruno: collection whose environments are edited. */
  collection?: string
  /** File to open first. */
  initialPath?: string
  /** Bruno: environment (file name without .bru) to open first. */
  initialEnvironment?: string
}) {
  const bruno = kind === 'bruno'
  const source = useMemo(() => (bruno
    ? {
        list: () => apiService.listBrunoEnvFiles(projectId, collection ?? ''),
        read: (path: string, reveal: boolean) => apiService.readBrunoEnvFile(projectId, path, reveal),
        revert: (path: string) => apiService.revertBrunoEnvFile(projectId, path),
      }
    : {
        list: () => apiService.listPropertiesFiles(projectId),
        read: (path: string, reveal: boolean) => apiService.readPropertiesFile(projectId, path, reveal),
        revert: (path: string) => apiService.revertPropertiesFile(projectId, path),
      }), [bruno, projectId, collection])
  const noun = bruno ? 'variable' : 'property'
  const [files, setFiles] = useState<PropertiesFileSummary[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [view, setView] = useState<PropertiesFileView | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [additions, setAdditions] = useState<Record<string, string>>({})
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changeCount = new Set([...Object.keys(edits), ...Object.keys(toggles)]).size + Object.keys(additions).length
  const dirty = changeCount > 0

  const confirmDiscard = () => !dirty || window.confirm('Discard unsaved changes?')

  const loadFiles = useCallback(async () => {
    try {
      const list = await source.list()
      setFiles(list)
      setSelectedPath(prev => prev
        ?? list.find(f => f.path === initialPath)?.path
        ?? list.find(f => !!initialEnvironment && f.environment === initialEnvironment && !f.shared)?.path
        ?? list.find(f => !!initialEnvironment && f.environment === initialEnvironment)?.path
        ?? list.find(f => f.path.endsWith('envProp.properties'))?.path
        ?? list[0]?.path
        ?? null)
    } catch (err) {
      setError(apiService.errorMessage(err))
    }
  }, [source, initialPath, initialEnvironment])

  const loadFile = useCallback(async (path: string, reveal = false) => {
    setLoading(true)
    setError(null)
    try {
      setView(await source.read(path, reveal))
      setEdits({})
      setAdditions({})
      setToggles({})
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [source])

  useEffect(() => { void loadFiles() }, [loadFiles])
  useEffect(() => { if (selectedPath) void loadFile(selectedPath) }, [selectedPath, loadFile])

  const selectFile = (path: string) => {
    if (path === selectedPath || !confirmDiscard()) return
    setSelectedPath(path)
  }

  const close = () => {
    if (confirmDiscard()) onClose()
  }

  const entries = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const items = view?.entries ?? []
    return needle
      ? items.filter(e => e.key.toLowerCase().includes(needle) || (e.value ?? '').toLowerCase().includes(needle))
      : items
  }, [view, filter])

  const setValue = (key: string, original: string | null, value: string) => {
    setEdits(prev => {
      const next = { ...prev }
      if (original !== null && value === original) delete next[key]
      else next[key] = value
      return next
    })
  }

  const addProperty = () => {
    const key = newKey.trim()
    if (!key) return
    if (view?.entries.some(e => e.key === key) || key in additions) {
      setError(`${noun === 'variable' ? 'Variable' : 'Property'} '${key}' already exists.`)
      return
    }
    setAdditions(prev => ({ ...prev, [key]: newValue }))
    setNewKey('')
    setNewValue('')
    setError(null)
  }

  const save = async () => {
    if (!view || !dirty) return
    setSaving(true)
    setError(null)
    try {
      const updated = bruno
        ? await apiService.updateBrunoEnvFile(projectId, {
            path: view.path, etag: view.etag, changes: edits, additions, enabled: toggles,
          })
        : await apiService.updatePropertiesFile(projectId, {
            path: view.path, etag: view.etag, changes: edits, additions,
          })
      setView(updated.revealed === view.revealed ? updated : await source.read(view.path, view.revealed))
      setEdits({})
      setAdditions({})
      setToggles({})
      setFiles(prev => prev.map(f => (f.path === updated.path
        ? { ...f, git_status: updated.git_status, entries: updated.entries.length } : f)))
      onSaved(updated.path)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const revert = async () => {
    if (!view || !window.confirm(`Discard all local changes to ${view.path} and restore the committed version?`)) return
    setSaving(true)
    setError(null)
    try {
      const reverted = await source.revert(view.path)
      setView(reverted)
      setEdits({})
      setAdditions({})
      setToggles({})
      setFiles(prev => prev.map(f => (f.path === reverted.path ? { ...f, git_status: reverted.git_status } : f)))
      onSaved(reverted.path)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const toggleSecrets = () => {
    if (!view || !confirmDiscard()) return
    void loadFile(view.path, !view.revealed)
  }

  const hasSecrets = view?.entries.some(e => e.secret && !e.readonly) ?? false
  const hasToggles = view?.entries.some(e => e.enabled !== undefined) ?? false

  const setEnabled = (key: string, original: boolean, value: boolean) => {
    setToggles(prev => {
      const next = { ...prev }
      if (value === original) delete next[key]
      else next[key] = value
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div
        className="flex h-[82vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5 dark:border-gray-700">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {bruno ? <>Bruno environments <span className="font-normal text-gray-500">· {collection}</span></> : 'Project .properties files'}
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Changes are written to your local checkout (not committed) and used by the next run. Unchanged lines are kept as-is.
            </p>
          </div>
          <button onClick={close} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="w-72 shrink-0 overflow-auto border-r border-gray-200 py-1 dark:border-gray-700">
            {files.length === 0 && (
              <p className="px-3 py-4 text-xs text-gray-500">
                {bruno ? 'No environments/*.bru files found for this collection.' : 'No .properties files found.'}
              </p>
            )}
            {files.map(file => (
              <button
                key={file.path}
                onClick={() => selectFile(file.path)}
                className={`flex w-full items-start gap-1.5 px-3 py-1.5 text-left text-[11px] transition ${
                  file.path === selectedPath
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
                    : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/40'
                }`}
                title={file.path}
              >
                <FileText size={12} className="mt-0.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{file.path.split('/').pop()}</span>
                  <span className="block truncate text-[10px] text-gray-500 dark:text-gray-400">
                    {bruno
                      ? `${file.shared ? 'shared (parent folder)' : 'collection'} · ${file.entries} variables`
                      : `${file.path.split('/').slice(0, -1).join('/') || '.'} · ${file.entries} keys`}
                  </span>
                </span>
                <GitBadge status={file.git_status} />
              </button>
            ))}
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            {view && (
              <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
                <span className="truncate font-mono text-[11px] text-gray-700 dark:text-gray-200">{view.path}</span>
                <GitBadge status={view.git_status} />
                <div className="ml-auto flex items-center gap-1.5">
                  <div className="relative">
                    <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      value={filter}
                      onChange={e => setFilter(e.target.value)}
                      placeholder="Filter keys / values"
                      className="form-input !py-1 !pl-6 !pr-2 !text-xs w-48"
                    />
                  </div>
                  {hasSecrets && canEdit && (
                    <button onClick={toggleSecrets} className="btn-secondary !px-2 !py-1 text-[10px]">
                      {view.revealed ? <EyeOff size={11} /> : <Eye size={11} />} {view.revealed ? 'Hide secrets' : 'Show secrets'}
                    </button>
                  )}
                  {canEdit && view.git_status === 'modified' && (
                    <button onClick={() => void revert()} disabled={saving} className="btn-secondary !px-2 !py-1 text-[10px]">
                      <RotateCcw size={11} /> Revert
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={() => void save()} disabled={!dirty || saving} className="btn-primary !px-2.5 !py-1 text-[10px]">
                      {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
                      {dirty && ` (${changeCount})`}
                    </button>
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center justify-between gap-2 bg-red-50 px-3 py-1.5 text-[11px] text-red-700 dark:bg-red-900/20 dark:text-red-300">
                <span>{error}</span>
                {view && error.includes('changed on disk') && (
                  <button onClick={() => void loadFile(view.path, view.revealed)} className="underline">Reload file</button>
                )}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-auto">
              {loading ? (
                <div className="flex h-full items-center justify-center gap-2 text-xs text-gray-500">
                  <Loader2 size={14} className="animate-spin" /> Loading…
                </div>
              ) : view && (
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-gray-50 text-left text-[10px] uppercase text-gray-500 dark:bg-gray-900/80 dark:text-gray-400">
                    <tr>
                      {hasToggles && <th className="w-10 px-2 py-1.5 font-semibold" title="Enabled">On</th>}
                      <th className="w-[38%] px-3 py-1.5 font-semibold">{bruno ? 'Variable' : 'Key'}</th>
                      <th className="px-3 py-1.5 font-semibold">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
                    {entries.map(entry => {
                      const edited = entry.key in edits || entry.key in toggles
                      const hidden = entry.secret && entry.value === null
                      const enabled = toggles[entry.key] ?? entry.enabled
                      const readOnly = !canEdit || !!entry.readonly
                      return (
                        <tr key={entry.id ?? `${entry.key}-${entry.line}`} className={edited ? 'bg-blue-50/60 dark:bg-blue-500/10' : ''}>
                          {hasToggles && (
                            <td className="px-2 py-1 text-center align-middle">
                              {entry.enabled !== undefined && (
                                <input
                                  type="checkbox"
                                  checked={!!enabled}
                                  disabled={readOnly}
                                  onChange={e => setEnabled(entry.key, !!entry.enabled, e.target.checked)}
                                  title={enabled ? 'Enabled — uncheck to disable (~)' : 'Disabled — check to enable'}
                                  className="h-3.5 w-3.5 accent-blue-600"
                                />
                              )}
                            </td>
                          )}
                          <td className={`break-all px-3 py-1 align-top font-mono ${enabled === false ? 'text-gray-400 line-through' : 'text-gray-800 dark:text-gray-100'}`} title={`line ${entry.line}`}>
                            {entry.key}
                            {entry.multiline && <span className="ml-1 text-[9px] text-gray-400 no-underline">(multi-line)</span>}
                          </td>
                          <td className="px-3 py-1">
                            <input
                              value={edits[entry.key] ?? entry.value ?? ''}
                              onChange={e => setValue(entry.key, entry.value, e.target.value)}
                              readOnly={readOnly}
                              title={entry.note ?? undefined}
                              type={hidden && !edited && !entry.readonly ? 'password' : 'text'}
                              placeholder={entry.note
                                ?? (hidden ? (entry.has_value ? '•••••• (hidden — type to replace)' : '(empty)') : '')}
                              className={`form-input !py-1 !px-2 !text-[11px] w-full font-mono ${entry.readonly ? 'opacity-70' : ''}`}
                            />
                          </td>
                        </tr>
                      )
                    })}
                    {Object.entries(additions).map(([key, value]) => (
                      <tr key={`new-${key}`} className="bg-emerald-50/60 dark:bg-emerald-500/10">
                        {hasToggles && <td />}
                        <td className="break-all px-3 py-1 font-mono text-emerald-800 dark:text-emerald-200">+ {key}</td>
                        <td className="flex items-center gap-1 px-3 py-1">
                          <input
                            value={value}
                            onChange={e => setAdditions(prev => ({ ...prev, [key]: e.target.value }))}
                            className="form-input !py-1 !px-2 !text-[11px] w-full font-mono"
                          />
                          <button
                            onClick={() => setAdditions(prev => { const next = { ...prev }; delete next[key]; return next })}
                            className="rounded p-1 text-gray-400 hover:text-red-500"
                            title="Remove"
                          >
                            <X size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {view && canEdit && (
              <div className="flex items-center gap-1.5 border-t border-gray-200 px-3 py-2 dark:border-gray-700">
                <input
                  value={newKey}
                  onChange={e => setNewKey(e.target.value)}
                  placeholder={`New ${noun} name`}
                  className="form-input !py-1 !px-2 !text-[11px] w-64 font-mono"
                />
                <input
                  value={newValue}
                  onChange={e => setNewValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addProperty() }}
                  placeholder="Value"
                  className="form-input !py-1 !px-2 !text-[11px] flex-1 font-mono"
                />
                <button onClick={addProperty} disabled={!newKey.trim()} className="btn-secondary !px-2 !py-1 text-[10px]">
                  <Plus size={11} /> Add
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
