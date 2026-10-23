import { useMemo } from 'react'

interface DiffViewerProps {
  patch: string
}

type Row = {
  kind: 'hunk' | 'add' | 'del' | 'ctx' | 'meta'
  text: string
  oldNo: number | null
  newNo: number | null
}

/**
 * Renders a git unified-diff patch with GitHub-style line numbers and colours.
 * Only the hunk bodies are shown (the leading `diff --git`/`index`/`+++`/`---`
 * headers are collapsed into a single meta row) so it reads like the PR
 * "Changes" tab.
 */
export default function DiffViewer({ patch }: DiffViewerProps) {
  const rows = useMemo<Row[]>(() => parsePatch(patch), [patch])

  if (rows.length === 0) {
    return (
      <div className="p-4 text-xs text-gray-400 dark:text-gray-500 italic">
        No textual changes to display.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto font-mono text-[11.5px] leading-[1.55]">
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((row, i) => {
            if (row.kind === 'meta') {
              return (
                <tr key={i}>
                  <td colSpan={3} className="bg-gray-100 dark:bg-gray-700/40 px-3 py-1 text-[10px] text-gray-500 dark:text-gray-400 select-none">
                    {row.text}
                  </td>
                </tr>
              )
            }
            if (row.kind === 'hunk') {
              return (
                <tr key={i}>
                  <td colSpan={3} className="bg-indigo-50 dark:bg-indigo-500/10 px-3 py-0.5 text-indigo-500 dark:text-indigo-300 select-none">
                    {row.text}
                  </td>
                </tr>
              )
            }
            const bg =
              row.kind === 'add'
                ? 'bg-emerald-50 dark:bg-emerald-500/10'
                : row.kind === 'del'
                  ? 'bg-red-50 dark:bg-red-500/10'
                  : ''
            const sign = row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '
            const textColor =
              row.kind === 'add'
                ? 'text-emerald-700 dark:text-emerald-300'
                : row.kind === 'del'
                  ? 'text-red-700 dark:text-red-300'
                  : 'text-gray-600 dark:text-gray-300'
            return (
              <tr key={i} className={bg}>
                <td className="w-10 select-none border-r border-gray-200 dark:border-gray-700 px-2 text-right text-[10px] text-gray-400 dark:text-gray-500">
                  {row.oldNo ?? ''}
                </td>
                <td className="w-10 select-none border-r border-gray-200 dark:border-gray-700 px-2 text-right text-[10px] text-gray-400 dark:text-gray-500">
                  {row.newNo ?? ''}
                </td>
                <td className={`whitespace-pre px-3 ${textColor}`}>
                  <span className="select-none opacity-60">{sign} </span>
                  {row.text}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

function parsePatch(patch: string): Row[] {
  const rows: Row[] = []
  let oldNo = 0
  let newNo = 0
  let inHunk = false

  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      const m = HUNK_RE.exec(line)
      if (m) {
        oldNo = parseInt(m[1], 10)
        newNo = parseInt(m[2], 10)
        inHunk = true
        rows.push({ kind: 'hunk', text: line, oldNo: null, newNo: null })
      }
      continue
    }
    if (!inHunk) {
      // Collapse the file header lines into compact meta rows.
      if (
        line.startsWith('diff --git') ||
        line.startsWith('new file') ||
        line.startsWith('deleted file') ||
        line.startsWith('rename ') ||
        line.startsWith('similarity ') ||
        line.startsWith('copy ')
      ) {
        rows.push({ kind: 'meta', text: line, oldNo: null, newNo: null })
      }
      continue
    }
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ')) {
      continue
    }
    if (line.startsWith('+')) {
      rows.push({ kind: 'add', text: line.slice(1), oldNo: null, newNo: newNo++ })
    } else if (line.startsWith('-')) {
      rows.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++, newNo: null })
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file"
      rows.push({ kind: 'meta', text: line, oldNo: null, newNo: null })
    } else {
      rows.push({ kind: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
    }
  }
  return rows
}
