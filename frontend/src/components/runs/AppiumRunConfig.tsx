import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FileCog, Loader2, PlayCircle, RefreshCw, XCircle,
} from 'lucide-react'
import { apiService } from '@/services/api'
import PropertiesEditorModal from '@/components/runs/PropertiesEditorModal'
import type { AppiumRunSelection } from '@/store/useAppStore'
import type {
  AppiumCheck,
  AppiumCheckStatus,
  AppiumDeviceProfile,
  AppiumProjectDetails,
  AppiumRunner,
  AppiumSuite,
} from '@/types/domain'

const STATUS_RANK: Record<AppiumCheckStatus, number> = { ok: 0, warning: 1, error: 2 }
const DETAILS_OPEN_KEY = 'runs.appium.detailsOpen'
const selectionKey = (projectId: string) => `runs.appium.selection.${projectId}`

// Analysis per project for this browser session, so switching projects is instant.
const analysisCache = new Map<string, AppiumProjectDetails | null>()

export function useAppiumAnalysis(projectId: string | null) {
  const [analysis, setAnalysis] = useState<AppiumProjectDetails | null>(
    () => (projectId ? analysisCache.get(projectId) ?? null : null),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const load = useCallback(async (refresh = false) => {
    const current = ++requestId.current
    if (!projectId) {
      setAnalysis(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await apiService.getLocalAppiumAnalysis(projectId, refresh)
      if (current !== requestId.current) return
      const details = result.detected ? result : null
      analysisCache.set(projectId, details)
      setAnalysis(details)
    } catch (err) {
      if (current !== requestId.current) return
      // 400 = no linked checkout; the Local page already handles that case.
      if (axios.isAxiosError(err) && err.response?.status === 400) {
        analysisCache.set(projectId, null)
        setAnalysis(null)
      } else {
        setError(apiService.errorMessage(err))
      }
    } finally {
      if (current === requestId.current) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setAnalysis(projectId ? analysisCache.get(projectId) ?? null : null)
    void load()
  }, [projectId, load])

  return { analysis, loading, error, reload: load }
}

function worst(statuses: AppiumCheckStatus[]): AppiumCheckStatus {
  return statuses.reduce<AppiumCheckStatus>((acc, s) => (STATUS_RANK[s] > STATUS_RANK[acc] ? s : acc), 'ok')
}

function StatusIcon({ status }: { status: AppiumCheckStatus }) {
  if (status === 'ok') return <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-emerald-500" />
  if (status === 'warning') return <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-500" />
  return <XCircle size={11} className="mt-0.5 shrink-0 text-red-500" />
}

function CheckRow({ check }: { check: Pick<AppiumCheck, 'title' | 'status' | 'message' | 'fix' | 'file' | 'line'> }) {
  return (
    <li className="flex items-start gap-1.5 py-0.5">
      <StatusIcon status={check.status} />
      <div className="min-w-0">
        <span className="font-medium text-gray-800 dark:text-gray-100">{check.title}: </span>
        <span className="text-gray-600 dark:text-gray-300">{check.message}</span>
        {check.fix && check.status !== 'ok' && (
          <div className="break-all font-mono text-[10px] text-blue-700 dark:text-blue-300">
            → {check.fix}
            {check.file && <span className="text-gray-500"> ({check.file}{check.line ? `:${check.line}` : ''})</span>}
          </div>
        )}
      </div>
    </li>
  )
}

function ProfileDetails({ profile, readyProfiles }: { profile: AppiumDeviceProfile; readyProfiles: AppiumDeviceProfile[] }) {
  const device = profile.station_device
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-1.5">
        <StatusIcon status={profile.status} />
        <div className="min-w-0 text-gray-700 dark:text-gray-200">
          <span className="font-medium">Device {profile.option}: </span>
          {device
            ? <>{device.name} ({device.os_version}, {device.state}){profile.app_installed === true && ' · app installed'}</>
            : profile.platform === 'ios' ? `simulator ${profile.udid}` : `emulator ${profile.avd || profile.device_name}`}
          {profile.issues.length > 0 && (
            <ul className="ml-3 list-disc text-gray-600 dark:text-gray-300">
              {profile.issues.map(issue => <li key={issue}>{issue}</li>)}
            </ul>
          )}
        </div>
      </div>
      {profile.suggestion && (
        <div className="rounded-md bg-blue-50 px-2 py-1 dark:bg-blue-900/20">
          <div className="text-blue-800 dark:text-blue-200">
            To use {profile.suggestion.device.name}, edit <span className="font-mono">{profile.file}:{profile.line}</span>:
          </div>
          {profile.suggestion.changes.map(change => (
            <div key={change.key} className="break-all font-mono text-[10px]">
              <span className="text-gray-500">{change.key}: </span>
              <span className="text-red-600 line-through dark:text-red-400">{change.current ?? '—'}</span>
              {' → '}
              <span className="text-emerald-700 dark:text-emerald-300">{change.suggested}</span>
            </div>
          ))}
        </div>
      )}
      {profile.status !== 'ok' && readyProfiles.length > 0 && (
        <div className="text-gray-600 dark:text-gray-300">Ready profiles: {readyProfiles.map(p => p.option).join(', ')}</div>
      )}
    </div>
  )
}

function profileLabel(profile: AppiumDeviceProfile, inFile: boolean) {
  const platform = profile.platform === 'ios' ? 'iOS' : 'Android'
  const mark = profile.status === 'ok' ? '✓' : profile.status === 'warning' ? '⚠' : '✗'
  return `${mark} ${profile.option} · ${platform} ${profile.platform_version ?? ''}${inFile ? ' (file)' : ''}`
}

type Selection = { target: string; appEnv: string; profile: string }

function readSelection(projectId: string | null): Partial<Selection> {
  if (!projectId) return {}
  try {
    return JSON.parse(localStorage.getItem(selectionKey(projectId)) || '{}') as Partial<Selection>
  } catch {
    return {}
  }
}

export function AppiumRunConfig({
  projectId,
  analysis,
  loading,
  onReload,
  onRun,
  onSelectionChange,
}: {
  projectId: string | null
  analysis: AppiumProjectDetails
  loading: boolean
  onReload: () => void
  onRun: (params: { target: string; label: string; appEnv: string; deviceRunOption: string }) => Promise<void>
  onSelectionChange?: (selection: AppiumRunSelection | null) => void
}) {
  const [target, setTarget] = useState('')
  const [appEnv, setAppEnv] = useState('')
  const [profileOption, setProfileOption] = useState('')
  const [filter, setFilter] = useState('')
  const [starting, setStarting] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(() => localStorage.getItem(DETAILS_OPEN_KEY) === '1')
  const [propertiesOpen, setPropertiesOpen] = useState(false)

  // Restore the last selection for this project, falling back to the project's own settings.
  useEffect(() => {
    const saved = readSelection(projectId)
    const targets = new Set([
      ...analysis.runners.filter(r => r.runnable).map(r => `runner:${r.name}`),
      ...analysis.suites.map(s => `suite:${s.folder}/${s.file}`),
    ])
    const options = new Set(analysis.profiles.flatMap(p => [p.option, ...p.aliases]))
    setTarget(saved.target && targets.has(saved.target) ? saved.target : '')
    setAppEnv(saved.appEnv && analysis.settings.app_env_values.includes(saved.appEnv)
      ? saved.appEnv : analysis.settings.app_env || analysis.settings.app_env_values[0] || '')
    setProfileOption(saved.profile && options.has(saved.profile)
      ? saved.profile : analysis.settings.device_run_option || '')
  }, [projectId, analysis])

  const updateSelection = (patch: Partial<Selection>) => {
    const next = { target, appEnv, profile: profileOption, ...patch }
    if (patch.target !== undefined) setTarget(patch.target)
    if (patch.appEnv !== undefined) setAppEnv(patch.appEnv)
    if (patch.profile !== undefined) setProfileOption(patch.profile)
    if (projectId) localStorage.setItem(selectionKey(projectId), JSON.stringify(next))
  }

  const selectedProfile = useMemo(
    () => analysis.profiles.find(p => p.option === profileOption || p.aliases.includes(profileOption)) ?? null,
    [analysis, profileOption],
  )
  const readyProfiles = useMemo(() => analysis.profiles.filter(p => p.status === 'ok'), [analysis])
  const toolChecks = useMemo(
    () => analysis.checks.filter(c => c.id !== 'device-profile' && c.id !== 'app-env'),
    [analysis],
  )
  const envStatus: AppiumCheckStatus = appEnv && analysis.settings.app_env_ready[appEnv] ? 'ok' : 'error'
  const overall = worst([...toolChecks.map(c => c.status), envStatus, selectedProfile?.status ?? 'error'])
  const issueCount = [...toolChecks.map(c => c.status), envStatus, selectedProfile?.status ?? 'error']
    .filter(s => s !== 'ok').length

  const runnerGroups = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const groups = new Map<string, AppiumRunner[]>()
    for (const runner of analysis.runners) {
      if (needle && !`${runner.name} ${runner.group} ${runner.tags ?? ''}`.toLowerCase().includes(needle)) continue
      groups.set(runner.group, [...(groups.get(runner.group) ?? []), runner])
    }
    return [...groups.entries()]
  }, [analysis, filter])

  const suiteGroups = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const groups = new Map<string, AppiumSuite[]>()
    for (const suite of analysis.suites) {
      if (needle && !`${suite.name} ${suite.folder} ${suite.file}`.toLowerCase().includes(needle)) continue
      groups.set(suite.folder, [...(groups.get(suite.folder) ?? []), suite])
    }
    return [...groups.entries()]
  }, [analysis, filter])

  const runnableCount = analysis.runners.filter(r => r.runnable).length
  const brokenRunners = useMemo(() => analysis.runners.filter(r => !r.runnable), [analysis])
  const targetLabel = useMemo(() => {
    if (target.startsWith('runner:')) return target.slice('runner:'.length)
    const suite = analysis.suites.find(s => `suite:${s.folder}/${s.file}` === target)
    return suite ? `${suite.name} (${suite.folder})` : ''
  }, [analysis, target])

  // Share the selection so the Execute button re-runs with what is selected here.
  useEffect(() => {
    if (!onSelectionChange) return
    onSelectionChange(projectId ? { projectId, target, label: targetLabel, appEnv, deviceRunOption: profileOption } : null)
  }, [onSelectionChange, projectId, target, targetLabel, appEnv, profileOption])

  const toggleDetails = () => {
    setDetailsOpen(prev => {
      localStorage.setItem(DETAILS_OPEN_KEY, prev ? '0' : '1')
      return !prev
    })
  }

  const run = async () => {
    if (!target || !appEnv || !profileOption) return
    setStarting(true)
    try {
      await onRun({ target, label: targetLabel, appEnv, deviceRunOption: profileOption })
    } finally {
      setStarting(false)
    }
  }

  const summaryClass = overall === 'ok'
    ? 'text-emerald-600 dark:text-emerald-400'
    : overall === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'

  return (
    <>
      <input
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder={`Filter ${runnableCount} runners / ${analysis.suites.length} suites`}
        className="form-input !py-1 !px-2 !text-xs w-full"
      />
      <select value={target} onChange={e => updateSelection({ target: e.target.value })} className="form-input !py-1.5 !px-2 !text-xs w-full">
        <option value="">Select a runner or suite…</option>
        {runnerGroups.map(([group, runners]) => (
          <optgroup key={`r-${group}`} label={`Runners · ${group}`}>
            {runners.map(runner => (
              <option
                key={runner.class_name}
                value={`runner:${runner.name}`}
                disabled={!runner.runnable}
                title={runner.runnable
                  ? runner.note ?? runner.tags ?? undefined
                  : `${runner.issue}${runner.suggested_features ? `\nProbably moved to: ${runner.suggested_features}` : ''}`}
              >
                {runner.name}{runner.runnable ? '' : ' (feature path missing)'}
              </option>
            ))}
          </optgroup>
        ))}
        {suiteGroups.map(([folder, suites]) => (
          <optgroup key={`s-${folder}`} label={`TestNG suites · ${folder}`}>
            {suites.map(suite => (
              <option key={suite.path} value={`suite:${suite.folder}/${suite.file}`}>{suite.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-1.5">
        <select
          value={appEnv}
          onChange={e => updateSelection({ appEnv: e.target.value })}
          className="form-input !py-1.5 !px-2 !text-xs w-full"
          title="appEnv"
        >
          {analysis.settings.app_env_values.map(value => (
            <option key={value} value={value}>
              {value}{analysis.settings.app_env_ready[value] ? '' : ' (no data)'}
            </option>
          ))}
        </select>
        <select
          value={profileOption}
          onChange={e => updateSelection({ profile: e.target.value })}
          className="form-input !py-1.5 !px-2 !text-xs w-full"
          title="Device profile (deviceRunOption)"
        >
          {!selectedProfile && <option value={profileOption}>✗ {profileOption || '—'} · not defined</option>}
          {analysis.profiles.map(profile => (
            <option key={profile.option} value={profile.option}>
              {profileLabel(profile, profile.option === analysis.settings.device_run_option)}
            </option>
          ))}
        </select>
      </div>
      <button
        onClick={() => void run()}
        disabled={!projectId || !target || !appEnv || !profileOption || starting}
        className="btn-primary !px-2 !py-1.5 text-xs w-full justify-center"
        title={overall === 'error' ? 'This station needs changes first — the run will likely fail. See details below.' : undefined}
      >
        {starting ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />} Run
      </button>

      <div className="flex items-center justify-between gap-2 text-[10px]">
        <button onClick={toggleDetails} className={`flex items-center gap-1 font-medium ${summaryClass}`}>
          {detailsOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          {overall === 'ok'
            ? 'Ready on this station'
            : `${issueCount} ${issueCount === 1 ? 'item needs' : 'items need'} attention`}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPropertiesOpen(true)}
            disabled={!projectId}
            className="flex items-center gap-1 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            title="View and edit the project's .properties files before running"
          >
            <FileCog size={10} /> Properties
          </button>
          <button
            onClick={onReload}
            disabled={loading}
            className="flex items-center gap-1 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            title="Re-detect runners, devices and station tools"
          >
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> Re-detect
          </button>
        </div>
      </div>

      {propertiesOpen && projectId && (
        <PropertiesEditorModal
          projectId={projectId}
          canEdit
          onClose={() => setPropertiesOpen(false)}
          onSaved={onReload}
        />
      )}

      {detailsOpen && (
        <div className="max-h-56 space-y-1.5 overflow-auto rounded-lg border border-gray-200 bg-gray-50/70 px-2 py-1.5 text-[10px] dark:border-gray-700 dark:bg-gray-900/30">
          <div className="text-gray-500 dark:text-gray-400">
            {analysis.framework.language} {analysis.framework.java_release ?? ''} · {analysis.framework.build} ·{' '}
            {analysis.framework.test_runner} · station {analysis.station.hostname}
          </div>
          {selectedProfile
            ? <ProfileDetails profile={selectedProfile} readyProfiles={readyProfiles} />
            : (
              <div className="flex items-start gap-1.5 text-red-600 dark:text-red-400">
                <XCircle size={11} className="mt-0.5 shrink-0" />
                deviceRunOption “{profileOption}” is not defined in {analysis.profiles_file ?? 'the project'}.
              </div>
            )}
          <ul>
            {toolChecks.map(check => <CheckRow key={check.id} check={check} />)}
            <CheckRow
              check={{
                title: 'appEnv',
                status: envStatus,
                message: envStatus === 'ok' ? `${appEnv} (test data present).` : `No test data for appEnv=${appEnv || '—'}.`,
                fix: envStatus === 'ok' ? null : `Create src/test/resources/userProps/userProp_${appEnv}.properties`,
                file: null,
                line: null,
              }}
            />
          </ul>
          {brokenRunners.length > 0 && (
            <details className="text-gray-600 dark:text-gray-300">
              <summary className="cursor-pointer font-medium text-amber-700 dark:text-amber-300">
                {brokenRunners.length} {brokenRunners.length === 1 ? 'runner points' : 'runners point'} to missing features
              </summary>
              <ul className="mt-1 space-y-1">
                {brokenRunners.map(runner => (
                  <li key={runner.class_name}>
                    <span className="font-medium">{runner.name}</span>
                    <div className="break-all font-mono text-[10px] text-red-600 dark:text-red-400">{runner.issue}</div>
                    {runner.suggested_features && (
                      <div className="break-all font-mono text-[10px] text-blue-700 dark:text-blue-300">
                        → features = "{runner.suggested_features}" <span className="text-gray-500">({runner.path})</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="text-gray-500 dark:text-gray-400">
            Defaults come from <span className="font-mono">{analysis.settings.file}</span>; your choices are passed as{' '}
            <span className="font-mono">-D</span> options and project files are not modified.
          </div>
        </div>
      )}
    </>
  )
}
