import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, ExternalLink, GitBranch, Paperclip } from 'lucide-react'
import { apiService } from '@/services/api'
import { Badge, ErrorState, Skeleton } from '@/ui'
import { workApi, workKeys } from './api'
import { WORK_STATUS_LABELS } from './types'

/** The story attached to the workspace: what is being tested, and what the AI assistant gets as context. */
export default function StoryContextBar({ projectId, itemId }: { projectId: string; itemId: number }) {
  const [expanded, setExpanded] = useState(false)
  const query = useQuery({ queryKey: workKeys.item(projectId, itemId), queryFn: () => workApi.item(projectId, itemId) })

  if (query.isPending) return <Skeleton className="h-10" />
  if (query.isError) return <ErrorState title="The attached story could not be loaded">{apiService.errorMessage(query.error)}</ErrorState>
  const item = query.data
  return (
    <section aria-label="Attached story" className="shrink-0 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}
          className="flex min-w-0 items-center gap-1.5 text-left font-medium text-fg">
          {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          <Paperclip size={14} className="text-accent" aria-hidden />
          <span className="truncate">Story {item.external_key} · {item.title}</span>
        </button>
        <Badge tone="accent">{WORK_STATUS_LABELS[item.status]}</Badge>
        {item.branch && <span className="flex items-center gap-1 text-xs text-fg-muted"><GitBranch size={12} aria-hidden /><code>{item.branch}</code></span>}
        <span className="flex-1" />
        <span className="text-xs text-fg-muted">Sent to the assistant with every message</span>
        <Link to={`/work/board?item=${item.id}`} className="text-xs font-semibold text-accent hover:underline">Board</Link>
        {item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
            {item.source === 'jira' ? 'Jira' : 'Confluence'} <ExternalLink size={12} aria-hidden />
          </a>
        )}
      </div>
      {expanded && (
        <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap font-sans text-xs text-fg-muted">
          {item.context?.text || 'No description in the story.'}
        </pre>
      )}
    </section>
  )
}
