import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { CheckCircle2, ArrowLeft, X, BookOpen, Upload, Globe, RotateCcw } from 'lucide-react'
import { studyApi, decksApi } from '../services/api'
import type { Card, Rating, Deck } from '../types'
import Flashcard from '../components/study/Flashcard'

type SessionStats = {
  again: number; hard: number; good: number; easy: number
}

const STAT_KEY: Record<Rating, keyof SessionStats> = {
  1: 'again', 2: 'hard', 3: 'good', 4: 'easy',
}

const RETRY_OFFSET: Record<1 | 2, number> = {
  1: 3,
  2: 7,
}

export default function Study() {
  const { deckId } = useParams<{ deckId?: string }>()
  const navigate = useNavigate()

  const [queue, setQueue] = useState<Card[]>([])
  const [current, setCurrent] = useState(0)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [stats, setStats] = useState<SessionStats>({ again: 0, hard: 0, good: 0, easy: 0 })
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const [decks, setDecks] = useState<Deck[]>([])
  const [retryInfo, setRetryInfo] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [session, cards, allDecks] = await Promise.all([
          studyApi.startSession(deckId ? Number(deckId) : undefined),
          studyApi.queue(deckId ? Number(deckId) : undefined),
          decksApi.list(),
        ])
        setSessionId(session.id)
        setQueue(cards)
        setDecks(allDecks)
        if (cards.length === 0) setDone(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [deckId])

  const handleRate = useCallback(async (rating: Rating) => {
    const card = queue[current]
    if (!card) return

    setStats(prev => ({ ...prev, [STAT_KEY[rating]]: prev[STAT_KEY[rating]] + 1 }))
    setRetryInfo(null)

    try {
      await studyApi.review(card.id, rating, sessionId ?? undefined)
    } catch (e) {
      console.error('Review failed', e)
    }

    const shouldRetry = rating === 1 || rating === 2
    let newQueue = [...queue]
    if (shouldRetry) {
      const offset = RETRY_OFFSET[rating as 1 | 2]
      const insertAt = Math.min(current + 1 + offset, newQueue.length)
      const [retryCard] = newQueue.splice(current, 1)
      newQueue.splice(insertAt, 0, retryCard)
      setQueue(newQueue)
      setRetryInfo(`Kortet dyker upp igen om ${offset} kort`)
      if (current >= newQueue.length) {
        if (sessionId) { try { await studyApi.endSession(sessionId) } catch {} }
        setDone(true)
        return
      }
      return
    }

    if (current + 1 >= newQueue.length) {
      if (sessionId) {
        try { await studyApi.endSession(sessionId) } catch {}
      }
      setDone(true)
    } else {
      setCurrent(c => c + 1)
    }
  }, [queue, current, sessionId])

  const handleQuit = async () => {
    const reviewed = stats.again + stats.hard + stats.good + stats.easy
    if (reviewed > 0 && !confirm('Avsluta sessionen? Din progress sparas.')) return
    if (sessionId) { try { await studyApi.endSession(sessionId) } catch {} }
    navigate(-1)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
          <div className="text-gray-400 text-sm">Hämtar kort...</div>
        </div>
      </div>
    )
  }

  // ── Empty: nothing to study ───────────────────────────────────────────────
  if (done && stats.again + stats.hard + stats.good + stats.easy === 0) {
    const hasAnyCards = decks.some(d => (d.stats?.total_cards ?? 0) > 0)

    if (!hasAnyCards) {
      // No cards exist at all → onboarding
      return (
        <div className="max-w-lg mx-auto text-center py-16 space-y-6">
          <div className="w-16 h-16 bg-primary-50 rounded-full flex items-center justify-center mx-auto">
            <BookOpen size={28} className="text-primary-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Kom igång!</h2>
            <p className="text-gray-500 text-sm leading-relaxed">
              Du har inga kort att studera än.<br />
              Ladda upp en PDF eller hämta en delad kortlek.
            </p>
          </div>
          <div className="flex flex-col gap-3 max-w-xs mx-auto">
            <button onClick={() => navigate('/upload')} className="btn-primary flex items-center justify-center gap-2">
              <Upload size={16} />
              Ladda upp PDF → Generera kort
            </button>
            <button onClick={() => navigate('/public-decks')} className="btn-secondary flex items-center justify-center gap-2">
              <Globe size={16} />
              Bläddra bland delade kortlekar
            </button>
          </div>
        </div>
      )
    }

    // Cards exist but nothing due → all caught up
    return (
      <div className="max-w-lg mx-auto text-center py-16 space-y-6">
        <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 size={32} className="text-green-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Allt klart för idag!</h2>
          <p className="text-gray-500 text-sm">Inga kort förfaller just nu. Öva en specifik kortlek för att repetera mer.</p>
        </div>
        <div className="card p-4 text-left space-y-1 max-w-xs mx-auto">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Välj kortlek att öva</p>
          {decks.slice(0, 6).map(d => (
            <button
              key={d.id}
              onClick={() => navigate(`/study/${d.id}`)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-sm"
            >
              <span className="font-medium text-gray-800">{d.name}</span>
              <span className="text-xs text-gray-400">{d.stats?.total_cards ?? 0} kort</span>
            </button>
          ))}
        </div>
        <button onClick={() => navigate('/')} className="btn-secondary">Till översikten</button>
      </div>
    )
  }

  // ── Session complete ──────────────────────────────────────────────────────
  if (done) {
    const totalReviewed = stats.again + stats.hard + stats.good + stats.easy
    const goodRate = Math.round(((stats.good + stats.easy) / totalReviewed) * 100)
    return (
      <div className="max-w-lg mx-auto text-center py-16 space-y-6">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 size={32} className="text-green-500" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Session klar!</h2>
          <p className="text-gray-500">{totalReviewed} kort övade · {goodRate}% rätt vid första försöket</p>
        </div>

        <div className="card p-5 text-left grid grid-cols-2 gap-3">
          <StatRow label="Igen" count={stats.again} color="text-red-500" />
          <StatRow label="Svårt" count={stats.hard} color="text-amber-500" />
          <StatRow label="Bra" count={stats.good} color="text-green-600" />
          <StatRow label="Lätt" count={stats.easy} color="text-emerald-600" />
        </div>

        {stats.again > 0 && (
          <p className="text-xs text-gray-400">
            {stats.again} kort markerades som "Igen" och repeteras imorgon
          </p>
        )}

        <div className="flex gap-3 justify-center">
          <button onClick={() => navigate('/')} className="btn-secondary">Översikt</button>
          <button onClick={() => window.location.reload()} className="btn-primary flex items-center gap-2">
            <RotateCcw size={14} /> Studera igen
          </button>
        </div>
      </div>
    )
  }

  // ── Active session ────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <button onClick={handleQuit} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <ArrowLeft size={16} />
          Tillbaka
        </button>
        <div className="text-sm text-gray-400">{current + 1} / {queue.length}</div>
        <button onClick={handleQuit} className="text-gray-400 hover:text-gray-600 transition-colors">
          <X size={16} />
        </button>
      </div>

      {retryInfo && (
        <div className="text-center text-xs text-amber-500 bg-amber-50 py-1.5 rounded-full">
          {retryInfo}
        </div>
      )}

      <Flashcard
        card={queue[current]}
        onRate={handleRate}
        progress={{ current: current + 1, total: queue.length }}
      />
    </div>
  )
}

function StatRow({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-600">{label}</span>
      <span className={`font-bold ${color}`}>{count}</span>
    </div>
  )
}
