import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Clock, ChevronLeft, ChevronRight, Check, AlertCircle } from 'lucide-react'
import { aiScheduleApi } from '../services/api'
import type { MockExam, MockQuestion } from '../types'

// ─── Timer ────────────────────────────────────────────────────────────────────

function useTimer(totalSeconds: number, running: boolean) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setElapsed(e => Math.min(e + 1, totalSeconds)), 1000)
    return () => clearInterval(id)
  }, [running, totalSeconds])
  const remaining = totalSeconds - elapsed
  const mm = Math.floor(remaining / 60).toString().padStart(2, '0')
  const ss = (remaining % 60).toString().padStart(2, '0')
  return { elapsed, remaining, display: `${mm}:${ss}` }
}

// ─── Question view ────────────────────────────────────────────────────────────

function QuestionView({
  q,
  index,
  total,
  answer,
  onChange,
}: {
  q: MockQuestion
  index: number
  total: number
  answer: string
  onChange: (v: string) => void
}) {
  const diffColor: Record<string, string> = {
    easy:   'bg-green-100 text-green-700',
    medium: 'bg-amber-100 text-amber-700',
    hard:   'bg-red-100   text-red-700',
  }
  const diffLabel: Record<string, string> = {
    easy: 'Lätt', medium: 'Medel', hard: 'Svår',
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500">
          Fråga {index + 1} av {total}
        </span>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${diffColor[q.difficulty] ?? 'bg-gray-100 text-gray-600'}`}>
            {diffLabel[q.difficulty] ?? q.difficulty}
          </span>
          <span className="text-xs text-gray-400">{q.subject}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary-500 rounded-full transition-all"
          style={{ width: `${((index + 1) / total) * 100}%` }}
        />
      </div>

      <p className="text-gray-900 font-medium leading-relaxed text-base">{q.question_text}</p>
      <p className="text-xs text-gray-400">{q.topic}</p>

      {q.question_type === 'mcq' && q.options ? (
        <div className="space-y-2">
          {q.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => onChange(opt.charAt(0))}  // store just the letter "A", "B" etc.
              className={`w-full text-left px-4 py-3 rounded-lg border-2 text-sm transition-all ${
                answer === opt.charAt(0)
                  ? 'border-primary-500 bg-primary-50 text-primary-800 font-medium'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <textarea
          className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none focus:ring-2 focus:ring-primary-300 outline-none"
          rows={5}
          placeholder="Skriv ditt svar här..."
          value={answer}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

// ─── Results view ─────────────────────────────────────────────────────────────

function ResultsView({ exam }: { exam: MockExam }) {
  const navigate = useNavigate()
  const score = exam.score_percent ?? 0
  const scoreColor = score >= 75 ? 'text-green-600' : score >= 50 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="space-y-5">
      {/* Score */}
      <div className="card p-6 text-center">
        <div className={`text-5xl font-bold mb-1 ${scoreColor}`}>{Math.round(score)}%</div>
        <div className="text-gray-500 text-sm">
          {exam.questions.filter(q => q.is_correct).length} av {exam.questions.length} rätt
        </div>
        {exam.time_taken_minutes && (
          <div className="text-xs text-gray-400 mt-1">Tid: {exam.time_taken_minutes} min</div>
        )}
      </div>

      {/* Per-question breakdown */}
      <div className="space-y-3">
        {exam.questions.map((q, i) => (
          <div key={q.id} className={`card p-4 border-l-4 ${q.is_correct ? 'border-l-green-400' : 'border-l-red-400'}`}>
            <div className="flex items-start gap-2">
              {q.is_correct
                ? <Check size={15} className="text-green-500 flex-shrink-0 mt-0.5" />
                : <AlertCircle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
              }
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-gray-500 mb-1">
                  Fråga {i + 1} · {q.subject}
                </div>
                <p className="text-sm text-gray-800 font-medium">{q.question_text}</p>

                {!q.is_correct && (
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="text-red-600">
                      <span className="font-medium">Ditt svar:</span> {q.student_answer ?? '—'}
                    </div>
                    <div className="text-green-700">
                      <span className="font-medium">Rätt svar:</span> {q.correct_answer}
                    </div>
                  </div>
                )}

                {q.explanation && (
                  <div className="mt-2 text-xs text-gray-500 leading-relaxed bg-gray-50 rounded p-2">
                    {q.explanation}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <button onClick={() => navigate('/ai-schedule')} className="btn-primary flex-1">
          Tillbaka till schemat
        </button>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MockExamPage() {
  const { examId } = useParams<{ examId: string }>()
  const navigate = useNavigate()
  const [exam, setExam] = useState<MockExam | null>(null)
  const [loading, setLoading] = useState(true)
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    if (!examId) return
    const e = await aiScheduleApi.getMockExam(Number(examId))
    setExam(e)
    setSubmitted(!!e.submitted_at)
  }, [examId])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  const totalSeconds = exam ? exam.duration_minutes * 60 : 0
  const timer = useTimer(totalSeconds, !submitted && !loading && !!exam)

  const handleSubmit = async () => {
    if (!exam || submitting) return
    setSubmitting(true)
    try {
      const result = await aiScheduleApi.submitMockExam(exam.id, answers)
      setExam(result)
      setSubmitted(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Laddar tentamen...</div>
    )
  }

  if (!exam) return null

  const questions = exam.questions
  const q = questions[current]

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600 transition-colors">
            <ChevronLeft size={18} />
          </button>
          <h1 className="text-xl font-bold text-gray-900">{exam.title}</h1>
        </div>
        <ResultsView exam={exam} />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600 transition-colors">
            <ChevronLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-900">{exam.title}</h1>
            <p className="text-xs text-gray-500">{exam.instructions}</p>
          </div>
        </div>
        {/* Timer */}
        <div className={`flex items-center gap-1.5 font-mono font-bold text-lg ${
          timer.remaining < 300 ? 'text-red-600' : 'text-gray-700'
        }`}>
          <Clock size={16} />
          {timer.display}
        </div>
      </div>

      {/* Question */}
      <div className="card p-6">
        <QuestionView
          q={q}
          index={current}
          total={questions.length}
          answer={answers[q.id] ?? ''}
          onChange={v => setAnswers(prev => ({ ...prev, [q.id]: v }))}
        />
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCurrent(c => Math.max(0, c - 1))}
          disabled={current === 0}
          className="btn-secondary text-sm flex items-center gap-1.5 disabled:opacity-40"
        >
          <ChevronLeft size={15} /> Föregående
        </button>

        {/* Dot nav */}
        <div className="flex gap-1.5">
          {questions.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                i === current ? 'bg-primary-600' :
                answers[questions[i].id] ? 'bg-primary-300' :
                'bg-gray-200 hover:bg-gray-300'
              }`}
            />
          ))}
        </div>

        {current < questions.length - 1 ? (
          <button
            onClick={() => setCurrent(c => Math.min(questions.length - 1, c + 1))}
            className="btn-secondary text-sm flex items-center gap-1.5"
          >
            Nästa <ChevronRight size={15} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Check size={14} /> {submitting ? 'Skickar...' : 'Lämna in'}
          </button>
        )}
      </div>

      {/* Answer status footer */}
      <div className="text-center text-xs text-gray-400">
        {Object.keys(answers).length} av {questions.length} frågor besvarade
      </div>
    </div>
  )
}
