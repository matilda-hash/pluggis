import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, Edit2, Check, X, BookOpen } from 'lucide-react'
import { cardsApi, decksApi } from '../services/api'
import type { Card, Deck } from '../types'

const STATE_COLORS: Record<number, string> = {
  0: 'bg-gray-100 text-gray-500',
  1: 'bg-amber-50 text-amber-600',
  2: 'bg-green-50 text-green-600',
  3: 'bg-red-50 text-red-500',
}
const STATE_NAMES: Record<number, string> = {
  0: 'Ny', 1: 'Lär', 2: 'Repetition', 3: 'Åter',
}

function ClozeText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{\{[^}]+\}\})/g).map((part, i) => {
        const m = part.match(/^\{\{(.+)\}\}$/)
        return m ? (
          <mark key={i} className="bg-primary-100 text-primary-700 px-0.5 rounded font-medium not-italic">
            {m[1]}
          </mark>
        ) : <span key={i}>{part}</span>
      })}
    </>
  )
}

type EditState = { id: number; front: string; back: string; cloze_text: string } | null

export default function Cards() {
  const { deckId } = useParams<{ deckId: string }>()
  const navigate = useNavigate()

  const [deck, setDeck] = useState<Deck | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<EditState>(null)
  const [showNew, setShowNew] = useState(false)
  const [newCard, setNewCard] = useState({ type: 'basic', front: '', back: '', cloze_text: '' })

  useEffect(() => {
    if (!deckId) return
    const id = Number(deckId)
    Promise.all([decksApi.get(id), cardsApi.list(id)])
      .then(([d, c]) => { setDeck(d); setCards(c) })
      .finally(() => setLoading(false))
  }, [deckId])

  const handleDelete = async (cardId: number) => {
    if (!confirm('Ta bort det här kortet?')) return
    await cardsApi.delete(cardId)
    setCards(prev => prev.filter(c => c.id !== cardId))
  }

  const handleSaveEdit = async () => {
    if (!edit) return
    const updated = await cardsApi.update(edit.id, {
      front: edit.front || null,
      back: edit.back || null,
      cloze_text: edit.cloze_text || null,
    })
    setCards(prev => prev.map(c => c.id === updated.id ? updated : c))
    setEdit(null)
  }

  const handleCreateCard = async () => {
    if (!deckId) return
    const created = await cardsApi.create({
      deck_id: Number(deckId),
      card_type: newCard.type,
      front: newCard.front || undefined,
      back: newCard.back || undefined,
      cloze_text: newCard.cloze_text || undefined,
    })
    setCards(prev => [created, ...prev])
    setNewCard({ type: 'basic', front: '', back: '', cloze_text: '' })
    setShowNew(false)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Laddar...</div>
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{deck?.name ?? 'Kort'}</h1>
            <p className="text-sm text-gray-500">{cards.length} kort</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate(`/study/${deckId}`)}
            className="btn-secondary text-sm flex items-center gap-1.5"
          >
            <BookOpen size={14} /> Studera
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Plus size={14} /> Lägg till kort
          </button>
        </div>
      </div>

      {/* New card form */}
      {showNew && (
        <div className="card p-5 space-y-3 border-2 border-primary-200">
          <div className="flex gap-2">
            {['basic', 'cloze'].map(t => (
              <button
                key={t}
                onClick={() => setNewCard(prev => ({ ...prev, type: t }))}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  newCard.type === t
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {newCard.type === 'cloze' ? (
            <textarea
              className="w-full text-sm border border-gray-200 rounded-lg p-2 resize-none focus:ring-2 focus:ring-primary-300 outline-none"
              rows={3}
              placeholder="Text med {{lucka}} att fylla i..."
              value={newCard.cloze_text}
              onChange={e => setNewCard(prev => ({ ...prev, cloze_text: e.target.value }))}
            />
          ) : (
            <>
              <input
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-300 outline-none"
                placeholder="Framsida (fråga)"
                value={newCard.front}
                onChange={e => setNewCard(prev => ({ ...prev, front: e.target.value }))}
              />
              <textarea
                className="w-full text-sm border border-gray-200 rounded-lg p-2 resize-none focus:ring-2 focus:ring-primary-300 outline-none"
                rows={3}
                placeholder="Baksida (svar)"
                value={newCard.back}
                onChange={e => setNewCard(prev => ({ ...prev, back: e.target.value }))}
              />
            </>
          )}
          <div className="flex gap-2">
            <button onClick={handleCreateCard} className="btn-primary text-sm px-4 py-2">Spara</button>
            <button onClick={() => setShowNew(false)} className="btn-secondary text-sm px-4 py-2">Avbryt</button>
          </div>
        </div>
      )}

      {/* Card list */}
      {cards.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-gray-400 text-sm">Inga kort i den här kortleken än.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {cards.map(card => {
            const isEditing = edit?.id === card.id
            const state = card.state?.state ?? 0

            return (
              <div key={card.id} className="card p-4">
                {isEditing && edit ? (
                  <div className="space-y-3">
                    {card.card_type === 'cloze' ? (
                      <textarea
                        className="w-full text-sm border border-gray-200 rounded-lg p-2 resize-none focus:ring-2 focus:ring-primary-300 outline-none"
                        rows={3}
                        value={edit.cloze_text}
                        onChange={e => setEdit({ ...edit, cloze_text: e.target.value })}
                      />
                    ) : (
                      <>
                        <input
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-300 outline-none"
                          value={edit.front}
                          onChange={e => setEdit({ ...edit, front: e.target.value })}
                        />
                        <textarea
                          className="w-full text-sm border border-gray-200 rounded-lg p-2 resize-none focus:ring-2 focus:ring-primary-300 outline-none"
                          rows={3}
                          value={edit.back}
                          onChange={e => setEdit({ ...edit, back: e.target.value })}
                        />
                      </>
                    )}
                    <div className="flex gap-2">
                      <button onClick={handleSaveEdit} className="text-xs btn-primary px-3 py-1.5 flex items-center gap-1"><Check size={12} /> Spara</button>
                      <button onClick={() => setEdit(null)} className="text-xs btn-secondary px-3 py-1.5 flex items-center gap-1"><X size={12} /> Avbryt</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 mt-0.5 ${STATE_COLORS[state]}`}>
                      {STATE_NAMES[state]}
                    </span>
                    <div className="flex-1 min-w-0">
                      {card.card_type === 'cloze' ? (
                        <p className="text-sm text-gray-700">
                          <ClozeText text={card.cloze_text ?? ''} />
                        </p>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-gray-800">{card.front}</p>
                          <p className="text-sm text-gray-500 mt-1">{card.back}</p>
                        </>
                      )}
                      {card.state && (
                        <p className="text-xs text-gray-400 mt-2">
                          Stabilitet: {card.state.stability.toFixed(1)}d · Reps: {card.state.reps}
                          {card.state.due && ` · Förfaller: ${new Date(card.state.due).toLocaleDateString('sv-SE')}`}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => setEdit({
                          id: card.id,
                          front: card.front ?? '',
                          back: card.back ?? '',
                          cloze_text: card.cloze_text ?? '',
                        })}
                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(card.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
