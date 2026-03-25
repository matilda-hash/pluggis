import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RefreshCw, ChevronDown, ChevronUp, Check,
  AlertTriangle, Info, Zap, Clock, BookOpen, Brain, ListTodo, Send,
} from 'lucide-react'
import { aiScheduleApi } from '../services/api'
import type { AISchedule, AIStudyBlock, ProactiveAlert, MockExam, WeeklyCheckin } from '../types'

// ─── Colour scheme per block_type ────────────────────────────────────────────

const BLOCK_COLORS: Record<string, string> = {
  active_recall:   'border-l-violet-500 bg-violet-50',
  daily_repetition:'border-l-blue-500   bg-blue-50',
  timed_drill:     'border-l-orange-500 bg-orange-50',
  case_study:      'border-l-teal-500   bg-teal-50',
  mistake_review:  'border-l-red-400    bg-red-50',
  practice_test:   'border-l-amber-500  bg-amber-50',
  active_recall_2: 'border-l-purple-500 bg-purple-50',
  resource:        'border-l-gray-400   bg-gray-50',
  pre_lecture:     'border-l-indigo-500 bg-indigo-50',
  post_lecture:    'border-l-cyan-500   bg-cyan-50',
  reading:         'border-l-sky-400    bg-sky-50',
  activation:      'border-l-lime-500   bg-lime-50',
  lunch:           'border-l-green-300  bg-green-50',
  break:           'border-l-gray-300   bg-gray-50',
  gym:             'border-l-rose-400   bg-rose-50',
}

const BLOCK_LABEL: Record<string, string> = {
  active_recall:    'Aktiv återkallning',
  daily_repetition: 'FSRS-repetition',
  timed_drill:      'Tidsbegränsad drill',
  case_study:       'Fallstudie',
  mistake_review:   'Felgenomgång',
  practice_test:    'Övningsprov',
  resource:         'Resurs',
  pre_lecture:      'Före föreläsning',
  post_lecture:     'Efter föreläsning',
  reading:          'Läsning',
  activation:       'Aktivering',
  lunch:            'Lunch',
  break:            'Paus',
  gym:              'Träning',
}

const TECHNIQUE_ICON: Record<string, string> = {
  active_recall:    '🧠',
  spaced_repetition:'🔁',
  timed_drill:      '⏱',
  case_based:       '🏥',
  mistake_review:   '❌',
  practice_test:    '📝',
}

function difficultyColor(d: number) {
  if (d <= 2) return 'text-green-600'
  if (d <= 3) return 'text-amber-600'
  return 'text-red-600'
}

// ─── Alert banner ─────────────────────────────────────────────────────────────

function AlertBanner({ alert }: { alert: ProactiveAlert }) {
  const severityStyle: Record<string, string> = {
    low:      'bg-blue-50  border-blue-200  text-blue-800',
    medium:   'bg-amber-50 border-amber-200 text-amber-800',
    high:     'bg-red-50   border-red-200   text-red-800',
    critical: 'bg-red-100  border-red-400   text-red-900 font-semibold',
  }
  const Icon = alert.severity === 'low' || alert.severity === 'medium' ? Info : AlertTriangle
  return (
    <div className={`flex items-start gap-2 px-4 py-3 rounded-lg border text-sm ${severityStyle[alert.severity]}`}>
      <Icon size={15} className="flex-shrink-0 mt-0.5" />
      <div>
        <span className="font-medium">{alert.title}</span>
        {' – '}
        {alert.message}
        {alert.action && <span className="ml-1 underline cursor-pointer">{alert.action}</span>}
      </div>
    </div>
  )
}

// ─── Block card ───────────────────────────────────────────────────────────────

function TimeGap({ label, time }: { label: string; time?: string }) {
  return (
    <div className="flex items-center gap-3 py-1 px-4 text-xs text-gray-400">
      <div className="flex-1 h-px bg-gray-100" />
      <span>{label}{time ? ` · ${time}` : ''}</span>
      <div className="flex-1 h-px bg-gray-100" />
    </div>
  )
}

function BlockCard({ block, isActive, onComplete }: {
  block: AIStudyBlock
  isActive: boolean
  onComplete: (id: number, pct: number, difficulty: number, notes: string) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [pct, setPct] = useState(100)
  const [diff, setDiff] = useState(3)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const color = BLOCK_COLORS[block.block_type] ?? 'border-l-gray-400 bg-gray-50'
  const isNonStudy = ['lunch', 'break', 'gym'].includes(block.block_type)

  const handleComplete = async () => {
    setSaving(true)
    await onComplete(block.id, pct, diff, notes)
    setSaving(false)
    setCompleting(false)
  }

  return (
    <div
      className={`card border-l-4 p-0 overflow-hidden transition-all ${color} ${block.completed ? 'opacity-60' : ''}`}
    >
      {/* Header row */}
      <div className="flex items-start gap-3 p-4">
        {/* Time column */}
        <div className="flex-shrink-0 text-right w-14">
          <div className="text-xs font-semibold text-gray-700">{block.start_time}</div>
          <div className="text-xs text-gray-400">{block.end_time}</div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              {BLOCK_LABEL[block.block_type] ?? block.block_type}
            </span>
            {block.is_spaced_repetition && (
              <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">FSRS</span>
            )}
            <span className={`text-xs font-medium ${difficultyColor(block.difficulty)}`}>
              {'●'.repeat(block.difficulty)}{'○'.repeat(5 - block.difficulty)}
            </span>
          </div>
          <div className="font-semibold text-gray-900 text-sm mt-0.5 leading-tight">
            {block.activity_title}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {block.subject}{block.subtopic && ` · ${block.subtopic}`} · {block.duration_minutes} min
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!isNonStudy && !block.completed && isActive && (
            <>
              {/* Quick-complete: instant 100% done */}
              <button
                onClick={async () => {
                  setSaving(true)
                  await onComplete(block.id, 100, 3, '')
                  setSaving(false)
                }}
                disabled={saving}
                className="flex items-center gap-1.5 bg-green-500 hover:bg-green-600 active:bg-green-700 text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors shadow-sm"
                title="Markera som klar"
              >
                {saving ? (
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Check size={15} strokeWidth={2.5} />
                )}
                Klar
              </button>
              {/* Detailed completion form toggle */}
              <button
                onClick={() => setCompleting(v => !v)}
                className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title="Rapportera detaljer"
              >
                <ChevronDown size={14} className={completing ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
            </>
          )}
          {!isNonStudy && !block.completed && !isActive && (
            <span className="text-xs text-gray-300 px-2">kommande</span>
          )}
          {block.completed && (
            <span className="text-sm text-green-600 font-semibold flex items-center gap-1 px-1">
              <Check size={14} strokeWidth={2.5} /> Klar
            </span>
          )}
          {(isNonStudy || block.completed) && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="p-2 text-gray-400 hover:text-gray-700 transition-colors"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* Expanded description */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 space-y-3 border-t border-white/60">
          {block.activity_description && (
            <p className="text-sm text-gray-700 leading-relaxed">{block.activity_description}</p>
          )}
          {block.learning_objective && (
            <div className="text-xs text-gray-500">
              <span className="font-medium">Mål:</span> {block.learning_objective}
            </div>
          )}
          {(block.resources?.length ?? 0) > 0 && (
            <div className="text-xs text-gray-500">
              <span className="font-medium">Resurser:</span>{' '}
              {block.resources.join(' · ')}
            </div>
          )}
          {block.study_technique && TECHNIQUE_ICON[block.study_technique] && (
            <div className="text-xs text-gray-400 flex items-center gap-1">
              <span>{TECHNIQUE_ICON[block.study_technique]}</span>
              <span>{block.study_technique.replace(/_/g, ' ')}</span>
            </div>
          )}
        </div>
      )}

      {/* Completion form */}
      {completing && !block.completed && (
        <div className="px-4 pb-4 border-t border-white/60 space-y-3 pt-3">
          <div>
            <label className="text-xs text-gray-600 font-medium">Slutfört: {pct}%</label>
            <input
              type="range" min={0} max={100} step={5} value={pct}
              onChange={e => setPct(Number(e.target.value))}
              className="w-full mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-gray-600 font-medium">Svårighetsgrad (1–5)</label>
            <div className="flex gap-2 mt-1">
              {[1,2,3,4,5].map(n => (
                <button
                  key={n}
                  onClick={() => setDiff(n)}
                  className={`w-8 h-8 rounded-full text-sm font-medium transition-colors ${
                    diff === n
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <textarea
            className="w-full text-xs border border-gray-200 rounded p-2 resize-none focus:ring-2 focus:ring-primary-300 outline-none"
            rows={2}
            placeholder="Valfri notering..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={handleComplete}
              disabled={saving}
              className="btn-primary text-xs px-3 py-1.5"
            >
              {saving ? 'Sparar...' : 'Spara'}
            </button>
            <button
              onClick={() => setCompleting(false)}
              className="btn-secondary text-xs px-3 py-1.5"
            >
              Avbryt
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Mock exams panel ─────────────────────────────────────────────────────────

function MockExamsPanel({ onNavigate }: { onNavigate: (id: number) => void }) {
  const [exams, setExams] = useState<MockExam[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    aiScheduleApi.listMockExams().then(setExams).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const e = await aiScheduleApi.generateMockExam({ duration_minutes: 60, n_questions: 15 })
      setExams(prev => [e, ...prev])
      onNavigate(e.id)
    } finally {
      setGenerating(false)
    }
  }

  const scoreColor = (score: number | null) => {
    if (score === null) return 'text-gray-400'
    if (score >= 75) return 'text-green-600'
    if (score >= 50) return 'text-amber-600'
    return 'text-red-600'
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Övningstentor</h3>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
        >
          {generating ? (
            <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> Genererar...</>
          ) : (
            <>+ Ny tenta</>
          )}
        </button>
      </div>
      {loading ? (
        <div className="text-xs text-gray-400 py-2">Laddar...</div>
      ) : exams.length === 0 ? (
        <div className="text-xs text-gray-400 py-2">
          Inga övningstentor ännu. Generera en baserad på dina svagaste ämnen!
        </div>
      ) : (
        <div className="space-y-1.5">
          {exams.slice(0, 5).map(e => (
            <button
              key={e.id}
              onClick={() => onNavigate(e.id)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 text-left transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate group-hover:text-primary-700">{e.title}</div>
                <div className="text-xs text-gray-400">
                  {new Date(e.submitted_at ?? e.created_at).toLocaleDateString('sv-SE')}
                  {' · '}{e.questions?.length ?? 0} frågor
                  {e.time_taken_minutes && ` · ${e.time_taken_minutes} min`}
                </div>
              </div>
              {e.score_percent !== null ? (
                <span className={`text-sm font-bold flex-shrink-0 ${scoreColor(e.score_percent)}`}>
                  {Math.round(e.score_percent)}%
                </span>
              ) : (
                <span className="text-xs text-primary-600 font-medium flex-shrink-0">Starta →</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Weekly check-in panel ────────────────────────────────────────────────────

function WeeklyCheckinPanel() {
  const [checkin, setCheckin] = useState<WeeklyCheckin | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [satisfaction, setSatisfaction] = useState<number | null>(null)
  const [challenge, setChallenge] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const loadCheckin = async () => {
    setLoading(true)
    try {
      const c = await aiScheduleApi.getCheckin()
      setCheckin(c)
      setSatisfaction(c.overall_satisfaction)
      setChallenge(c.biggest_challenge ?? '')
      setExpanded(true)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await aiScheduleApi.saveCheckin({
        overall_satisfaction: satisfaction ?? undefined,
        biggest_challenge: challenge || undefined,
      })
      setCheckin(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Veckouppsummering</h3>
        {!expanded && (
          <button
            onClick={loadCheckin}
            disabled={loading}
            className="text-xs text-primary-600 hover:text-primary-700 font-medium"
          >
            {loading ? 'Laddar...' : 'Ladda AI-analys'}
          </button>
        )}
      </div>

      {checkin && expanded && (
        <div className="mt-3 space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-lg font-bold text-gray-800">{checkin.actual_study_hours.toFixed(1)}h</div>
              <div className="text-xs text-gray-400">Studerade</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-lg font-bold text-green-600">{checkin.sessions_completed}</div>
              <div className="text-xs text-gray-400">Genomförda</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-lg font-bold text-red-400">{checkin.sessions_skipped}</div>
              <div className="text-xs text-gray-400">Hoppade</div>
            </div>
          </div>

          {/* AI assessment */}
          {checkin.ai_assessment && typeof checkin.ai_assessment === 'object' && (checkin.ai_assessment as Record<string, string>).summary && (
            <div className="bg-primary-50 border border-primary-100 rounded-lg p-3 text-xs text-primary-800 leading-relaxed">
              <span className="font-semibold block mb-1">AI-analys</span>
              {(checkin.ai_assessment as Record<string, string>).summary}
            </div>
          )}

          {/* Satisfaction */}
          <div>
            <div className="text-xs font-medium text-gray-600 mb-1.5">Hur nöjd är du med veckans studier?</div>
            <div className="flex gap-2">
              {[1,2,3,4,5].map(n => (
                <button
                  key={n}
                  onClick={() => setSatisfaction(n)}
                  className={`flex-1 text-lg py-1 rounded-lg transition-colors ${
                    satisfaction === n ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 hover:bg-gray-200'
                  }`}
                >
                  {['😞','😐','🙂','😊','🤩'][n-1]}
                </button>
              ))}
            </div>
          </div>

          {/* Challenge */}
          <div>
            <div className="text-xs font-medium text-gray-600 mb-1.5">Vad var svårast den här veckan?</div>
            <input
              className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-primary-300 outline-none"
              placeholder="T.ex. 'Biokemi-enzymer', 'Att hålla fokus'..."
              value={challenge}
              onChange={e => setChallenge(e.target.value)}
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary text-sm w-full py-2"
          >
            {saved ? '✓ Sparat!' : saving ? 'Sparar...' : 'Spara veckoreflektion'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AISchedulePage() {
  const navigate = useNavigate()
  const [schedule, setSchedule] = useState<AISchedule | null>(null)
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [feedbackError, setFeedbackError] = useState('')
  const feedbackRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async (regen = false) => {
    setLoading(true)
    try {
      const s = await aiScheduleApi.getToday(regen)
      setSchedule(s)
    } catch (err: unknown) {
      // If 404/422 (no profile), redirect to onboarding
      const status = (err as { response?: { status?: number } }).response?.status
      if (status === 404 || status === 422) {
        navigate('/ai-onboarding')
      }
    } finally {
      setLoading(false)
    }
  }, [navigate])

  useEffect(() => { load() }, [load])

  const handleRegenerate = async () => {
    setRegenerating(true)
    await load(true)
    setRegenerating(false)
  }

  const handleFeedback = async () => {
    if (!feedback.trim()) return
    setSubmitting(true)
    setFeedbackError('')
    try {
      const s = await aiScheduleApi.submitFeedback(feedback)
      setSchedule(s)
      setFeedback('')
    } catch {
      setFeedbackError('Något gick fel. Försök igen.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleFeedbackKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleFeedback()
    }
  }

  const handleComplete = async (
    blockId: number,
    pct: number,
    diff: number,
    notes: string,
  ) => {
    const updated = await aiScheduleApi.completeBlock(blockId, {
      completion_percentage: pct,
      self_reported_difficulty: diff,
      completion_notes: notes,
    })
    setSchedule(prev => {
      if (!prev) return prev
      return {
        ...prev,
        blocks: prev.blocks.map(b => b.id === updated.id ? updated : b),
      }
    })
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-400 text-sm">
        <div className="w-6 h-6 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
        Genererar ditt personliga schema...
      </div>
    )
  }

  if (!schedule) return null

  const studyBlocks = (schedule.blocks ?? []).filter(b => !['lunch','break','gym'].includes(b.block_type))
  const doneCount = studyBlocks.filter(b => b.completed).length
  const activeBlockId = studyBlocks.find(b => !b.completed)?.id ?? null
  const totalStudyMin = studyBlocks.reduce((s, b) => s + b.duration_minutes, 0)
  const doneMin = studyBlocks.filter(b => b.completed).reduce((s, b) => s + b.duration_minutes, 0)
  const progressPct = totalStudyMin > 0 ? Math.round((doneMin / totalStudyMin) * 100) : 0
  // Detect generic fallback schedule (all blocks have same subject = generic placeholder)
  const isGeneric = studyBlocks.length > 0 && studyBlocks.every(b => b.topic === 'Generell repetition' || !b.subtopic)

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Brain size={20} className="text-primary-500" />
            Dagens schema
          </h1>
          <p className="text-sm text-gray-500">
            {new Date(schedule.schedule_date).toLocaleDateString('sv-SE', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/ai-topics')}
            className="btn-secondary text-sm flex items-center gap-1.5"
          >
            <ListTodo size={13} />
            Ämnen
          </button>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="btn-secondary text-sm flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={regenerating ? 'animate-spin' : ''} />
            Generera om
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="card p-4">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="font-medium text-gray-700">Framsteg idag</span>
          <span className="text-gray-500">{doneCount}/{studyBlocks.length} block · {doneMin}/{totalStudyMin} min</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-500 rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
          <span className="flex items-center gap-1"><Clock size={11} /> {totalStudyMin} min studietid</span>
          <span className="flex items-center gap-1"><BookOpen size={11} /> {studyBlocks.length} block</span>
          <span className="flex items-center gap-1"><Zap size={11} /> {schedule.generation_attempts} försök</span>
        </div>
      </div>

      {/* Summary */}
      {schedule.summary && (
        <div className="card p-4 text-sm text-gray-700 leading-relaxed border border-primary-100 bg-primary-50/30">
          {schedule.summary}
        </div>
      )}

      {/* Alerts */}
      {(schedule.alerts ?? []).length > 0 && (
        <div className="space-y-2">
          {(schedule.alerts ?? []).map((a, i) => <AlertBanner key={i} alert={a} />)}
        </div>
      )}

      {/* No-topics nudge */}
      {isGeneric && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800 cursor-pointer hover:bg-amber-100 transition-colors"
          onClick={() => navigate('/ai-topics')}
        >
          <ListTodo size={16} className="flex-shrink-0" />
          <div>
            <span className="font-medium">Schemat är generellt.</span>
            {' '}Lägg till dina studieämnen per tenta så blir schemat specifikt och mycket mer effektivt.
            <span className="ml-1 underline">Lägg till ämnen →</span>
          </div>
        </div>
      )}

      {/* Block timeline */}
      <div className="flex flex-col gap-2">
        {(schedule.blocks ?? []).map(block => {
          if (['lunch', 'break', 'gym'].includes(block.block_type)) {
            const gapLabel = block.block_type === 'lunch' ? 'Lunch' : block.block_type === 'gym' ? 'Gym/Träning' : 'Paus'
            const timeStr = block.start_time && block.end_time ? `${block.start_time}–${block.end_time}` : undefined
            return <TimeGap key={block.id} label={gapLabel} time={timeStr} />
          }
          const isActive = block.id === activeBlockId
          return <BlockCard key={block.id} block={block} isActive={isActive} onComplete={handleComplete} />
        })}
      </div>

      {/* Tomorrow preview */}
      {schedule.tomorrow_preview && (
        <div className="card p-4 border border-gray-100">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Imorgon</div>
          <p className="text-sm text-gray-600">{schedule.tomorrow_preview}</p>
        </div>
      )}

      {/* Feedback — always-visible chat input */}
      <div className="card p-3 border border-gray-200">
        <div className="relative">
          <textarea
            ref={feedbackRef}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 pr-12 resize-none focus:ring-2 focus:ring-primary-300 outline-none bg-gray-50 focus:bg-white transition-colors"
            rows={2}
            placeholder="Ändra schemat... t.ex. 'möte 13–14:40', 'chill dag', 'för mycket idag', 'mer pauser'"
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            onKeyDown={handleFeedbackKey}
            disabled={submitting}
          />
          <button
            onClick={handleFeedback}
            disabled={submitting || !feedback.trim()}
            className="absolute right-2 bottom-2 w-8 h-8 flex items-center justify-center rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Skicka och generera om (Enter)"
          >
            {submitting
              ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Send size={14} />
            }
          </button>
        </div>
        {feedbackError && <p className="text-xs text-red-600 mt-1 px-1">{feedbackError}</p>}
      </div>

      {/* Mock exams */}
      <MockExamsPanel onNavigate={id => navigate(`/mock-exam/${id}`)} />

      {/* Weekly check-in */}
      <WeeklyCheckinPanel />

    </div>
  )
}
