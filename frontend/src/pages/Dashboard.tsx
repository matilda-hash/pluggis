import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Flame, Clock, BookOpen, Target, TrendingUp, Brain, Sparkles } from 'lucide-react'
import { decksApi, statsApi, examsApi, aiScheduleApi } from '../services/api'
import type { Deck, DashboardStats, Exam, TodayStats, ExamReadiness } from '../types'
import WeeklyChart from '../components/dashboard/WeeklyChart'
import ActivityCalendar from '../components/dashboard/ActivityCalendar'
import NewCardsChart from '../components/dashboard/NewCardsChart'
import DeckList from '../components/dashboard/DeckList'
import ExamPanel from '../components/dashboard/ExamPanel'

function formatTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m} min` : `${h}h`
}

function getDynamicTitle(today: TodayStats | undefined): string {
  if (!today) return 'Redo att lära?'

  const { cards_studied, streak, again, hard, good, easy, nearest_exam_days } = today
  const totalRated = again + hard + good + easy
  const forgetRate = totalRated > 0 ? again / totalRated : 0

  if (nearest_exam_days !== null && nearest_exam_days !== undefined) {
    if (nearest_exam_days === 0) return 'Tentamen är idag – lycka till! 🎯'
    if (nearest_exam_days <= 3) return `Tentamen om ${nearest_exam_days} dagar – kör hårt! 🔥`
    if (nearest_exam_days <= 7) return `Tentamen nämar sig – ${nearest_exam_days} dagar kvar!`
  }

  if (streak >= 14) return `${streak} dagars streak – imponerande! 🔥`
  if (streak >= 7) return `${streak} dagar i rad – fortsätt så! 💪`

  if (cards_studied === 0) return 'Redo att lära? 📚'

  if (forgetRate > 0.45) return 'Fortsätt öva – det sätter sig!'
  if (forgetRate < 0.1 && totalRated >= 10) return 'Fantastiskt! Du minns allt! ⭐'
  if (cards_studied >= 80) return 'Imponerande session idag!'
  if (cards_studied >= 30) return 'Du gör verkliga framsteg!'

  return 'Bra jobbat idag!'
}

// ─── Readiness widget ─────────────────────────────────────────────────────────

function ReadinessRing({ score, size = 52 }: { score: number; size?: number }) {
  const r = (size - 6) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - score / 100)
  const color = score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444'
  return (
    <svg width={size} height={size} className="flex-shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={5} stroke="#e5e7eb" fill="none" />
      <circle
        cx={size / 2} cy={size / 2} r={r} strokeWidth={5} stroke={color} fill="none"
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
    </svg>
  )
}

function ReadinessDashboard({ readiness, onNavigate }: { readiness: ExamReadiness[]; onNavigate: () => void }) {
  if (readiness.length === 0) return null
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          <Brain size={14} className="text-primary-500" />
          Tentaberedskap
        </h2>
        <button
          onClick={onNavigate}
          className="text-xs text-primary-600 hover:text-primary-700 font-medium"
        >
          AI-schema →
        </button>
      </div>
      <div className="space-y-3">
        {readiness.map(exam => (
          <div key={exam.exam_id} className="flex items-center gap-3">
            <ReadinessRing score={Math.round(exam.readiness_score)} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-800 truncate">{exam.exam_name}</span>
                <span className="text-sm font-bold ml-2 flex-shrink-0" style={{
                  color: exam.readiness_score >= 75 ? '#22c55e' : exam.readiness_score >= 50 ? '#f59e0b' : '#ef4444'
                }}>
                  {Math.round(exam.readiness_score)}%
                </span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {exam.days_remaining} dagar kvar · {(exam.topics ?? []).length} ämnen
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1.5">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${exam.readiness_score}%`,
                    backgroundColor: exam.readiness_score >= 75 ? '#22c55e' : exam.readiness_score >= 50 ? '#f59e0b' : '#ef4444'
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RatingBar({ label, count, total, color }: {
  label: string; count: number; total: number; color: string
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
      <span className="text-gray-600 w-20 truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-gray-500 text-xs w-8 text-right">{pct}%</span>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [decks, setDecks] = useState<Deck[]>([])
  const [exams, setExams] = useState<Exam[]>([])
  const [readiness, setReadiness] = useState<ExamReadiness[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(() => {
    // Readiness is best-effort — silently ignore if AI profile not set up yet
    aiScheduleApi.getReadiness().then(setReadiness).catch(() => {})
    return Promise.all([statsApi.dashboard(), decksApi.list(), examsApi.list()])
      .then(([s, d, e]) => {
        setStats(s)
        setDecks(d)
        setExams(e)
      })
  }, [])

  useEffect(() => {
    loadData().finally(() => setLoading(false))
  }, [loadData])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-sm">Laddar översikt...</div>
      </div>
    )
  }

  const today = stats?.today
  const totalRated = (today?.again ?? 0) + (today?.hard ?? 0) + (today?.good ?? 0) + (today?.easy ?? 0)
  const studiedToday = today?.cards_studied ?? 0
  const smartGoal = today?.smart_daily_goal ?? today?.daily_goal ?? 80
  const estTime = today?.est_time_goal_minutes ?? 0
  const goalPct = Math.min(100, Math.round((studiedToday / smartGoal) * 100))

  const avgNewCards = (() => {
    if (!stats) return 0
    const nonZero = stats.new_cards_history.filter(d => d.count > 0)
    if (nonZero.length === 0) return 0
    return Math.round(nonZero.reduce((s, d) => s + d.count, 0) / nonZero.length)
  })()

  const title = getDynamicTitle(today)

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {today?.total_due ?? 0} kort att öva idag
            {today?.nearest_exam_name && (
              <span className="ml-2 text-amber-500 font-medium">
                · {today.nearest_exam_name}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => navigate('/study')}
          className="btn-primary flex items-center gap-2"
        >
          <BookOpen size={16} />
          Studera nu
        </button>
      </div>

      {/* AI onboarding nudge — only if no AI profile yet */}
      {readiness.length === 0 && decks.length > 0 && (
        <div className="flex items-center justify-between bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0">
              <Sparkles size={16} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-indigo-900">Prova AI-schemat</p>
              <p className="text-xs text-indigo-600 mt-0.5">Låt AI skapa ett personligt studieSchema baserat på dina tentor</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/ai-onboarding')}
            className="flex-shrink-0 ml-4 px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Kom igång →
          </button>
        </div>
      )}

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Left column ── */}
        <div className="space-y-6">

          {/* Study stats card */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-gray-700">Denna vecka</span>
              {/* Streak badge */}
              <div className="flex items-center gap-1 text-orange-500 font-semibold text-sm">
                <Flame size={15} />
                <span>{today?.streak ?? 0} dagars streak</span>
              </div>
            </div>

            {/* Weekly bar chart */}
            <WeeklyChart data={stats?.weekly ?? []} dailyGoal={smartGoal} />

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-gray-50">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 text-gray-400 text-xs mb-1">
                  <Clock size={12} /> Tid
                </div>
                <div className="font-bold text-gray-800 text-sm leading-tight">
                  {formatTime(today?.time_studied_minutes ?? 0)}
                  {estTime > 0 && (
                    <span className="block text-xs font-normal text-gray-400">
                      / ~{formatTime(estTime)}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 text-gray-400 text-xs mb-1">
                  <BookOpen size={12} /> Kort
                </div>
                <div className="font-bold text-gray-800">{studiedToday}</div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 text-gray-400 text-xs mb-1">
                  <Target size={12} /> Mål
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary-500 rounded-full transition-all"
                        style={{ width: `${goalPct}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-gray-700">{goalPct}%</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 text-center">
                    {studiedToday}/{smartGoal}
                    {smartGoal !== (today?.daily_goal ?? smartGoal) && (
                      <span className="ml-1 text-amber-500" title="AI-justerat mål">✦</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Rating breakdown */}
            {totalRated > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-50 space-y-2">
                <RatingBar label="Glömde" count={today?.again ?? 0} total={totalRated} color="bg-red-300" />
                <RatingBar label="Svårt" count={today?.hard ?? 0} total={totalRated} color="bg-amber-300" />
                <RatingBar label="Kom ihåg" count={today?.good ?? 0} total={totalRated} color="bg-green-300" />
                <RatingBar label="Lätt" count={today?.easy ?? 0} total={totalRated} color="bg-emerald-400" />
                {(today?.skipped ?? 0) > 0 && today && (
                  <RatingBar label="Hoppade" count={today.skipped} total={totalRated + today.skipped} color="bg-gray-200" />
                )}
              </div>
            )}
          </div>

          {/* Active decks */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Aktiva kortlekar</h2>
              <button
                onClick={() => navigate('/upload')}
                className="text-xs text-primary-600 hover:text-primary-700 font-medium"
              >
                + Ladda upp PDF
              </button>
            </div>
            <DeckList decks={decks} />
          </div>
        </div>

        {/* ── Right column ── */}
        <div className="space-y-6">

          {/* Exam panel */}
          <ExamPanel exams={exams} decks={decks} onExamsChange={loadData} />

          {/* AI Readiness */}
          {readiness.length > 0 && (
            <ReadinessDashboard readiness={readiness} onNavigate={() => navigate('/ai-schedule')} />
          )}

          {/* Learning history calendar */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Studiehistorik</h2>
            <ActivityCalendar
              data={stats?.history ?? []}
              streakDays={today?.streak ?? 0}
            />
          </div>

          {/* New cards added chart */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-gray-700">Nya kort tillagda</h2>
              <TrendingUp size={14} className="text-gray-400" />
            </div>
            <NewCardsChart data={stats?.new_cards_history ?? []} average={avgNewCards} />
          </div>

          {/* Quick stats grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="card p-4">
              <div className="text-2xl font-bold text-gray-800">
                {decks.reduce((s, d) => s + (d.stats?.total_cards ?? 0), 0)}
              </div>
              <div className="text-xs text-gray-500 mt-1">Totalt antal kort</div>
            </div>
            <div className="card p-4">
              <div className="text-2xl font-bold text-green-600">
                {decks.filter(d => d.stats?.status === 'mastered').length}
              </div>
              <div className="text-xs text-gray-500 mt-1">Bemästrade kortlekar</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
