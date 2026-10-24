import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Section } from '@/ui'
import type { TrendPoint } from './api'

const AXIS = { fontSize: 11, fill: 'rgb(var(--text-muted))' }
const TOOLTIP = { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 8, fontSize: 12 }

function Chart({ title, points, dataKey, unit, color }: { title: string; points: TrendPoint[]; dataKey: keyof TrendPoint; unit: string; color: string }) {
  const data = points.map((p, index) => ({ ...p, label: `#${index + 1}` }))
  return (
    <Section title={title}>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={AXIS} />
            <YAxis tick={AXIS} unit={unit} />
            <Tooltip contentStyle={TOOLTIP} />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Section>
  )
}

export default function TrendCharts({ points, performance }: { points: TrendPoint[]; performance: boolean }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Chart title="Pass rate" points={points} dataKey="pass_rate" unit="%" color="rgb(var(--success))" />
      <Chart title="Duration" points={points} dataKey="duration_seconds" unit="s" color="rgb(var(--accent))" />
      {performance && <Chart title="p95 response time" points={points} dataKey="p95_ms" unit="ms" color="rgb(var(--warning))" />}
    </div>
  )
}
