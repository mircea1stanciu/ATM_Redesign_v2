import type { LucideIcon } from 'lucide-react'

const PALETTE: Record<string, { icon: string; bg: string; ring: string; bar: string }> = {
  cyan:    { icon: 'text-cyan-600 dark:text-cyan-400',    bg: 'bg-cyan-100 dark:bg-cyan-500/20',    ring: 'group-hover:ring-cyan-400/30',    bar: 'from-cyan-500 to-sky-500' },
  emerald: { icon: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-500/20', ring: 'group-hover:ring-emerald-400/30', bar: 'from-emerald-500 to-teal-500' },
  rose:    { icon: 'text-rose-600 dark:text-rose-400',    bg: 'bg-rose-100 dark:bg-rose-500/20',    ring: 'group-hover:ring-rose-400/30',    bar: 'from-rose-500 to-pink-500' },
  amber:   { icon: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-100 dark:bg-amber-500/20',  ring: 'group-hover:ring-amber-400/30',   bar: 'from-amber-500 to-orange-500' },
  indigo:  { icon: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-100 dark:bg-indigo-500/20', ring: 'group-hover:ring-indigo-400/30',  bar: 'from-indigo-500 to-violet-500' },
  blue:    { icon: 'text-blue-600 dark:text-blue-400',    bg: 'bg-blue-100 dark:bg-blue-500/20',    ring: 'group-hover:ring-blue-400/30',    bar: 'from-blue-500 to-indigo-500' },
}

export function StatCard({
  title, value, icon: Icon, accent, sub,
}: {
  title: string
  value: string | number
  icon: LucideIcon
  accent: string
  sub?: string
}) {
  const palette = PALETTE[accent] ?? PALETTE.blue
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft ring-1 ring-transparent transition-all duration-300 hover:-translate-y-0.5 hover:shadow-soft-lg p-4 md:p-5">
      {/* accent bar */}
      <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${palette.bar} opacity-80`} />
      <div className="flex items-center justify-between mb-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${palette.bg} ${palette.icon} ring-4 ring-transparent transition-all duration-300 ${palette.ring}`}>
          <Icon size={18} />
        </div>
        <span className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white tabular-nums">{value}</span>
      </div>
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</p>
      {sub && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}
