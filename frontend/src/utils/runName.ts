import type { TestRun } from '@/types/domain'

/** Human-friendly run label: the user-given name, else "Run #103" / "Report #12". */
export function runDisplayName(run: Pick<TestRun, 'id'> & { name?: string | null }): string {
  if (run.name?.trim()) return run.name.trim()
  const manual = /^manual-(\d+)$/.exec(run.id)
  if (manual) return `Run #${manual[1]}`
  const report = /^allure-(\d+)$/.exec(run.id)
  if (report) return `Report #${report[1]}`
  return run.id.length > 12 ? run.id.slice(0, 8) : run.id
}
