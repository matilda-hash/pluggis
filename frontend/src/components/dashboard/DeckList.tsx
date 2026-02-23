import { useNavigate } from 'react-router-dom'
import { BookOpen, CheckCircle2, Circle, AlertCircle, Star } from 'lucide-react'
import type { Deck } from '../../types'

interface Props {
  decks: Deck[]
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'mastered')
    return <CheckCircle2 size={14} className="text-green-500" />
  if (status === 'maintaining')
    return <AlertCircle size={14} className="text-amber-400" />
  return <Circle size={14} className="text-gray-300" />
}

/** Compute gradient color based on recent_forget_rate + mastery_rate */
function getGradientColor(forgetRate: number, masteryRate: number): { bar: string; bg: string } {
  // Prioritize forget rate: high forget → red, medium → amber, low + mastered → green
  if (forgetRate > 0.35) {
    return { bar: 'linear-gradient(90deg, #fca5a5, #ef4444)', bg: '#fef2f2' }
  }
  if (forgetRate > 0.15 || masteryRate < 0.35) {
    return { bar: 'linear-gradient(90deg, #fcd34d, #f59e0b)', bg: '#fffbeb' }
  }
  if (masteryRate >= 0.7 || forgetRate <= 0.05) {
    return { bar: 'linear-gradient(90deg, #6ee7b7, #10b981)', bg: '#f0fdf4' }
  }
  // Default: making progress (blue/indigo)
  return { bar: 'linear-gradient(90deg, #a5b4fc, #6366f1)', bg: '#eef2ff' }
}

function ProgressBar({ rate, forgetRate, masteryRate }: {
  rate: number; forgetRate: number; masteryRate: number
}) {
  const { bar } = getGradientColor(forgetRate, masteryRate)
  return (
    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${Math.max(2, rate * 100)}%`,
          background: bar,
        }}
      />
    </div>
  )
}

const STATUS_LABELS: Record<string, string> = {
  mastered: 'Bemästrad',
  maintaining: 'Underhåller',
  in_progress: 'Pågår',
  new: 'Ny',
}

export default function DeckList({ decks }: Props) {
  const navigate = useNavigate()

  if (decks.length === 0) {
    return (
      <div className="card p-8 text-center">
        <BookOpen size={32} className="mx-auto text-gray-300 mb-3" />
        <p className="text-gray-500 text-sm">Inga kortlekar än. Ladda upp en PDF för att komma igång.</p>
      </div>
    )
  }

  return (
    <div className="card divide-y divide-gray-50">
      {decks.map(deck => {
        const stats = deck.stats
        const status = stats?.status ?? 'new'
        const due = stats?.due_today ?? 0
        const masteryRate = stats?.mastery_rate ?? 0
        const forgetRate = stats?.recent_forget_rate ?? 0
        const examPriority = stats?.exam_priority ?? 0

        return (
          <div key={deck.id} className="px-5 py-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <StatusIcon status={status} />
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-gray-800 text-sm">{deck.name}</span>
                    {examPriority > 0 && (
                      <span title="Relevant för kommande tentamen">
                        <Star size={12} className="text-amber-400 fill-amber-400" />
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                    {due > 0 ? (
                      <span className="text-primary-600 font-medium">{due} att öva</span>
                    ) : (
                      <span>Inga kort att öva</span>
                    )}
                    {status === 'mastered' && (
                      <span className="text-green-600 font-medium">{STATUS_LABELS.mastered}!</span>
                    )}
                    {status === 'maintaining' && (
                      <span className="text-amber-500 font-medium">{STATUS_LABELS.maintaining}</span>
                    )}
                    {forgetRate > 0.35 && (
                      <span className="text-red-400 font-medium">Glömmer {Math.round(forgetRate * 100)}%</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {stats?.total_cards !== undefined && (
                  <span className="text-xs text-gray-400">{stats.total_cards} kort</span>
                )}
                <button
                  onClick={() => navigate(`/study/${deck.id}`)}
                  className="text-xs bg-gray-100 hover:bg-primary-50 hover:text-primary-700 text-gray-600 px-3 py-1.5 rounded-lg font-medium transition-colors"
                >
                  Öva
                </button>
              </div>
            </div>

            <ProgressBar rate={masteryRate} forgetRate={forgetRate} masteryRate={masteryRate} />
          </div>
        )
      })}
    </div>
  )
}
