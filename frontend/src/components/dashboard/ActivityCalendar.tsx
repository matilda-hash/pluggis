import type { DailyCount } from '../../types'

interface Props {
  data: DailyCount[]
  streakDays: number
  bestStreak?: number
}

function colorForCount(count: number): string {
  if (count === 0) return '#ebedf0'
  if (count < 10) return '#9be9a8'
  if (count < 30) return '#40c463'
  if (count < 60) return '#30a14e'
  return '#216e39'
}

export default function ActivityCalendar({ data, streakDays, bestStreak }: Props) {
  // Group days into weeks (columns of 7)
  const weeks: DailyCount[][] = []
  let week: DailyCount[] = []

  // Pad the start so Monday is always column 0
  const firstDate = data[0] ? new Date(data[0].date + 'T12:00:00') : new Date()
  const startPad = (firstDate.getDay() + 6) % 7 // Mon=0

  for (let i = 0; i < startPad; i++) {
    week.push({ date: '', count: -1 }) // filler
  }

  data.forEach(d => {
    week.push(d)
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
  })
  if (week.length > 0) weeks.push(week)

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  return (
    <div>
      {/* Streak badges */}
      <div className="flex gap-4 mb-3 text-sm">
        <div>
          <span className="text-gray-500">Total streaks</span>{' '}
          <span className="font-semibold text-gray-800">{streakDays} days</span>
        </div>
        {bestStreak !== undefined && (
          <div>
            <span className="text-gray-500">Best streak</span>{' '}
            <span className="font-semibold text-gray-800">{bestStreak} days</span>
          </div>
        )}
      </div>

      {/* Calendar grid */}
      <div className="overflow-x-auto">
        <div className="flex gap-0.5">
          {weeks.map((wk, wi) => (
            <div key={wi} className="flex flex-col gap-0.5">
              {wk.map((day, di) => (
                <div
                  key={di}
                  title={day.date ? `${day.date}: ${day.count} cards` : undefined}
                  className="w-3 h-3 rounded-sm"
                  style={{
                    backgroundColor: day.count < 0 ? 'transparent' : colorForCount(day.count),
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
        <span>Less</span>
        {[0, 5, 15, 35, 65].map(n => (
          <div
            key={n}
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: colorForCount(n) }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}
