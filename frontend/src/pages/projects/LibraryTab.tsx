import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Boxes, CheckCircle2, Download, Loader2, Package, RefreshCcw, Rocket, Terminal, XCircle } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'
import type { LibraryInstallResult, LibraryManifest, SetupInstallResult, SetupPlan } from '@/types/domain'

export default function LibraryTab() {
  const selectedProjectId = useAppStore(s => s.selectedProjectId)
  const user = useAppStore(s => s.user)
  const canInstall = user?.role === 'admin' || user?.role === 'automation_lead'
    || user?.role === 'super_admin' || user?.role === 'org_admin'

  const [manifests, setManifests] = useState<LibraryManifest[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [installResult, setInstallResult] = useState<LibraryInstallResult | null>(null)

  const [setupPlan, setSetupPlan] = useState<SetupPlan | null>(null)
  const [setupLoading, setSetupLoading] = useState(false)
  const [installingSetup, setInstallingSetup] = useState(false)
  const [setupResult, setSetupResult] = useState<SetupInstallResult | null>(null)

  const loadSetup = async () => {
    if (!selectedProjectId) return
    setSetupLoading(true)
    try {
      const plan = await apiService.getSetupPlan(selectedProjectId)
      setSetupPlan(plan)
    } catch {
      setSetupPlan(null)
    } finally {
      setSetupLoading(false)
    }
  }

  const installSetup = async () => {
    if (!selectedProjectId) return
    setInstallingSetup(true)
    setSetupResult(null)
    try {
      const result = await apiService.installSetupPlan(selectedProjectId)
      setSetupResult(result)
      void load()
    } catch (e) {
      setSetupResult({
        run_workflow: setupPlan?.run_workflow || '',
        frameworks: setupPlan?.frameworks || [],
        exit_code: 1,
        steps: [],
      })
      setError(apiService.errorMessage(e))
    } finally {
      setInstallingSetup(false)
    }
  }

  const load = async () => {
    if (!selectedProjectId) return
    setLoading(true)
    setError(null)
    try {
      const data = await apiService.getLocalLibraries(selectedProjectId)
      setManifests(data)
      if (data.length > 0 && !data.some(m => m.id === selectedId)) {
        setSelectedId(data[0].id)
      }
    } catch (e) {
      setManifests([])
      setError(apiService.errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    void loadSetup()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId])

  const selected = useMemo(
    () => manifests.find(m => m.id === selectedId),
    [manifests, selectedId],
  )

  const install = async (manifest: LibraryManifest) => {
    if (!selectedProjectId) return
    setInstallingId(manifest.id)
    setInstallResult(null)
    try {
      const result = await apiService.installLocalLibraries(selectedProjectId, manifest.id)
      setInstallResult(result)
    } catch (e) {
      setInstallResult({
        manifest_id: manifest.id,
        command: manifest.install_command,
        cwd: '',
        exit_code: 1,
        timed_out: false,
        duration_seconds: 0,
        stdout: '',
        stderr: apiService.errorMessage(e),
      })
    } finally {
      setInstallingId(null)
    }
  }

  if (!selectedProjectId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        Select a project to view its required libraries.
      </div>
    )
  }

  const setupSteps = setupResult?.steps.length ? setupResult.steps : (setupPlan?.steps ?? [])

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Framework / workflow setup plan */}
      <div className="shrink-0 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5 dark:border-gray-700">
          <div className="flex min-w-0 items-center gap-2">
            <Rocket size={14} className="shrink-0 text-blue-500" />
            <div className="min-w-0">
              <h3 className="text-xs font-semibold text-gray-900 dark:text-white">Framework setup</h3>
              <p className="truncate text-[10px] text-gray-400">
                {setupPlan?.run_workflow
                  ? <>From <span className="font-mono">{setupPlan.run_workflow}</span></>
                  : 'Derived from the detected framework'}
                {setupPlan?.frameworks?.length ? ` · ${setupPlan.frameworks.join(', ')}` : ''}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => void loadSetup()}
              disabled={setupLoading}
              className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700/50"
              title="Re-detect setup plan"
            >
              <RefreshCcw size={13} className={setupLoading ? 'animate-spin' : ''} />
            </button>
            {canInstall && (setupPlan?.steps.length ?? 0) > 0 && (
              <button
                onClick={() => void installSetup()}
                disabled={installingSetup}
                className="btn-primary !px-3 !py-1.5 text-xs"
                title="Install all dependencies in order"
              >
                {installingSetup ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                {installingSetup ? 'Installing…' : 'Install all in order'}
              </button>
            )}
          </div>
        </div>
        <div className="max-h-52 overflow-y-auto px-2 py-2">
          {setupLoading && (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Detecting…
            </div>
          )}
          {!setupLoading && setupSteps.length === 0 && (
            <p className="px-2 py-3 text-center text-[11px] text-gray-400">
              No setup steps detected. Sync the local project and ensure a <span className="font-mono">.github/workflows/*run*.yml</span> file exists.
            </p>
          )}
          {!setupLoading && setupSteps.map((step, i) => {
            const result = setupResult?.steps.find(s => s.id === step.id)
            return (
              <div key={step.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <span className="mt-0.5 w-5 shrink-0 text-right text-[10px] tabular-nums text-gray-400">{i + 1}.</span>
                <span className="mt-0.5 shrink-0">
                  {result
                    ? (result.skipped
                        ? <span className="text-[10px] text-gray-400">skipped</span>
                        : result.exit_code === 0
                          ? <CheckCircle2 size={12} className="text-green-500" />
                          : <XCircle size={12} className="text-red-500" />)
                    : <Terminal size={12} className="text-gray-400" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[11px] text-gray-800 dark:text-gray-200">
                    {step.command}
                    {step.cwd && <span className="text-gray-400"> · {step.cwd}</span>}
                  </p>
                  <p className="text-[9px] uppercase tracking-wide text-gray-400">{step.source}</p>
                  {result && !result.skipped && (result.stderr || result.stdout) && (
                    <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap rounded bg-gray-950 p-1.5 text-[10px] text-gray-300">
                      {result.stderr || result.stdout}
                    </pre>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
      {/* Manifest list */}
      <div className="flex w-72 shrink-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-3 py-2.5 dark:border-gray-700">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-900 dark:text-white">
            <Boxes size={13} /> Manifests <span className="text-gray-400">({manifests.length})</span>
          </h3>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700/50"
            title="Rescan local project"
          >
            <RefreshCcw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Scanning…
            </div>
          )}
          {!loading && error && (
            <div className="m-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-300">
              <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
          {!loading && !error && manifests.length === 0 && (
            <p className="px-3 py-6 text-center text-[11px] text-gray-400">
              No dependency manifests found. Sync the local project first.
            </p>
          )}
          {!loading && manifests.map(m => (
            <button
              key={m.id}
              onClick={() => { setSelectedId(m.id); setInstallResult(null) }}
              className={`flex w-full flex-col items-start border-b border-gray-100 px-3 py-2 text-left transition dark:border-gray-700/50 ${
                selectedId === m.id ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
              }`}
            >
              <span className="flex items-center gap-1.5 text-xs font-medium text-gray-900 dark:text-white">
                <Package size={12} /> {m.manifest}
              </span>
              <span className="font-mono text-[10px] text-gray-400">{m.path}</span>
              <span className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                {m.count} {m.count === 1 ? 'library' : 'libraries'} · {m.ecosystem}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Library details */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
            Select a manifest to view the libraries it needs.
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-white">{selected.path}</h3>
                {selected.install_command && (
                  <p className="mt-0.5 font-mono text-[11px] text-gray-400">{selected.install_command}</p>
                )}
              </div>
              {canInstall && selected.install_command && (
                <button
                  onClick={() => void install(selected)}
                  disabled={installingId === selected.id}
                  className="btn-primary shrink-0 !px-3 !py-1.5 text-xs"
                  title="Install these libraries in the local project"
                >
                  {installingId === selected.id
                    ? <Loader2 size={12} className="animate-spin" />
                    : <Download size={12} />}
                  {installingId === selected.id ? 'Installing…' : 'Install'}
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {selected.libraries.length === 0 ? (
                <p className="px-4 py-6 text-xs text-gray-400">No libraries declared in this manifest.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500 dark:bg-gray-700/50 dark:text-gray-400">
                    <tr>
                      <th className="px-4 py-2 font-medium">Library</th>
                      <th className="px-4 py-2 font-medium">Version / Constraint</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.libraries.map(lib => (
                      <tr key={lib.name} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="px-4 py-1.5 font-medium text-gray-800 dark:text-gray-200">{lib.name}</td>
                        <td className="px-4 py-1.5 font-mono text-gray-500 dark:text-gray-400">{lib.version || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {installResult && (
              <div className="max-h-56 shrink-0 overflow-y-auto border-t border-gray-200 bg-gray-950 p-3 font-mono text-[11px] text-gray-200 dark:border-gray-700">
                <div className={`mb-1.5 flex items-center gap-1.5 font-semibold ${installResult.exit_code === 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {installResult.exit_code === 0 ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  {installResult.timed_out
                    ? 'Install timed out'
                    : `Exit ${installResult.exit_code} · ${installResult.duration_seconds}s`}
                </div>
                {installResult.stdout && <pre className="whitespace-pre-wrap">{installResult.stdout}</pre>}
                {installResult.stderr && <pre className="whitespace-pre-wrap text-red-300">{installResult.stderr}</pre>}
              </div>
            )}
          </>
        )}
      </div>
      </div>
    </div>
  )
}
