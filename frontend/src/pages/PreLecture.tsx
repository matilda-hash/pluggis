import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, RefreshCw, BookOpen, ListChecks, ExternalLink, Youtube,
  ChevronDown, ChevronUp, Check, X, MapPin, Star,
} from 'lucide-react'
import type { PreLecturePayload, Lecture } from '../types'
import { preLectureApi, scheduleApi } from '../services/api'

export default function PreLecture() {
  const { lectureId } = useParams<{ lectureId: string }>()
  const navigate = useNavigate()
  const id = Number(lectureId)

  const [payload, setPayload] = useState<PreLecturePayload | null>(null)
  const [lecture, setLecture] = useState<Lecture | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [revealedAnswers, setRevealedAnswers] = useState<Set<number>>(new Set())
  const [expandedSections, setExpandedSections] = useState({
    quiz: true, bullets: true, youtube: true, cards: false,
  })

  useEffect(() => {
    if (!id) return
    Promise.all([
      preLectureApi.get(id),
      scheduleApi.lectures(),
    ]).then(([payloadData, lectures]) => {
      setPayload(payloadData)
      const lec = lectures.find(l => l.id === id)
      if (lec) setLecture(lec)
    }).finally(() => setLoading(false))
  }, [id])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const fresh = await preLectureApi.refresh(id)
      setPayload(fresh)
      setRevealedAnswers(new Set())
    } finally {
      setRefreshing(false)
    }
  }

  function toggleAnswer(i: number) {
    setRevealedAnswers(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  function toggleSection(key: keyof typeof expandedSections) {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw size={24} className="animate-spin text-primary-500" />
    </div>
  )

  if (!payload) return (
    <div className="text-center py-12 text-gray-500">Kunde inte ladda förberedelseblock.</div>
  )

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft size={16} /> Tillbaka
        </button>
      </div>

      {/* Lecture info */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-gray-900">{payload.lecture_title}</h1>
              {lecture?.is_difficult && <Star size={16} className="text-amber-500" />}
              {lecture?.is_in_person && <MapPin size={14} className="text-gray-400" />}
            </div>
            {lecture && (
              <p className="text-sm text-gray-500">
                {new Date(lecture.lecture_date).toLocaleDateString('sv-SE', {
                  weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
                })}
              </p>
            )}
            {lecture?.subject_tag && (
              <span className="mt-2 inline-block text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full">
                {lecture.subject_tag}
              </span>
            )}
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Uppdatera
          </button>
        </div>

        {/* Stats row */}
        <div className="mt-4 flex items-center gap-6 text-sm text-gray-600">
          <span className="flex items-center gap-1.5">
            <BookOpen size={14} />
            {payload.block_duration_minutes} min block
          </span>
          <span className="flex items-center gap-1.5">
            <RefreshCw size={14} />
            {payload.card_review_minutes} min repetition
          </span>
          <span className="flex items-center gap-1.5">
            <ListChecks size={14} />
            {payload.targeted_card_ids.length} kort
          </span>
        </div>
      </div>

      {/* What to listen for */}
      {payload.what_to_listen_for.length > 0 && (
        <Section
          title="Lyssna efter"
          expanded={expandedSections.bullets}
          onToggle={() => toggleSection('bullets')}
        >
          <ul className="space-y-2">
            {payload.what_to_listen_for.map((bullet, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="text-primary-500 mt-0.5 shrink-0">•</span>
                {bullet}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Mini quiz */}
      {payload.mini_quiz.length > 0 && (
        <Section
          title={`Mini-quiz (${payload.mini_quiz.length} frågor)`}
          expanded={expandedSections.quiz}
          onToggle={() => toggleSection('quiz')}
        >
          <div className="space-y-3">
            {payload.mini_quiz.map((q, i) => (
              <div key={i} className="bg-gray-50 rounded-xl p-4">
                <p className="text-sm font-medium text-gray-900 mb-2">{q.question}</p>
                {revealedAnswers.has(i) ? (
                  <div className="flex items-start gap-2">
                    <Check size={14} className="text-green-600 mt-0.5 shrink-0" />
                    <p className="text-sm text-green-800 bg-green-50 rounded-lg px-3 py-2 flex-1">{q.answer}</p>
                  </div>
                ) : (
                  <button
                    onClick={() => toggleAnswer(i)}
                    className="text-xs text-primary-600 hover:underline flex items-center gap-1"
                  >
                    <ChevronDown size={12} /> Visa svar
                  </button>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Reading task */}
      {payload.reading_task && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <p className="text-sm font-semibold text-amber-700 mb-1">Läsuppgift</p>
          <p className="text-sm text-amber-800">{payload.reading_task}</p>
        </div>
      )}

      {/* YouTube suggestions */}
      {payload.youtube_suggestions.length > 0 && (
        <Section
          title="YouTube-förslag"
          expanded={expandedSections.youtube}
          onToggle={() => toggleSection('youtube')}
        >
          <div className="space-y-2">
            {payload.youtube_suggestions.map((yt, i) => (
              <a
                key={i}
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(yt.search_query)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors"
              >
                <Youtube size={18} className="text-red-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-red-800">{yt.title}</p>
                  <p className="text-xs text-red-600 mt-0.5 flex items-center gap-1">
                    Sök: "{yt.search_query}" <ExternalLink size={10} />
                  </p>
                </div>
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* Targeted card IDs (collapsed) */}
      {payload.targeted_card_ids.length > 0 && (
        <Section
          title={`Riktade kort (${payload.targeted_card_ids.length})`}
          expanded={expandedSections.cards}
          onToggle={() => toggleSection('cards')}
        >
          <p className="text-sm text-gray-600">
            {payload.targeted_card_ids.length} kort matchande detta ämne har identifierats för riktad repetition.
            Starta en studiesession i appen eller öppna Anki för att repetera dessa.
          </p>
          <button
            onClick={() => navigate('/study')}
            className="mt-2 flex items-center gap-2 text-sm text-primary-600 hover:underline"
          >
            <BookOpen size={14} /> Starta studiesession →
          </button>
        </Section>
      )}
    </div>
  )
}

// ── Reusable section wrapper ───────────────────────────────────────────────────

function Section({
  title, expanded, onToggle, children,
}: {
  title: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-4 font-semibold text-gray-900 hover:bg-gray-50 text-left"
        onClick={onToggle}
      >
        <span>{title}</span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {expanded && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}
