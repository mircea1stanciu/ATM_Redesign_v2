import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Code2, Loader2 } from 'lucide-react'
import { apiService } from '@/services/api'
import type { StationIde } from '@/types/domain'

const PREFERRED_KEY = 'atm:preferredIde'
let cached: Promise<{ station: string; ides: StationIde[] }> | null = null

/** IDEs installed on the station running ATM (loaded once per browser session). */
export function useStationIdes() {
  const [state, setState] = useState<{ station: string; ides: StationIde[] } | null>(null)
  useEffect(() => {
    cached ??= apiService.listStationIdes().catch(() => ({ station: '', ides: [] }))
    let active = true
    cached.then(result => { if (active) setState(result) })
    return () => { active = false }
  }, [])
  return state
}

export interface IdeTarget {
  label: string
  /** Path relative to the project's local copy; '' = the project folder. */
  path: string
  /** Full path shown in tooltips / the menu. */
  detail?: string
  /** Short name used on the main button (e.g. the local folder name). */
  short?: string
}

/**
 * "Open in <IDE>" split button. Renders nothing when no IDE is detected on the station.
 * The main button uses the last IDE you picked; the arrow lists every detected IDE (and every target).
 */
export default function OpenInIdeMenu({ projectId, targets, compact = false }: {
  projectId: string
  targets: IdeTarget[]
  compact?: boolean
}) {
  const station = useStationIdes()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [preferred, setPreferred] = useState(() => window.localStorage.getItem(PREFERRED_KEY) || '')
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(() => setFeedback(null), 4000)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const ides = station?.ides ?? []
  if (!ides.length || !targets.length) return null
  const main = ides.find(ide => ide.id === preferred) ?? ides[0]

  const launch = async (ide: StationIde, target: IdeTarget) => {
    setOpen(false)
    setBusy(true)
    setFeedback(null)
    window.localStorage.setItem(PREFERRED_KEY, ide.id)
    setPreferred(ide.id)
    try {
      await apiService.openInIde(projectId, ide.id, target.path)
      setFeedback({ ok: true, text: `Opening ${target.short || target.path || 'the project'} in ${ide.name}…` })
    } catch (e) {
      setFeedback({ ok: false, text: apiService.errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const size = compact ? '!px-2 !py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        onClick={() => void launch(main, targets[0])}
        disabled={busy}
        title={`Open ${targets[0].detail || targets[0].path || 'the project folder'} in ${main.name}${station?.station ? ` on ${station.station}` : ''}`}
        className={`btn-secondary max-w-[26rem] rounded-r-none ${size}`}
      >
        {busy ? <Loader2 size={12} className="shrink-0 animate-spin" /> : <Code2 size={12} className="shrink-0" />}
        <span className="truncate">{compact ? main.name : targets[0].short ? <>Open <b>{targets[0].short}</b> in {main.name}</> : `Open in ${main.name}`}</span>
      </button>
      <button onClick={() => setOpen(o => !o)} className={`btn-secondary rounded-l-none border-l-0 !px-1.5 ${compact ? '!py-1' : 'py-1.5'}`} title="Choose IDE">
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-xl border border-gray-200 bg-white p-1 text-left shadow-xl dark:border-gray-700 dark:bg-gray-800">
          {targets.map(target => (
            <div key={target.path || '.'} className="py-1">
              {(targets.length > 1 || target.detail) && (
                <div className="px-2 pb-1" title={target.detail || target.path}>
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-gray-400">{target.label}</p>
                  {target.detail && <p className="truncate font-mono text-[10px] text-gray-400">{target.detail}</p>}
                </div>
              )}
              {ides.map(ide => (
                <button key={ide.id} onClick={() => void launch(ide, target)} title={ide.notes || undefined}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-blue-50 dark:text-gray-200 dark:hover:bg-blue-500/10">
                  <Code2 size={12} className="shrink-0 text-gray-400" />
                  <span className="flex-1 truncate">{ide.name}{ide.version ? <span className="text-gray-400"> {ide.version}</span> : null}</span>
                  {ide.id === main.id && <Check size={12} className="text-blue-500" />}
                </button>
              ))}
            </div>
          ))}
          <p className="border-t border-gray-100 px-2 pb-1 pt-1.5 text-[10px] text-gray-400 dark:border-gray-700">
            Opens on {station?.station || 'this station'}. Only IDEs installed there are listed.
          </p>
        </div>
      )}
      {feedback && (
        <span className={`absolute right-0 top-full z-20 mt-1 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] shadow ${feedback.ok
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
          : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
          {feedback.text}
        </span>
      )}
    </div>
  )
}
