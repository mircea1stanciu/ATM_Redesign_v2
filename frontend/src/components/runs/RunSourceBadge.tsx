import { Github, Terminal } from 'lucide-react'
import type { TestRun } from '@/types/domain'

export function RunSourceBadge({ source }: { source: TestRun['source'] }) {
  if (source === 'github_actions') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-purple-100 dark:bg-purple-900/30 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:text-purple-300">
        <Github size={10} /> GitHub Action
      </span>
    )
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
      <Terminal size={10} /> Local
    </span>
  )
}
