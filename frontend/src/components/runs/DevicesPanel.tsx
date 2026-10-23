import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, Loader2, Monitor, Power, RefreshCw, Search, Smartphone, Square, XCircle,
} from 'lucide-react'
import { apiService } from '@/services/api'
import type {
  MobileDevice,
  MobileDeviceState,
  MobileDevicesResponse,
  MobilePlatform,
  MobilePlatformStatus,
  MobileStation,
} from '@/types/domain'

const IDLE_POLL_MS = 15000
const TRANSITION_POLL_MS = 3000
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

const PLATFORMS: { key: MobilePlatform; title: string; emptyHint: string }[] = [
  {
    key: 'android',
    title: 'Android emulators',
    emptyHint: 'No Android virtual devices found. Create one in Android Studio › Device Manager.',
  },
  {
    key: 'ios',
    title: 'iOS simulators',
    emptyHint: 'No iOS simulators found. Add one in Xcode › Window › Devices and Simulators.',
  },
]

const STATE_STYLES: Record<MobileDeviceState, { label: string; dot: string; badge: string }> = {
  running: {
    label: 'Running',
    dot: 'bg-emerald-400',
    badge: 'bg-emerald-100 text-emerald-700 ring-emerald-500/20 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  booting: {
    label: 'Booting',
    dot: 'bg-amber-400 animate-pulse',
    badge: 'bg-amber-100 text-amber-700 ring-amber-500/20 dark:bg-amber-900/30 dark:text-amber-300',
  },
  stopping: {
    label: 'Stopping',
    dot: 'bg-amber-400 animate-pulse',
    badge: 'bg-amber-100 text-amber-700 ring-amber-500/20 dark:bg-amber-900/30 dark:text-amber-300',
  },
  stopped: {
    label: 'Stopped',
    dot: 'bg-gray-400',
    badge: 'bg-gray-100 text-gray-600 ring-gray-400/20 dark:bg-gray-700/40 dark:text-gray-400',
  },
}

const STATE_ORDER: Record<MobileDeviceState, number> = { running: 0, booting: 1, stopping: 2, stopped: 3 }

function isTransitional(state: MobileDeviceState) {
  return state === 'booting' || state === 'stopping'
}

function DeviceStateBadge({ state }: { state: MobileDeviceState }) {
  const style = STATE_STYLES[state] ?? STATE_STYLES.stopped
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${style.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  )
}

function ToolingLine({ label, status, usingText, detail }: {
  label: string
  status: MobilePlatformStatus | undefined
  usingText: string
  detail: string | null
}) {
  const using = Boolean(status?.available)
  return (
    <div className="flex items-start gap-1.5 text-[11px]">
      {using
        ? <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-500" />
        : <XCircle size={12} className="mt-0.5 shrink-0 text-gray-400" />}
      <div className="min-w-0">
        <span className="font-medium text-gray-800 dark:text-gray-100">{label}: </span>
        {using ? (
          <>
            <span className="text-gray-700 dark:text-gray-200">{usingText}</span>
            {detail && <span className="break-all text-gray-500 dark:text-gray-400"> — {detail}</span>}
          </>
        ) : (
          <span className="text-gray-500 dark:text-gray-400">
            Not using station tools — {status?.reason || 'not available on this station.'}
          </span>
        )}
      </div>
    </div>
  )
}

function StationCard({ station, platforms }: {
  station: MobileStation
  platforms: MobileDevicesResponse['platforms']
}) {
  const browserHost = typeof window !== 'undefined' ? window.location.hostname : ''
  const isThisComputer = LOOPBACK_HOSTS.has(browserHost)
  const android = platforms.android
  const ios = platforms.ios
  const androidTooling = android?.tooling
  const iosTooling = ios?.tooling

  return (
    <div className="mx-3 mt-3 shrink-0 space-y-2 rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Monitor size={13} className="shrink-0 text-gray-500" />
          <span className="text-gray-500 dark:text-gray-400">Detected station:</span>
          <span className="font-semibold text-gray-900 dark:text-white">{station.hostname}</span>
          <span className="text-gray-500 dark:text-gray-400">· {station.os}</span>
          {station.user && <span className="text-gray-500 dark:text-gray-400">· user {station.user}</span>}
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
            isThisComputer
              ? 'bg-emerald-100 text-emerald-700 ring-emerald-500/20 dark:bg-emerald-900/30 dark:text-emerald-300'
              : 'bg-amber-100 text-amber-700 ring-amber-500/20 dark:bg-amber-900/30 dark:text-amber-300'
          }`}
          title={isThisComputer
            ? 'ATM is opened via localhost, so this station is the computer you are using.'
            : `ATM is opened via ${browserHost}; the devices run on ${station.hostname}.`}
        >
          {isThisComputer ? 'This computer' : 'Remote station'}
        </span>
      </div>

      {!isThisComputer && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          You opened ATM via {browserHost}. The devices below run on {station.hostname}, not on your computer.
          To use your own emulators, run the ATM backend on your computer.
        </p>
      )}

      <div className="space-y-1">
        <ToolingLine
          label="Android"
          status={android}
          usingText="using this station's Android SDK"
          detail={androidTooling?.sdk_path
            ? `${androidTooling.sdk_path}${androidTooling.source ? ` (found via ${androidTooling.source})` : ''}`
            : null}
        />
        <ToolingLine
          label="iOS"
          status={ios}
          usingText={`using this station's ${iosTooling?.xcode_version || 'Xcode'}`}
          detail={iosTooling?.xcode_path ?? null}
        />
      </div>
    </div>
  )
}

export default function DevicesPanel({ canExecute }: { canExecute: boolean }) {
  const [data, setData] = useState<MobileDevicesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      setData(await apiService.listMobileDevices())
      setError(null)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const hasTransition = data?.devices.some(d => isTransitional(d.state)) ?? false

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, hasTransition ? TRANSITION_POLL_MS : IDLE_POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh, hasTransition])

  const runAction = async (device: MobileDevice, action: 'boot' | 'shutdown') => {
    setBusyKey(`${device.platform}:${device.id}`)
    setError(null)
    try {
      const next = action === 'boot'
        ? await apiService.bootMobileDevice(device.platform, device.id)
        : await apiService.shutdownMobileDevice(device.platform, device.id)
      setData(next)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setBusyKey(null)
    }
  }

  const devicesByPlatform = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const grouped: Record<MobilePlatform, MobileDevice[]> = { android: [], ios: [] }
    for (const device of data?.devices ?? []) {
      const haystack = `${device.name} ${device.os_version ?? ''}`.toLowerCase()
      if (!needle || haystack.includes(needle)) grouped[device.platform]?.push(device)
    }
    for (const list of Object.values(grouped)) {
      list.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state])
    }
    return grouped
  }, [data, query])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2.5 dark:border-gray-700">
        <div>
          <h3 className="text-xs font-semibold text-gray-900 dark:text-white">Devices</h3>
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            Android emulators and iOS simulators installed on the detected station (the machine running the ATM backend).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter devices"
              className="form-input !py-1 !pl-6 !pr-2 !text-xs w-44"
            />
          </div>
          <button
            onClick={() => void refresh()}
            disabled={refreshing}
            className="btn-secondary !px-2 !py-1 text-[10px]"
            title="Refresh"
          >
            <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {data?.station && <StationCard station={data.station} platforms={data.platforms} />}

      {error && (
        <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Loader2 size={14} className="animate-spin" /> Discovering devices…
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 lg:grid-cols-2">
          {PLATFORMS.map(({ key, title, emptyHint }) => {
            const status = data?.platforms[key]
            const devices = devicesByPlatform[key]
            const running = (data?.devices ?? []).filter(d => d.platform === key && d.state === 'running').length
            return (
              <section key={key} className="flex flex-col self-start rounded-xl border border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-700/60">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-800 dark:text-gray-100">
                    <Smartphone size={13} /> {title}
                  </span>
                  {status?.available && (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">{running} running</span>
                  )}
                </div>

                {!status?.available ? (
                  <div className="flex items-start gap-2 px-3 py-4 text-xs text-gray-500 dark:text-gray-400">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
                    <span>{status?.reason || 'Not available on this host.'}</span>
                  </div>
                ) : devices.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-gray-500 dark:text-gray-400">
                    {query ? 'No devices match the filter.' : emptyHint}
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-700/60">
                    {devices.map(device => {
                      const busy = busyKey === `${device.platform}:${device.id}`
                      const transitional = isTransitional(device.state)
                      return (
                        <li key={device.id} className="flex items-center justify-between gap-3 px-3 py-2">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-gray-900 dark:text-white">{device.name}</div>
                            <div className="truncate text-[10px] text-gray-500 dark:text-gray-400">
                              {[device.os_version, device.serial].filter(Boolean).join(' · ') || '—'}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <DeviceStateBadge state={device.state} />
                            {canExecute && (
                              device.state === 'stopped' ? (
                                <button
                                  onClick={() => void runAction(device, 'boot')}
                                  disabled={busy}
                                  className="btn-primary !px-2 !py-1 text-[10px]"
                                >
                                  {busy ? <Loader2 size={11} className="animate-spin" /> : <Power size={11} />} Boot
                                </button>
                              ) : (
                                <button
                                  onClick={() => void runAction(device, 'shutdown')}
                                  disabled={busy || device.state === 'stopping'}
                                  className="btn-secondary !px-2 !py-1 text-[10px]"
                                >
                                  {busy || transitional
                                    ? <Loader2 size={11} className="animate-spin" />
                                    : <Square size={11} />} Stop
                                </button>
                              )
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
