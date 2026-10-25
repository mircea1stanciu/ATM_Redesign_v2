import { Fragment, useState } from 'react'
import type { ReactNode } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { Button, cn } from '@/ui'
import type { LineComment, Side } from './api'

export type Layout = 'split' | 'inline'

interface Row {
  kind: 'hunk' | 'context' | 'add' | 'del'
  text: string
  oldLine?: number
  newLine?: number
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** The lines of a unified diff with their old and new line numbers (as GitHub counts them for comments). */
export function parsePatch(patch: string | null): Row[] {
  const rows: Row[] = []
  let oldLine = 0
  let newLine = 0
  for (const text of (patch ?? '').split('\n')) {
    const hunk = HUNK.exec(text)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      rows.push({ kind: 'hunk', text })
    } else if (text.startsWith('\\')) {
      continue
    } else if (text.startsWith('+')) {
      rows.push({ kind: 'add', text: text.slice(1), newLine: newLine++ })
    } else if (text.startsWith('-')) {
      rows.push({ kind: 'del', text: text.slice(1), oldLine: oldLine++ })
    } else if (rows.length) {
      rows.push({ kind: 'context', text: text.slice(1), oldLine: oldLine++, newLine: newLine++ })
    }
  }
  return rows
}

/** Removed and added lines next to each other: each run of removals is paired with the additions after it. */
function splitRows(rows: Row[]): Array<{ hunk?: Row; left?: Row; right?: Row }> {
  const out: Array<{ hunk?: Row; left?: Row; right?: Row }> = []
  for (let i = 0; i < rows.length;) {
    const row = rows[i]
    if (row.kind === 'hunk') { out.push({ hunk: row }); i++; continue }
    if (row.kind === 'context') { out.push({ left: row, right: row }); i++; continue }
    const dels: Row[] = []
    const adds: Row[] = []
    while (i < rows.length && rows[i].kind === 'del') dels.push(rows[i++])
    while (i < rows.length && rows[i].kind === 'add') adds.push(rows[i++])
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push({ left: dels[k], right: adds[k] })
  }
  return out
}

interface Target { line: number; side: Side }

const sameTarget = (a: Target | null, b: Target) => Boolean(a && a.line === b.line && a.side === b.side)
const TONE: Record<Row['kind'], string> = {
  add: 'bg-success/10', del: 'bg-danger/10', context: '', hunk: 'bg-accent/5 text-fg-muted',
}

function CommentEditor({ onSave, onCancel, label }: { onSave: (body: string) => Promise<void>; onCancel: () => void; label: string }) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await onSave(body.trim())
    } catch {
      setBusy(false) // the page says why; the text stays to try again
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface p-2">
      <textarea autoFocus aria-label={label} value={body} onChange={e => setBody(e.target.value)} rows={3}
        className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] text-fg" placeholder="Leave a comment" />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" loading={busy} disabled={!body.trim()} onClick={() => void save()}>Post comment</Button>
      </div>
    </div>
  )
}

/**
 * One changed file as a diff (side by side or inline), with the comments on its lines and a "+" on each line to
 * write a new one (GitHub accepts comments on these lines). A new comment is posted to GitHub at once.
 */
export default function PatchView({ path, patch, layout, comments, canComment, onAdd }: {
  path: string
  patch: string | null
  layout: Layout
  comments: LineComment[]
  canComment: boolean
  onAdd: (target: Target, body: string) => Promise<void>
}) {
  const [editing, setEditing] = useState<Target | null>(null)
  const rows = parsePatch(patch)
  if (!patch) return <p className="px-4 py-3 text-[13px] text-fg-muted">No diff to show (binary or too large).</p>

  const threadFor = (target: Target): ReactNode => {
    const existing = comments.filter(c => c.line === target.line && c.side === target.side)
    const open = sameTarget(editing, target)
    if (!existing.length && !open) return null
    const where = `${target.side === 'LEFT' ? 'old line' : 'line'} ${target.line} of ${path}`
    return (
      <div className="space-y-2 border-y border-line bg-surface-2 px-3 py-2">
        {existing.map(c => (
          <div key={c.id} className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px]">
            <p className="text-xs font-semibold text-fg">{c.author}</p>
            <p className="whitespace-pre-wrap text-fg">{c.body}</p>
          </div>
        ))}
        {open && (
          <CommentEditor label={`Comment on ${where}`} onCancel={() => setEditing(null)}
            onSave={async body => { await onAdd(target, body); setEditing(null) }} />
        )}
      </div>
    )
  }

  const plus = (target: Target) => canComment && (
    <button type="button" onClick={() => setEditing(target)}
      aria-label={`Comment on ${target.side === 'LEFT' ? 'old line' : 'line'} ${target.line} of ${path}`}
      className="rounded bg-accent p-0.5 text-white opacity-0 group-hover:opacity-100 focus:opacity-100">
      <MessageSquarePlus size={12} aria-hidden />
    </button>
  )
  const number = (value?: number) => <span className="w-10 shrink-0 select-none pr-2 text-right text-fg-muted">{value ?? ''}</span>
  const code = (row: Row) => (
    <code className="min-w-0 flex-1 whitespace-pre-wrap break-all">
      <span className="select-none text-fg-muted">{row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}</span>{row.text}
    </code>
  )
  const targetOf = (row: Row, side: Side): Target | null => {
    if (side === 'LEFT') return row.oldLine !== undefined && row.kind !== 'add' ? { line: row.oldLine, side: 'LEFT' } : null
    return row.newLine !== undefined && row.kind !== 'del' ? { line: row.newLine, side: 'RIGHT' } : null
  }

  if (layout === 'inline') {
    return (
      <div className="overflow-x-auto font-mono text-xs" role="table" aria-label={`Diff of ${path}`}>
        {rows.map((row, index) => {
          const target = row.kind === 'hunk' ? null : row.kind === 'del' ? targetOf(row, 'LEFT') : targetOf(row, 'RIGHT')
          return (
            <Fragment key={index}>
              <div role="row" className={cn('group flex items-start gap-1 px-1 py-px', TONE[row.kind])}>
                {row.kind === 'hunk' ? <code className="px-2">{row.text}</code> : (
                  <>
                    {number(row.oldLine)}{number(row.newLine)}
                    <span className="w-5 shrink-0">{target && plus(target)}</span>
                    {code(row)}
                  </>
                )}
              </div>
              {target && threadFor(target)}
            </Fragment>
          )
        })}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto font-mono text-xs" role="table" aria-label={`Diff of ${path}`}>
      {splitRows(rows).map((pair, index) => {
        if (pair.hunk) return <div key={index} role="row" className={cn('px-3 py-px', TONE.hunk)}><code>{pair.hunk.text}</code></div>
        const left = pair.left ? targetOf(pair.left, 'LEFT') : null
        const right = pair.right ? targetOf(pair.right, 'RIGHT') : null
        const half = (row: Row | undefined, target: Target | null, line?: number) => (
          <div className={cn('group flex min-w-0 flex-1 items-start gap-1 px-1 py-px', row ? TONE[row.kind] : 'bg-surface-2/60')}>
            {row && <>{number(line)}<span className="w-5 shrink-0">{target && plus(target)}</span>{code(row)}</>}
          </div>
        )
        return (
          <Fragment key={index}>
            <div role="row" className="flex divide-x divide-line">
              {half(pair.left, left, pair.left?.oldLine)}
              {half(pair.right, right, pair.right?.newLine)}
            </div>
            {left && threadFor(left)}
            {right && threadFor(right)}
          </Fragment>
        )
      })}
    </div>
  )
}
