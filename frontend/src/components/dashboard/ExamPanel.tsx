import { useState } from 'react'
import { CalendarDays, Plus, Trash2, BookOpen, AlertTriangle, X } from 'lucide-react'
import { examsApi } from '../../services/api'
import type { Exam, ExamCreate, Deck } from '../../types'

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

export default function ExamPanel({ exams, decks, onExamsChange }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const handleCreate = async () => {
    if (!name.trim() || !date) return
    setSaving(true)
    try {
      const payload: ExamCreate = {
        name: name.trim(),
        exam_date: new Date(date).toISOString(),
        description: description.trim() || undefined,
      }
      await examsApi.create(payload)
      setName('')
      setDate('')
      setDescription('')
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

  // Build a name→deck map for showing relevant decks
  const deckMap = new Map(decks.map(d => [d.id, d]))

  return (
    <div className="card p-5">
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
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Anteckningar (valfritt)"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-300 outline-none bg-white"
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
                        <span className={`text-xs ${color}`}>
                          om {text}
                        </span>
                      )}
                    </div>
                    {exam.description && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{exam.description}</p>
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
                  <button
                    onClick={() => handleDelete(exam.id)}
                    className="p-1.5 text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                    title="Ta bort tentamen"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
