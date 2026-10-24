import { useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, Maximize2 } from 'lucide-react'
import { apiService } from '@/services/api'
import { Button, ErrorState, Skeleton, buttonStyles } from '@/ui'
import { reportKeys, reportsApi } from './api'
import PublishPanel from './PublishPanel'
import ReportActions from './ReportActions'

/** The run's Allure report, embedded; it can go full screen or open in its own tab. */
export default function ReportViewerPage() {
  const { runId = '' } = useParams<{ runId: string }>()
  const frame = useRef<HTMLIFrameElement | null>(null)
  // Links last an hour; refresh them well before.
  const link = useQuery({ queryKey: reportKeys.link(runId), queryFn: () => reportsApi.link(runId), staleTime: 30 * 60_000, retry: false })

  return (
    <div className="flex h-full min-h-[480px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/reports/list" className={buttonStyles('ghost', 'sm')}><ArrowLeft size={14} aria-hidden /> All reports</Link>
        <span className="text-[13px] text-fg-muted">Report of <code>{runId}</code></span>
        <span className="flex-1" />
        <PublishPanel runId={runId} />
        {link.data && (
          <>
            <ReportActions runId={runId} />
            <Button size="sm" icon={<Maximize2 size={13} />} onClick={() => void frame.current?.requestFullscreen()}>Full screen</Button>
            <a href={link.data} target="_blank" rel="noopener noreferrer" className={buttonStyles('secondary', 'sm')}>
              <ExternalLink size={13} aria-hidden /> Open in a new tab
            </a>
          </>
        )}
      </div>
      {link.isPending ? <Skeleton className="min-h-0 flex-1" /> : link.isError ? (
        <ErrorState title="The report is not available">{apiService.errorMessage(link.error)}</ErrorState>
      ) : (
        // Sandboxed (no same-origin): the report's scripts cannot reach ATM. The server sets the same sandbox.
        <iframe ref={frame} title={`Allure report of ${runId}`} src={link.data}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads"
          className="min-h-0 w-full flex-1 rounded-xl border border-line bg-white" />
      )}
    </div>
  )
}
