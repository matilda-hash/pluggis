import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Globe, Copy, Loader2 } from 'lucide-react'
import { decksApi } from '../services/api'
import type { Deck } from '../types'
import { useAuth } from '../auth/AuthContext'

export default function PublicDecks() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [decks, setDecks] = useState<Deck[]>([])
  const [loading, setLoading] = useState(true)
  const [copying, setCopying] = useState<number | null>(null)
  const [copied, setCopied] = useState<number | null>(null)

  useEffect(() => {
    decksApi.listPublic()
      .then(setDecks)
      .finally(() => setLoading(false))
  }, [])

  const handleCopy = async (deck: Deck) => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: '/public-decks' } })
      return
    }
    setCopying(deck.id)
    try {
      await decksApi.copy(deck.id)
      setCopied(deck.id)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // ignore
    } finally {
      setCopying(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Globe size={20} className="text-primary-600" />
          Offentliga kortlekar
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Bläddra bland delade kortlekar och kopiera dem till ditt konto
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      ) : decks.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">
          Inga offentliga kortlekar ännu
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {decks.map(deck => (
            <div key={deck.id} className="card p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: deck.color }}
                  />
                  <h3 className="font-semibold text-gray-800 truncate">{deck.name}</h3>
                </div>
              </div>

              {deck.description && (
                <p className="text-sm text-gray-500 line-clamp-2">{deck.description}</p>
              )}

              {deck.stats && (
                <p className="text-xs text-gray-400">{deck.stats.total_cards} kort</p>
              )}

              <button
                onClick={() => handleCopy(deck)}
                disabled={copying === deck.id}
                className="w-full btn-secondary text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {copying === deck.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Copy size={14} />
                )}
                {copied === deck.id ? 'Kopierad!' : 'Kopiera till mitt konto'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
