import { useState } from 'react'
import { CalendarDays, Plus, Trash2, BookOpen, AlertTriangle, X, Sparkles, Check, MessageSquare } from 'lucide-react'
import { examsApi } from '../../services/api'
import type { Exam, ExamCreate, Deck, ExamAnalyzeMessage, ExamStudyConfig } from '../../types'

interface Props {
  exams: Exam[]
  decks: Deck[]
  onExamsChange: () => void
}

function daysLabel(days: number | null): { text: string; color: string } {
  if (days === null) return { text: '', color: '' }
  if (days === 0) return { text: 'Idag!', color: 'text-red-600 font-bold' }
  if (days <= 3) return { text: `${days} dagar`, color: 'text-red-500 font-semibold' }
  if (days <= 7) return { text: `${days} dagar`, color: 'text-amber-500 font-semibold' }
  if (days <= 14) return { text: `${days} dagar`, color: 'text-amber-400' }
  return { text: `${days} dagar`, color: 'text-gray-500' }
}

function studyTypeLabel(cfg: ExamStudyConfig): string {
  const map: Record<string, string> = {
    flashcards: 'Flashcards',
    practice_tests: 'Gamla prov',
    reading: 'Läsning',
    mixed: 'Blandat',
  }
  return map[cfg.study_type] ?? cfg.study_type
}

// ── AI Strategy Chat Modal ─────────────────────────────────────────────────────

interface StrategyModalProps {
  exam: Exam
  onClose: () => void
  onDone: () => void
}

function StrategyModal({ exam, onClose, onDone }: StrategyModalProps) {
  const [notes, setNotes] = useState(exam.notes ?? '')
  const [messages, setMessages] = useState<ExamAnalyzeMessage[]>([])
  const [pendingQuestion, setPendingQuestion] = useState<{ question: string; options: string[] } | null>(null)
  const [strategy, setStrategy] = useState<ExamStudyConfig | null>(exam.study_config)
  const [loading, setLoading] = useState(false)
  // Only treat as "already started" if we have an actual strategy result to show.
  // Having notes alone should not hide the input — just pre-fill it.
  const [started, setStarted] = useState(!!exam.study_config)

  async function start() {
    if (!notes.trim()) return
    setLoading(true)
    const firstMsg: ExamAnalyzeMessage = { role: 'user', content: notes.trim() }
    const newMsgs = [firstMsg]
    setMessages(newMsgs)
    setStarted(true)
    try {
      const res = await examsApi.analyze(exam.id, newMsgs)
      if (res.done && res.strategy) {
        setStrategy(res.strategy)
        setPendingQuestion(null)
      } else if (res.question) {
        setPendingQuestion({ question: res.question, options: res.options ?? [] })
        setMessages(prev => [...prev, { role: 'assistant', content: res.question! }])
      }
    } finally {
      setLoading(false)
    }
  }

  async function answer(option: string) {
    setLoading(true)
    const newMsgs: ExamAnalyzeMessage[] = [...messages, { role: 'user', content: option }]
    setMessages(newMsgs)
    setPendingQuestion(null)
    try {
      const res = await examsApi.analyze(exam.id, newMsgs)
      if (res.done && res.strategy) {
        setStrategy(res.strategy)
        setPendingQuestion(null)
      } else if (res.question) {
        setPendingQuestion({ question: res.question, options: res.options ?? [] })
        setMessages(prev => [...prev, { role: 'assistant', content: res.question! }])
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-primary-500" />
            <span className="font-semibold text-gray-800 text-sm">AI-studiestrategi</span>
            <span className="text-xs text-gray-400 truncate max-w-[140px]">{exam.name}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Strategy result */}
          {strategy && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
                <Check size={14} />
                Strategi klar!
              </div>
              <p className="text-sm text-gray-700">{strategy.summary}</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="text-xs bg-white border border-emerald-200 text-emerald-700 px-2 py-1 rounded-full">
                  {studyTypeLabel(strategy)}
                </span>
                {strategy.no_flashcards && (
                  <span className="text-xs bg-white border border-gray-200 text-gray-500 px-2 py-1 rounded-full">
                    Inga flashcards
                  </span>
                )}
                {strategy.study_type === 'practice_tests' && (
                  <span className="text-xs bg-white border border-emerald-200 text-emerald-700 px-2 py-1 rounded-full">
                    {strategy.practice_test_minutes} min/prov · {strategy.daily_practice_tests}/dag
                  </span>
                )}
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => { onDone(); onClose() }}
                  className="btn-primary text-xs px-4 py-2"
                >
                  Använd strategin
                </button>
                <button
                  onClick={() => {
                    setStrategy(null)
                    setMessages([])
                    setPendingQuestion(null)
                    setStarted(false)
                  }}
                  className="btn-secondary text-xs px-4 py-2"
                >
                  Ändra strategi
                </button>
              </div>
            </div>
          )}

          {/* Conversation history */}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                m.role === 'user'
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}>
                {m.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-xl px-3 py-2 text-sm text-gray-500 animate-pulse">
                Tänker...
              </div>
            </div>
          )}

          {/* Question options */}
          {pendingQuestion && !loading && (
            <div className="space-y-2">
              {pendingQuestion.options.map(opt => (
                <button
                  key={opt}
                  onClick={() => answer(opt)}
                  className="w-full text-left text-sm px-3 py-2 rounded-lg border border-gray-200 hover:border-primary-400 hover:bg-primary-50 transition-colors"
                >
                  {opt}
                </button>
              ))}
              <p className="text-xs text-gray-400 text-center">eller skriv eget svar ↓</p>
              <input
                type="text"
                placeholder="Skriv eget svar..."
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-300 outline-none"
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                    answer((e.target as HTMLInputElement).value.trim())
                    ;(e.target as HTMLInputElement).value = ''
                  }
                }}
              />
            </div>
          )}

          {/* Initial notes input */}
          {!started && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Beskriv hur du vill studera inför <strong>{exam.name}</strong>. AI:n ställer följdfrågor om det behövs.
              </p>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Ex: Högskoleprov, jag vill öva på gamla prov, inga flashcards behövs"
                rows={4}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-300 outline-none resize-none"
              />
              <button
                onClick={start}
                disabled={!notes.trim() || loading}
                className="btn-primary text-xs px-4 py-2 w-full disabled:opacity-50"
              >
                {loading ? 'Analyserar...' : 'Analysera med AI'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main ExamPanel ─────────────────────────────────────────────────────────────

export default function ExamPanel({ exams, decks, onExamsChange }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [strategyExam, setStrategyExam] = useState<Exam | null>(null)

  const handleCreate = async () => {
    if (!name.trim() || !date) return
    setSaving(true)
    try {
      const payload: ExamCreate = {
        name: name.trim(),
        exam_date: new Date(date).toISOString(),
        notes: notes.trim() || undefined,
      }
      await examsApi.create(payload)
      setName('')
      setDate('')
      setNotes('')
      setShowForm(false)
      onExamsChange()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    await examsApi.delete(id)
    onExamsChange()
  }

  const deckMap = new Map(decks.map(d => [d.id, d]))

  return (
    <div className="card p-5">
      {strategyExam && (
        <StrategyModal
          exam={strategyExam}
          onClose={() => setStrategyExam(null)}
          onDone={() => { setStrategyExam(null); onExamsChange() }}
        />
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CalendarDays size={16} className="text-primary-500" />
          <h2 className="text-sm font-semibold text-gray-700">Kommande tentamen</h2>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
        >
          {showForm ? <X size={13} /> : <Plus size={13} />}
          {showForm ? 'Stäng' : 'Lägg till'}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="mb-4 p-4 bg-gray-50 rounded-xl space-y-3 border border-gray-100">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Tentamensnamn (t.ex. Neurologi)"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-300 outline-none bg-white"
          />
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-300 outline-none bg-white"
          />
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Studiestrategi (valfritt) – t.ex. 'öva på gamla prov, inga flashcards'"
            rows={2}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-300 outline-none bg-white resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={saving || !name.trim() || !date}
              className="btn-primary text-xs px-4 py-2 disabled:opacity-50"
            >
              {saving ? 'Sparar...' : 'Spara tentamen'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="btn-secondary text-xs px-4 py-2"
            >
              Avbryt
            </button>
          </div>
        </div>
      )}

      {/* Exam list */}
      {exams.length === 0 ? (
        <div className="text-center py-6">
          <BookOpen size={28} className="mx-auto text-gray-200 mb-2" />
          <p className="text-xs text-gray-400">Inga tentamen inlagda ännu.</p>
          <p className="text-xs text-gray-400">Lägg till en tentamen för smarta studietips!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {exams.map(exam => {
            const { text, color } = daysLabel(exam.days_remaining)
            const relevantDecks = exam.relevant_deck_ids
              .map(id => deckMap.get(id))
              .filter(Boolean) as Deck[]
            const isUrgent = exam.days_remaining !== null && exam.days_remaining <= 7

            return (
              <div
                key={exam.id}
                className={`rounded-xl p-3 border ${isUrgent ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {isUrgent && <AlertTriangle size={12} className="text-red-500 flex-shrink-0" />}
                      <span className="font-semibold text-gray-800 text-sm truncate">{exam.name}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-500">
                        {new Date(exam.exam_date).toLocaleDateString('sv-SE', {
                          weekday: 'short', day: 'numeric', month: 'short'
                        })}
                      </span>
                      {text && (
                        <span className={`text-xs ${color}`}>om {text}</span>
                      )}
                    </div>

                    {/* Study config badge */}
                    {exam.study_config && (
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-xs bg-primary-50 text-primary-600 px-2 py-0.5 rounded-full">
                          {studyTypeLabel(exam.study_config)}
                        </span>
                        {exam.study_config.no_flashcards && (
                          <span className="text-xs text-gray-400 px-2 py-0.5 rounded-full bg-gray-100">
                            inga flashcards
                          </span>
                        )}
                      </div>
                    )}

                    {/* Notes preview */}
                    {exam.notes && !exam.study_config && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{exam.notes}</p>
                    )}

                    {/* Relevant decks */}
                    {relevantDecks.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {relevantDecks.map(d => (
                          <span
                            key={d.id}
                            className="text-xs bg-primary-50 text-primary-600 px-2 py-0.5 rounded-full"
                          >
                            {d.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* AI strategy button */}
                    <button
                      onClick={() => setStrategyExam(exam)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        exam.study_config
                          ? 'text-primary-400 hover:text-primary-600 bg-primary-50'
                          : 'text-gray-300 hover:text-primary-400'
                      }`}
                      title={exam.study_config ? 'Ändra strategi' : 'Skapa studiestrategi med AI'}
                    >
                      {exam.study_config ? <Check size={13} /> : <MessageSquare size={13} />}
                    </button>
                    <button
                      onClick={() => handleDelete(exam.id)}
                      className="p-1.5 text-gray-300 hover:text-red-400 transition-colors"
                      title="Ta bort tentamen"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
