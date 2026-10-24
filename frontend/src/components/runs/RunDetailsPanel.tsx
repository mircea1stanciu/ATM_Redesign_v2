import { useState } from 'react'
import { ExternalLink, FileText, Loader2 } from 'lucide-react'
import PerformanceMetrics from '@/features/testing/PerformanceMetrics'
import { apiService } from '@/services/api'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { runDisplayName } from '@/utils/runName'
import { openBlobInNewTab } from '@/utils/openBlob'
import type { RunReportFile, TestRunDetails } from '@/types/domain'

const TECH_LABELS: Record<string, string> = {
  appium_server: 'Appium server',
  appium_driver: 'Appium driver',
  appium_java_client: 'Appium java-client',
  java: 'Java',
  java_release: 'Java release (pom.xml)',
  maven: 'Maven',
  xcode: 'Xcode',
  test_runner: 'Test runner',
  build: 'Build tool',
  language: 'Language',
  frameworks: 'Frameworks',
}

function formatSeconds(seconds?: number): string | null {
  if (seconds == null) return null
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h ? `${h}h` : '', m ? `${m}m` : '', `${s}s`].filter(Boolean).join(' ')
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700">
      <h4 className="border-b border-gray-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700/60 dark:text-gray-400">
        {title}
      </h4>
      <div className="px-3 py-2">{children}</div>
    </section>
  )
}

function Rows({ rows }: { rows: [string, React.ReactNode | null | undefined][] }) {
  const visible = rows.filter(([, value]) => value !== null && value !== undefined && value !== '')
  if (visible.length === 0) return <p className="text-[11px] text-gray-400">Not available.</p>
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[11px]">
      {visible.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
          <dd className="min-w-0 break-words text-gray-900 dark:text-gray-100">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function techValue(value: unknown): string | null {
  if (value && typeof value === 'object' && 'name' in value) {
    const driver = value as { name: string; version?: string | null }
    return `${driver.name}${driver.version ? ` ${driver.version}` : ''}`
  }
  return value == null ? null : String(value)
}

export default function RunDetailsPanel({
  run,
  onOpenAllure,
}: {
  run: TestRunDetails
  onOpenAllure: () => void
}) {
  const [openingReport, setOpeningReport] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const details = run.details ?? null
  const app = details?.app
  const device = details?.device
  const target = details?.target

  const openReport = async (report: RunReportFile) => {
    setOpeningReport(report.file)
    setError(null)
    try {
      await openBlobInNewTab(() => apiService.getRunReportFile(run.id, report.file))
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setOpeningReport(null)
    }
  }

  const duration = formatSeconds(details?.duration_seconds)
    ?? (run.started_at && run.finished_at
      ? formatSeconds((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)
      : null)

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-white">{runDisplayName(run)}</h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {run.id} · {run.triggered_by || 'unknown user'} · branch {run.branch || 'main'}
          </p>
        </div>
        <StatusBadge status={run.status} />
      </div>

      {!details && (
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-500 dark:bg-gray-900/30 dark:text-gray-400">
          Execution details are recorded when a run finishes; this run has none (it is still running or ran before
          details were collected).
        </p>
      )}

      {details?.performance && <PerformanceMetrics performance={details.performance} />}

      <Section title="Reports">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex items-center gap-1.5 text-gray-800 dark:text-gray-100">
              <FileText size={12} className="text-gray-400" /> ATM Allure report (all test results)
            </span>
            <button
              onClick={onOpenAllure}
              disabled={run.results.length === 0}
              className="btn-secondary !px-2 !py-0.5 text-[10px]"
            >
              <ExternalLink size={10} /> Open
            </button>
          </div>
          {(details?.reports ?? []).map(report => (
            <div key={report.file} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-gray-800 dark:text-gray-100">
                  <FileText size={12} className="shrink-0 text-blue-500" />
                  <span className="truncate" title={report.name}>{report.name}</span>
                  <span className="shrink-0 rounded bg-gray-100 px-1 text-[9px] uppercase text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                    {report.kind}
                  </span>
                </span>
                <span className="block truncate pl-[18px] font-mono text-[10px] text-gray-500 dark:text-gray-400" title={report.source}>
                  {report.source} · {formatSize(report.size)}
                </span>
              </span>
              <button
                onClick={() => void openReport(report)}
                disabled={openingReport === report.file}
                className="btn-secondary shrink-0 !px-2 !py-0.5 text-[10px]"
              >
                {openingReport === report.file ? <Loader2 size={10} className="animate-spin" /> : <ExternalLink size={10} />} Open
              </button>
            </div>
          ))}
          {details && (details.reports ?? []).length === 0 && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              No report document was generated by the test framework during this run.
            </p>
          )}
          {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Section title="Execution">
          <Rows rows={[
            ['Started', run.started_at ? new Date(run.started_at).toLocaleString() : null],
            ['Finished', run.finished_at ? new Date(run.finished_at).toLocaleString() : null],
            ['Duration', duration],
            [target?.kind === 'suite' ? 'TestNG suite' : target?.kind === 'collection' ? 'Collection' : 'Runner',
              target ? `${target.name}${target.file ? ` (${target.file})` : ''}` : run.collection],
            ['Tags', target?.tags],
            ['Features', target?.features],
            ['Environment', details?.app_env ?? run.environment],
            ['Device profile', details?.device_run_option],
            ['Exit code', details?.exit_code ?? null],
            ['Command', details?.command?.length
              ? <code className="break-all font-mono text-[10px]">{details.command.join(' ')}</code> : null],
          ]} />
        </Section>

        {details?.type === 'appium' && (
          <Section title="Application under test">
            <Rows rows={[
              ['App', app?.name],
              ['Version', app?.version],
              ['Build', app?.build],
              ['Bundle / package', app?.id],
              ['Read from', app?.source],
            ]} />
          </Section>
        )}

        {details?.type === 'appium' && (
          <Section title="Device & platform">
            <Rows rows={[
              ['Platform', device?.platform ? `${device.platform}${device.platform_version ? ` ${device.platform_version}` : ''}` : null],
              ['Device', device?.name],
              ['Simulator / emulator OS', device?.os],
              ['Device id', device?.id ? <code className="font-mono text-[10px]">{device.id}</code> : null],
              ['Automation', device?.automation],
              ['Station', details?.station ? `${details.station.hostname} · ${details.station.os}` : null],
            ]} />
          </Section>
        )}

        {details?.technology && Object.keys(details.technology).length > 0 && (
          <Section title="Technology">
            <Rows rows={Object.entries(details.technology).map(([key, value]) => [TECH_LABELS[key] ?? key, techValue(value)])} />
          </Section>
        )}
      </div>

      <Section title={`Tests run (${run.results.length})`}>
        {run.results.length === 0 ? (
          <p className="text-[11px] text-gray-400">No test results recorded.</p>
        ) : (
          <ul className="space-y-1">
            {run.results.map(result => (
              <li key={result.id} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="min-w-0 truncate text-gray-800 dark:text-gray-100" title={result.test_name}>{result.test_name}</span>
                <StatusBadge status={result.status || 'error'} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
