import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import type { DailyCount } from '../../types'

interface Props {
  data: DailyCount[]
  dailyGoal: number
}

const DAY_LABELS = ['Sön', 'Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör']

function formatLabel(dateStr: string, index: number, total: number): string {
  if (index === total - 1) return 'Idag'
  const d = new Date(dateStr + 'T12:00:00')
  return DAY_LABELS[d.getDay()]
}

export default function WeeklyChart({ data, dailyGoal }: Props) {
  const formatted = data.map((d, i) => ({
    ...d,
    label: formatLabel(d.date, i, data.length),
  }))

  return (
    <ResponsiveContainer width="100%" height={130}>
      <BarChart data={formatted} margin={{ top: 8, right: 0, left: -20, bottom: 0 }} barSize={22}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ fill: '#f3f4f6' }}
          contentStyle={{
            borderRadius: '8px',
            border: '1px solid #e5e7eb',
            fontSize: '12px',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
          }}
          formatter={(value: number) => [value, 'Kort']}
          labelStyle={{ fontWeight: 600 }}
        />
        <ReferenceLine
          y={dailyGoal}
          stroke="#c4b5fd"
          strokeDasharray="4 4"
          strokeWidth={1.5}
          label={{ value: 'Mål', position: 'insideTopRight', fontSize: 10, fill: '#c4b5fd' }}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {formatted.map((entry, index) => (
            <Cell
              key={entry.date}
              fill={index === formatted.length - 1 ? '#a5b4fc' : '#e0e7ff'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
