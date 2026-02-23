import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import type { DailyCount } from '../../types'

interface Props {
  data: DailyCount[]
  average: number
}

export default function NewCardsChart({ data, average }: Props) {
  // Show only last 28 days for readability
  const visible = data.slice(-28)
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">
        Average <span className="font-semibold text-gray-700">{average} cards</span>
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <BarChart data={visible} margin={{ top: 4, right: 0, left: -30, bottom: 0 }} barSize={8}>
          <XAxis hide />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: '#f3f4f6' }}
            contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '11px' }}
            formatter={(v: number) => [v, 'New cards']}
            labelFormatter={(label: string) => label}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {visible.map(entry => (
              <Cell
                key={entry.date}
                fill={entry.date === today ? '#4f46e5' : '#93c5fd'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
