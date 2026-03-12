import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, ChevronDown, ChevronUp, ArrowLeft, Star } from 'lucide-react'
import { aiScheduleApi, examsApi } from '../services/api'
import type { ExamTopic, Exam, MasteryLevel } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MASTERY_LABEL: Record<MasteryLevel, string> = {
  not_started: 'Ej påbörjad',
  learning:    'Lär mig',
  familiar:    'Bekant',
  proficient:  'Kunnig',
  mastered:    'Bemästrad',
}

const MASTERY_COLOR: Record<MasteryLevel, string> = {
  not_started: 'bg-gray-100 text-gray-500',
  learning:    'bg-blue-100 text-blue-700',
  familiar:    'bg-yellow-100 text-yellow-700',
  proficient:  'bg-green-100 text-green-700',
  mastered:    'bg-emerald-100 text-emerald-700',
}

const RATING_LABELS = ['', 'Glömde', 'Svårt', 'Kom ihåg', 'Lätt']
const RATING_COLORS = [
  '',
  'bg-red-100 text-red-700 hover:bg-red-200',
  'bg-amber-100 text-amber-700 hover:bg-amber-200',
  'bg-green-100 text-green-700 hover:bg-green-200',
  'bg-emerald-100 text-emerald-700 hover:bg-emerald-200',
]

// Common medical topics by subject for quick-add
const QUICK_TOPICS: Record<string, string[]> = {
  Anatomi: [
    'Rörelseapparaten', 'Cirkulation', 'Andningssystemet', 'Nervsystemet',
    'Matsmältningssystemet', 'Urinsystemet', 'Reproduktionssystemet', 'Endokrina systemet',
  ],
  Fysiologi: [
    'Hjärtats fysiologi', 'Lungornas fysiologi', 'Njurfysiologi', 'Neurofysiologi',
    'Muskelfysiologi', 'Endokrinologi', 'Immunologi',
  ],
  Biokemi: [
    'Proteiner och enzymer', 'Kolhydratmetabolism', 'Lipidmetabolism',
    'DNA-replikation', 'Transkription och translation', 'Signaltransduktion',
  ],
  Histologi: [
    'Epitelväv', 'Bindväv', 'Muskelväv', 'Nervväv',
    'Blod och benmärg', 'Organhistologi',
  ],
  Patologi: [
    'Celldöd och skada', 'Inflammation', 'Neoplasi', 'Kardiovaskulär patologi',
  ],
}

// ─── Add topic form ────────────────────────────────────────────────────────────

function AddTopicForm({
  examId,
  examName,
  onAdd,
}: {
  examId: number
  examName: string
  onAdd: (topic: ExamTopic) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [saving, setSaving] = useState(false)
  const [showQuick, setShowQuick] = useState(false)

  const add = async (topicName: string, topicSubject: string) => {
    if (!topicName.trim()) return
    setSaving(true)
    try {
      const t = await aiScheduleApi.createTopic({ exam_id: examId, name: topicName.trim(), subject: topicSubject || 'Okänt' })
      onAdd(t)
      setName('')
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    add(name, subject)
  }

  const bulkAdd = async (names: string[], subj: string) => {
    setSaving(true)
    try {
      const topics = await aiScheduleApi.bulkCreateTopics(names.map(n => ({ exam_id: examId, name: n, subject: subj })))
      topics.forEach(onAdd)
    } finally {
      setSaving(false)
      setShowQuick(false)
    }
  }

  return (
    <div className="mt-3">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-700 font-medium"
        >
          <Plus size={13} /> Lägg till ämne
        </button>
      ) : (
        <div className="border border-dashed border-gray-200 rounded-lg p-3 space-y-3">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              autoFocus
              className="flex-1 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-primary-300 outline-none"
              placeholder={`Ämne för ${examName}...`}
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <input
              className="w-28 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-primary-300 outline-none"
              placeholder="Ämnestyp"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              list="subject-suggestions"
            />
            <datalist id="subject-suggestions">
              {Object.keys(QUICK_TOPICS).map(s => <option key={s} value={s} />)}
            </datalist>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
            >
              {saving ? '...' : 'Lägg till'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary text-xs px-3 py-1.5">
              Avbryt
            </button>
          </form>

          {/* Quick-add from templates */}
          <button
            onClick={() => setShowQuick(v => !v)}
            className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
          >
            <Star size={11} /> Snabblägg till från mall
            {showQuick ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          {showQuick && (
            <div className="space-y-2">
              {Object.entries(QUICK_TOPICS).map(([subj, topics]) => (
                <div key={subj}>
                  <div className="text-xs font-medium text-gray-500 mb-1">{subj}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {topics.map(t => (
                      <button
                        key={t}
                        onClick={() => add(t, subj)}
                        disabled={saving}
                        className="text-xs bg-gray-100 hover:bg-primary-50 hover:text-primary-700 text-gray-600 px-2 py-1 rounded-full transition-colors"
                      >
                        + {t}
                      </button>
                    ))}
                    <button
                      onClick={() => bulkAdd(topics, subj)}
                      disabled={saving}
                      className="text-xs bg-primary-100 text-primary-700 hover:bg-primary-200 px-2 py-1 rounded-full transition-colors font-medium"
                    >
                      + Alla
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Topic row ────────────────────────────────────────────────────────────────

function TopicRow({ topic, onDelete, onReview }: {
  topic: ExamTopic
  onDelete: (id: number) => void
  onReview: (id: number, rating: 1|2|3|4) => Promise<void>
}) {
  const [rating, setRating] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleRate = async (r: 1|2|3|4) => {
    setSaving(true)
    await onReview(topic.id, r)
    setSaving(false)
    setRating(false)
  }

  const retrievabilityPct = Math.round(topic.fsrs_retrievability * 100)

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-gray-50 group transition-colors">
      {/* Mastery badge */}
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${MASTERY_COLOR[topic.mastery_level]}`}>
        {MASTERY_LABEL[topic.mastery_level]}
      </span>

      {/* Name + subject */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-800 truncate">{topic.name}</div>
        <div className="text-xs text-gray-400">{topic.subject}</div>
      </div>

      {/* Retrievability bar */}
      <div className="hidden sm:flex items-center gap-1.5 w-20 flex-shrink-0">
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${retrievabilityPct}%`,
              backgroundColor: retrievabilityPct >= 80 ? '#22c55e' : retrievabilityPct >= 50 ? '#f59e0b' : '#ef4444',
            }}
          />
        </div>
        <span className="text-xs text-gray-400 w-8 text-right">{retrievabilityPct}%</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!rating ? (
          <button
            onClick={() => setRating(true)}
            className="text-xs text-gray-400 hover:text-primary-600 px-2 py-1 rounded transition-colors"
          >
            Betygsätt
          </button>
        ) : (
          <div className="flex gap-1">
            {([1,2,3,4] as const).map(r => (
              <button
                key={r}
                onClick={() => handleRate(r)}
                disabled={saving}
                className={`text-xs px-2 py-1 rounded transition-colors ${RATING_COLORS[r]}`}
              >
                {RATING_LABELS[r]}
              </button>
            ))}
            <button onClick={() => setRating(false)} className="text-xs text-gray-400 hover:text-gray-600 px-1">✕</button>
          </div>
        )}
        <button
          onClick={() => onDelete(topic.id)}
          className="p-1.5 text-gray-300 hover:text-red-400 transition-colors"
          title="Ta bort"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

// ─── Exam section ─────────────────────────────────────────────────────────────

function ExamSection({ exam, topics, onAdd, onDelete, onReview }: {
  exam: Exam
  topics: ExamTopic[]
  onAdd: (t: ExamTopic) => void
  onDelete: (id: number) => void
  onReview: (id: number, rating: 1|2|3|4) => Promise<void>
}) {
  const [collapsed, setCollapsed] = useState(false)

  const masteredCount = topics.filter(t => t.mastery_level === 'mastered' || t.mastery_level === 'proficient').length
  const daysLeft = exam.days_remaining ?? 0

  return (
    <div className="card p-0 overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors text-left"
        onClick={() => setCollapsed(v => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 text-sm">{exam.name}</div>
          <div className="text-xs text-gray-400 mt-0.5">
            {topics.length} ämnen · {masteredCount} kunniga/bemästrade
            {daysLeft !== null && (
              <span className={`ml-2 font-medium ${daysLeft <= 14 ? 'text-red-500' : daysLeft <= 30 ? 'text-amber-500' : 'text-gray-400'}`}>
                · {daysLeft} dagar kvar
              </span>
            )}
          </div>
        </div>
        {/* Progress bar */}
        {topics.length > 0 && (
          <div className="hidden sm:block w-24 flex-shrink-0">
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-400 rounded-full"
                style={{ width: `${Math.round((masteredCount / topics.length) * 100)}%` }}
              />
            </div>
            <div className="text-xs text-gray-400 text-right mt-0.5">{Math.round((masteredCount / topics.length) * 100)}%</div>
          </div>
        )}
        {collapsed ? <ChevronDown size={15} className="text-gray-400 flex-shrink-0" /> : <ChevronUp size={15} className="text-gray-400 flex-shrink-0" />}
      </button>

      {!collapsed && (
        <div className="px-4 pb-4">
          {topics.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">
              Inga ämnen tillagda än. Lägg till ämnen nedan så kan AI:n planera optimalt.
            </p>
          ) : (
            <div className="divide-y divide-gray-50">
              {topics.map(t => (
                <TopicRow key={t.id} topic={t} onDelete={onDelete} onReview={onReview} />
              ))}
            </div>
          )}
          <AddTopicForm examId={exam.id} examName={exam.name} onAdd={onAdd} />
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AITopics() {
  const navigate = useNavigate()
  const [exams, setExams] = useState<Exam[]>([])
  const [topics, setTopics] = useState<ExamTopic[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [e, t] = await Promise.all([examsApi.list(), aiScheduleApi.listTopics()])
    setExams(e.filter(ex => (ex.days_remaining ?? 999) >= 0))
    setTopics(t)
  }, [])

  useEffect(() => { load().finally(() => setLoading(false)) }, [load])

  const handleAdd = (topic: ExamTopic) => {
    setTopics(prev => [...prev, topic])
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Ta bort det här ämnet?')) return
    await aiScheduleApi.deleteTopic(id)
    setTopics(prev => prev.filter(t => t.id !== id))
  }

  const handleReview = async (id: number, rating: 1|2|3|4) => {
    const updated = await aiScheduleApi.reviewTopic(id, rating)
    setTopics(prev => prev.map(t => t.id === updated.id ? updated : t))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        Laddar ämnen...
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/ai-schedule')}
          className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Studieämnen</h1>
          <p className="text-sm text-gray-500">
            Lägg till ämnen per tenta — AI:n planerar baserat på svårighetsgrad och beredskap
          </p>
        </div>
      </div>

      {/* Info card */}
      <div className="bg-primary-50 border border-primary-100 rounded-lg p-4 text-sm text-primary-800">
        <strong>Tipps:</strong> Ju fler ämnen du lägger till, desto bättre och mer specifikt schema.
        Betygsätt ämnen regelbundet så håller FSRS koll på vad du behöver repetera.
      </div>

      {/* No exams state */}
      {exams.length === 0 && (
        <div className="card p-6 text-center text-gray-500 text-sm">
          <p>Inga aktiva tentor hittades.</p>
          <button
            onClick={() => navigate('/')}
            className="btn-primary mt-3 text-sm"
          >
            Lägg till tenta på översikten
          </button>
        </div>
      )}

      {/* Exam sections */}
      {exams.map(exam => (
        <ExamSection
          key={exam.id}
          exam={exam}
          topics={topics.filter(t => t.exam_id === exam.id)}
          onAdd={handleAdd}
          onDelete={handleDelete}
          onReview={handleReview}
        />
      ))}

      {/* Bottom CTA */}
      {topics.length > 0 && (
        <div className="flex justify-center pb-4">
          <button
            onClick={() => navigate('/ai-schedule')}
            className="btn-primary px-6"
          >
            Generera schema med dessa ämnen →
          </button>
        </div>
      )}
    </div>
  )
}
