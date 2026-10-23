import { useEffect, useState } from 'react'
import { Activity, Clock, FolderTree, GitBranch, Maximize2, PieChart as PieChartIcon, Radio, X } from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

interface RunTrendPoint {
  runLabel: string
  runShortId: string
  source?: 'local' | 'github_actions'
  passRate: number | null
  durationSeconds: number | null
}

interface DashboardRun {
  status: string
  source: 'local' | 'github_actions'
  collection: string | null
  branch: string | null
  total_tests: number
  passed_tests: number
  failed_tests: number
  skipped_tests: number
}

function sourceLabel(source?: string): string {
  if (source === 'github_actions') return 'GitHub Actions'
  if (source === 'local') return 'Local'
  return ''
}

type ChartTab = 'pass-rate' | 'duration' | 'status' | 'source' | 'collection' | 'branch'
type ChartView = 'graphic' | 'pie'

const PIE_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#ea580c', '#64748b']

function distribution(items: DashboardRun[], field: keyof Pick<DashboardRun, 'status' | 'source' | 'collection' | 'branch'>) {
  const counts = new Map<string, number>()
  for (const item of items) {
    const value = item[field] || (field === 'collection' ? 'No collection' : field === 'branch' ? 'No branch' : 'Unknown')
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts.entries()]
    .sort(([, first], [, second]) => second - first)
    .map(([name, value]) => ({ name, value }))
}

export default function DashboardCharts({ runTrendData, runs }: { runTrendData: RunTrendPoint[]; runs: DashboardRun[] }) {
  const [activeTab, setActiveTab] = useState<ChartTab>('pass-rate')
  const [chartView, setChartView] = useState<ChartView>('graphic')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const gridColor = 'rgba(148,163,184,0.15)'
  const axisColor = 'rgba(148,163,184,0.5)'

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false)
    }

    if (isFullscreen) window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isFullscreen])

  const runLabelFormatter = (v: string | number, p: readonly { payload?: RunTrendPoint }[] | undefined) => {
    const point = p?.[0]?.payload
    const src = sourceLabel(point?.source)
    return `Run ${point?.runShortId || v}${src ? ` · ${src}` : ''}`
  }

  const tabs: Array<{ id: ChartTab; label: string; icon: typeof Activity }> = [
    { id: 'pass-rate', label: 'Pass Rate', icon: Activity },
    { id: 'duration', label: 'Duration', icon: Clock },
    { id: 'status', label: 'Run Status', icon: PieChartIcon },
    { id: 'source', label: 'Source', icon: Radio },
    { id: 'collection', label: 'Collection', icon: FolderTree },
    { id: 'branch', label: 'Branch', icon: GitBranch },
  ]

  const renderChart = () => {
    if (activeTab === 'pass-rate' && chartView === 'graphic') {
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-3 flex shrink-0 items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Pass Rate Trend</h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">% per run</p>
            </div>
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-gray-400 dark:text-gray-500" />
              {!isFullscreen && (
                <button
                  type="button"
                  onClick={() => setIsFullscreen(true)}
                  className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                  title="View Pass Rate chart full screen"
                  aria-label="View Pass Rate chart full screen"
                >
                  <Maximize2 size={15} />
                </button>
              )}
            </div>
          </div>
          {runTrendData.length === 0
            ? <div className="flex flex-1 items-center justify-center text-sm text-gray-400 dark:text-gray-500">No runs</div>
            : (
              <div
                className="flex-1 min-h-0 cursor-zoom-in"
                role="button"
                tabIndex={0}
                onClick={() => setIsFullscreen(true)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') setIsFullscreen(true)
                }}
                title="Open Pass Rate chart full screen"
                aria-label="Open Pass Rate chart full screen"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={runTrendData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="runLabel" stroke={axisColor} tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} stroke={axisColor} tick={{ fontSize: 10 }} unit="%" />
                    <Tooltip
                      contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: 11, color: 'var(--text-primary)' }}
                      formatter={(v: number) => [`${v}%`, 'Pass Rate']}
                      labelFormatter={runLabelFormatter}
                    />
                    <Line type="monotone" dataKey="passRate" name="Pass Rate" stroke="#2563eb" strokeWidth={2} dot={{ r: 3, fill: '#2563eb' }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
        </div>
      )
    }

    if (activeTab === 'duration' && chartView === 'graphic') return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Execution Duration</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Seconds per run</p>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-gray-400 dark:text-gray-500" />
            {!isFullscreen && (
              <button
                type="button"
                onClick={() => setIsFullscreen(true)}
                className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                title="View Duration chart full screen"
                aria-label="View Duration chart full screen"
              >
                <Maximize2 size={15} />
              </button>
            )}
          </div>
        </div>
        {runTrendData.length === 0
          ? <div className="flex flex-1 items-center justify-center text-sm text-gray-400 dark:text-gray-500">No runs</div>
          : (
            <div
              className="flex-1 min-h-0 cursor-zoom-in"
              role="button"
              tabIndex={0}
              onClick={() => setIsFullscreen(true)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') setIsFullscreen(true)
              }}
              title="Open Duration chart full screen"
              aria-label="Open Duration chart full screen"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={runTrendData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="runLabel" stroke={axisColor} tick={{ fontSize: 10 }} />
                  <YAxis stroke={axisColor} tick={{ fontSize: 10 }} unit="s" />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: 11, color: 'var(--text-primary)' }}
                    formatter={v => {
                      const n = typeof v === 'number' ? v : Number(v)
                      return [Number.isNaN(n) ? '-' : `${n}s`, 'Duration']
                    }}
                    labelFormatter={runLabelFormatter}
                  />
                  <Line type="monotone" dataKey="durationSeconds" name="Duration" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3, fill: '#7c3aed' }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
      </div>
    )

    const distributionMeta = {
      status: { title: 'Runs by Status', subtitle: 'Current outcome of filtered runs', icon: PieChartIcon },
      source: { title: 'Runs by Source', subtitle: 'Local and GitHub Actions runs', icon: Radio },
      collection: { title: 'Runs by Collection', subtitle: 'Filtered run collections', icon: FolderTree },
      branch: { title: 'Runs by Branch', subtitle: 'Filtered run branches', icon: GitBranch },
    }
    const trendMeta = {
      'pass-rate': { title: 'Pass Rate by Run', subtitle: 'Pass rate per filtered run', icon: Activity },
      duration: { title: 'Duration by Run', subtitle: 'Execution duration per filtered run', icon: Clock },
    }
    const isTrend = activeTab === 'pass-rate' || activeTab === 'duration'
    const distributionField = activeTab as 'status' | 'source' | 'collection' | 'branch'
    const chartData = isTrend
      ? runTrendData
        .map(point => ({ name: point.runLabel, value: activeTab === 'pass-rate' ? point.passRate : point.durationSeconds }))
        .filter((point): point is { name: string; value: number } => point.value != null && point.value > 0)
      : distribution(runs, distributionField)
    const chartMeta = isTrend ? trendMeta[activeTab] : distributionMeta[distributionField]
    const chartName = activeTab === 'pass-rate' ? 'Pass Rate' : activeTab === 'duration' ? 'Duration' : 'Runs'
    const DistributionIcon = chartMeta.icon

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{chartMeta.title}</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{chartMeta.subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <DistributionIcon size={14} className="text-gray-400 dark:text-gray-500" />
            {!isFullscreen && (
              <button
                type="button"
                onClick={() => setIsFullscreen(true)}
                className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                title={`View ${chartMeta.title} chart full screen`}
                aria-label={`View ${chartMeta.title} chart full screen`}
              >
                <Maximize2 size={15} />
              </button>
            )}
          </div>
        </div>
        {chartData.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400 dark:text-gray-500">No runs</div>
        ) : (
          <div
            className="flex min-h-0 flex-1 cursor-zoom-in"
            role="button"
            tabIndex={0}
            onClick={() => setIsFullscreen(true)}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') setIsFullscreen(true)
            }}
            title={`Open ${chartMeta.title} chart full screen`}
            aria-label={`Open ${chartMeta.title} chart full screen`}
          >
            <ResponsiveContainer width="100%" height="100%">
              {chartView === 'pie' ? (
                <PieChart>
                  <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="72%" label={({ value }) => value}>
                    {chartData.map((item, index) => <Cell key={item.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: 11, color: 'var(--text-primary)' }}
                    formatter={(value: number) => [value, chartName]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 8, right: 12, left: -12, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="name" stroke={axisColor} tick={{ fontSize: 10 }} angle={-24} textAnchor="end" interval={0} />
                  <YAxis stroke={axisColor} tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: 11, color: 'var(--text-primary)' }}
                    formatter={(value: number) => [value, chartName]}
                  />
                  <Bar dataKey="value" name={chartName} fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>
    )
  }

  const chartContent = (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 gap-1 overflow-x-auto rounded-xl border border-gray-200/80 bg-gray-50 p-1 dark:border-gray-700/70 dark:bg-gray-900/40">
        {tabs.map(item => {
          const Icon = item.icon
          const isActive = activeTab === item.id

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                isActive
                  ? 'bg-white text-blue-700 shadow-sm dark:bg-gray-800 dark:text-blue-300'
                  : 'text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700/80 dark:hover:text-gray-100'
              }`}
            >
              <Icon size={13} />
              {item.label}
            </button>
          )
        })}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span className="mr-1 text-[10px] font-medium text-gray-400 dark:text-gray-500">View</span>
        <button
          type="button"
          onClick={() => setChartView('graphic')}
          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
            chartView === 'graphic'
              ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100'
          }`}
        >
          Graphic
        </button>
        <button
          type="button"
          onClick={() => setChartView('pie')}
          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
            chartView === 'pie'
              ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100'
          }`}
        >
          Pie chart
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">{renderChart()}</div>
    </div>
  )

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-[100] flex bg-white p-4 dark:bg-gray-950 sm:p-6">
        <button
          type="button"
          onClick={() => setIsFullscreen(false)}
          className="absolute right-4 top-4 z-10 rounded-md border border-gray-200 bg-white p-2 text-gray-500 shadow-sm transition hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
          title="Exit full screen"
          aria-label="Exit full screen"
        >
          <X size={18} />
        </button>
        <div className="min-h-0 w-full pr-12">{chartContent}</div>
      </div>
    )
  }

  return chartContent
}
