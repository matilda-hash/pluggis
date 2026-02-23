import { useState, useEffect } from 'react'
import type { Card, CardType } from '../../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const STATE_LABELS: Record<number, string> = {
  0: 'Ny',
  1: 'Lär sig',
  2: 'Repetition',
  3: 'Åter-lär',
}

interface TypeMeta {
  badge: string
  frontLabel: string
  backLabel: string
}

const TYPE_META: Record<CardType, TypeMeta> = {
  basic:              { badge: 'Grundläggande',      frontLabel: 'Fråga',       backLabel: 'Svar'        },
  cloze:              { badge: 'Lucka',               frontLabel: '',            backLabel: ''            },
  image_occlusion:    { badge: 'Bild',                frontLabel: 'Bild',        backLabel: 'Svar'        },
  definition_to_term: { badge: 'Definition → Term',   frontLabel: 'Definition',  backLabel: 'Term'        },
  term_to_definition: { badge: 'Term → Definition',   frontLabel: 'Term',        backLabel: 'Definition'  },
  single_cloze:       { badge: 'Enkel lucka',         frontLabel: '',            backLabel: ''            },
  multi_cloze:        { badge: 'Fler luckor',         frontLabel: '',            backLabel: ''            },
  true_false:         { badge: 'Sant / Falskt',        frontLabel: 'Påstående',   backLabel: 'Svar'        },
  cause_effect:       { badge: 'Orsak → Effekt',      frontLabel: 'Orsak',       backLabel: 'Effekt'      },
  effect_cause:       { badge: 'Effekt → Orsak',      frontLabel: 'Effekt',      backLabel: 'Orsak'       },
  light_scenario:     { badge: 'Scenario',             frontLabel: 'Scenario',    backLabel: 'Svar'        },
  process_sequence:   { badge: 'Process',              frontLabel: 'Process',     backLabel: 'Steg'        },
  contrast_comparison:{ badge: 'Jämförelse',           frontLabel: 'Begrepp',     backLabel: 'Jämförelse'  },
  numerical_recall:   { badge: 'Numerisk',             frontLabel: 'Fråga',       backLabel: 'Värde'       },
}

const TYPE_BADGE_COLOR: Record<CardType, string> = {
  basic:               'bg-gray-100 text-gray-600',
  cloze:               'bg-gray-100 text-gray-600',
  image_occlusion:     'bg-gray-100 text-gray-600',
  single_cloze:        'bg-gray-100 text-gray-600',
  multi_cloze:         'bg-gray-100 text-gray-600',
  definition_to_term:  'bg-purple-100 text-purple-700',
  term_to_definition:  'bg-purple-100 text-purple-700',
  true_false:          'bg-amber-100 text-amber-700',
  cause_effect:        'bg-orange-100 text-orange-700',
  effect_cause:        'bg-orange-100 text-orange-700',
  light_scenario:      'bg-teal-100 text-teal-700',
  process_sequence:    'bg-blue-100 text-blue-700',
  contrast_comparison: 'bg-indigo-100 text-indigo-700',
  numerical_recall:    'bg-green-100 text-green-700',
}

const CLOZE_TYPES = new Set<CardType>(['cloze', 'single_cloze', 'multi_cloze'])

function estimateIntervals(stability: number, state: number): Record<1 | 2 | 3 | 4, string> {
  if (state === 2) {
    const s = Math.max(1, stability)
    return {
      1: '1 dag',
      2: `~${Math.max(1, Math.round(s * 0.8))} d`,
      3: `~${Math.max(1, Math.round(s))} d`,
      4: `~${Math.max(2, Math.round(s * 1.3))} d`,
    }
  }
  if (state === 3) return { 1: '5 min', 2: '10 min', 3: '1 dag', 4: '2 dagar' }
  return { 1: '1 min', 2: '5 min', 3: '10 min', 4: '4 dagar' }
}

const RATING_CONFIG = [
  { rating: 1 as const, label: 'Igen',  key: '1', color: 'bg-red-50 text-red-600 hover:bg-red-100 border-red-200' },
  { rating: 2 as const, label: 'Svårt', key: '2', color: 'bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200' },
  { rating: 3 as const, label: 'Bra',   key: '3', color: 'bg-green-50 text-green-700 hover:bg-green-100 border-green-200' },
  { rating: 4 as const, label: 'Lätt',  key: '4', color: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200' },
]

// ─── Sub-components ───────────────────────────────────────────────────────────

function ClozeDisplay({ text, revealed }: { text: string; revealed: boolean }) {
  const parts = text.split(/(\{\{[^}]+\}\})/g)
  return (
    <span>
      {parts.map((part, i) => {
        const match = part.match(/^\{\{(.+)\}\}$/)
        if (match) {
          return revealed ? (
            <span key={i} className="text-primary-600 font-semibold border-b-2 border-primary-400 px-0.5">
              {match[1]}
            </span>
          ) : (
            <span
              key={i}
              className="inline-block bg-gray-800 text-gray-800 rounded px-2 min-w-[60px] text-center select-none"
              style={{ minWidth: `${match[1].length * 0.6}em` }}
            >
              {match[1]}
            </span>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}

function TypeBadge({ type }: { type: CardType }) {
  const meta = TYPE_META[type] ?? TYPE_META.basic
  const color = TYPE_BADGE_COLOR[type] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${color}`}>
      {meta.badge}
    </span>
  )
}

function ProcessBack({ text }: { text: string }) {
  const steps = text.split('\n').filter(s => s.trim())
  if (steps.length <= 1) return <p className="text-lg text-gray-800 leading-relaxed">{text}</p>
  return (
    <ol className="text-left space-y-2 w-full max-w-md mx-auto">
      {steps.map((step, i) => {
        const content = step.replace(/^\d+[.)]\s*/, '')
        return (
          <li key={i} className="flex gap-3 items-start">
            <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold flex items-center justify-center mt-0.5">
              {i + 1}
            </span>
            <span className="text-gray-800 leading-relaxed">{content}</span>
          </li>
        )
      })}
    </ol>
  )
}

function TrueFalseBack({ text }: { text: string }) {
  const lower = text.toLowerCase().trim()
  const isFalse = lower.startsWith('falskt') || lower.startsWith('false') || lower === 'f'
  const isTrue  = lower.startsWith('sant')   || lower.startsWith('true')  || lower === 't'

  const stripVerdict = (t: string) =>
    t.replace(/^(falskt|false|sant|true)[.:]?\s*/i, '').trim()

  if (isFalse) {
    const explanation = stripVerdict(text)
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="text-4xl font-bold text-red-500">Falskt</div>
        {explanation && <p className="text-gray-700 text-sm leading-relaxed max-w-sm text-center">{explanation}</p>}
      </div>
    )
  }
  if (isTrue) {
    const explanation = stripVerdict(text)
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="text-4xl font-bold text-green-600">Sant</div>
        {explanation && <p className="text-gray-700 text-sm leading-relaxed max-w-sm text-center">{explanation}</p>}
      </div>
    )
  }
  return <p className="text-lg text-gray-800 leading-relaxed">{text}</p>
}

function ContrastBack({ text }: { text: string }) {
  const lines = text.split('\n').filter(s => s.trim())
  const hasTable = lines.some(l => l.includes('|'))
  if (hasTable) {
    return (
      <div className="w-full max-w-md mx-auto text-sm border border-gray-200 rounded-lg overflow-hidden">
        {lines.map((line, i) => {
          const cols = line.split('|').map(c => c.trim()).filter(Boolean)
          if (cols.length >= 2) {
            return (
              <div key={i} className={`flex divide-x divide-gray-200 ${i === 0 ? 'font-semibold bg-gray-50' : 'border-t border-gray-200'}`}>
                {cols.map((col, j) => (
                  <div key={j} className="flex-1 px-3 py-2 text-left text-gray-800">{col}</div>
                ))}
              </div>
            )
          }
          return <p key={i} className="text-gray-800 px-3 py-1">{line}</p>
        })}
      </div>
    )
  }
  return <p className="text-lg text-gray-800 leading-relaxed">{text}</p>
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  card: Card
  onRate: (rating: 1 | 2 | 3 | 4) => void
  progress: { current: number; total: number }
}

export default function Flashcard({ card, onRate, progress }: Props) {
  const [revealed, setReveal] = useState(false)

  useEffect(() => { setReveal(false) }, [card.id])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === ' ' && !revealed) { e.preventDefault(); setReveal(true) }
      if (revealed && ['1', '2', '3', '4'].includes(e.key)) onRate(parseInt(e.key) as 1 | 2 | 3 | 4)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [revealed, onRate])

  const state     = card.state?.state ?? 0
  const stability = card.state?.stability ?? 1
  const cardType  = card.card_type as CardType
  const isCloze   = CLOZE_TYPES.has(cardType)
  const meta      = TYPE_META[cardType] ?? TYPE_META.basic
  const intervals = estimateIntervals(stability, state)
  const showBadge = cardType !== 'basic' && cardType !== 'cloze'

  function renderBack() {
    const text = card.back ?? ''
    switch (cardType) {
      case 'true_false':          return <TrueFalseBack text={text} />
      case 'process_sequence':    return <ProcessBack text={text} />
      case 'contrast_comparison': return <ContrastBack text={text} />
      default:                    return <p className="text-lg text-gray-800 leading-relaxed">{text}</p>
    }
  }

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Progress bar */}
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
          <span>{progress.current} / {progress.total}</span>
          <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs">
            {STATE_LABELS[state]}
          </span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-500 rounded-full transition-all"
            style={{ width: `${(progress.current / Math.max(1, progress.total)) * 100}%` }}
          />
        </div>
      </div>

      {/* Card */}
      <div className="w-full max-w-2xl perspective-1000">
        <div className={`flashcard-inner relative ${revealed && !isCloze ? 'flipped' : ''}`}>

          {/* Front face */}
          <div
            className={`flashcard-face card p-10 min-h-[240px] flex flex-col items-center justify-center text-center cursor-pointer select-none ${revealed && !isCloze ? 'absolute inset-0' : ''}`}
            onClick={() => !revealed && setReveal(true)}
          >
            {showBadge && <div className="mb-4"><TypeBadge type={cardType} /></div>}
            {meta.frontLabel && !isCloze && (
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-3">{meta.frontLabel}</div>
            )}

            {isCloze ? (
              <p className="text-lg text-gray-800 leading-relaxed">
                <ClozeDisplay text={card.cloze_text ?? ''} revealed={revealed} />
              </p>
            ) : (
              <p className="text-xl font-medium text-gray-800 leading-relaxed">{card.front}</p>
            )}

            {!revealed && (
              <p className="text-xs text-gray-400 mt-6">
                {isCloze
                  ? 'Klicka eller tryck Mellanslag för att avslöja'
                  : 'Klicka eller tryck Mellanslag för att visa svar'}
              </p>
            )}
          </div>

          {/* Back face (all non-cloze types) */}
          {!isCloze && (
            <div className="flashcard-face flashcard-back card p-10 min-h-[240px] flex flex-col items-center justify-center text-center">
              {showBadge && <div className="mb-4"><TypeBadge type={cardType} /></div>}
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-4">
                {meta.backLabel || 'Svar'}
              </div>
              {renderBack()}
              {card.state && (
                <div className="mt-6 flex gap-4 text-xs text-gray-400">
                  <span>Stabilitet: {card.state.stability.toFixed(1)}d</span>
                  <span>Fel: {card.state.lapses}</span>
                  <span>Reps: {card.state.reps}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Rating buttons */}
      {revealed && (
        <div className="flex gap-3 w-full max-w-2xl animate-fade-in">
          {RATING_CONFIG.map(({ rating, label, key, color }) => (
            <button
              key={rating}
              onClick={() => onRate(rating)}
              className={`flex-1 py-3 px-4 rounded-xl border font-semibold text-sm transition-all ${color}`}
            >
              {label}
              <span className="block text-xs font-normal opacity-70 mt-0.5">{intervals[rating]}</span>
              <span className="block text-xs font-normal opacity-40">[{key}]</span>
            </button>
          ))}
        </div>
      )}

      {/* Show answer button */}
      {!revealed && (
        <button
          onClick={() => setReveal(true)}
          className="btn-secondary px-8 py-3 text-sm font-medium"
        >
          Visa svar <span className="opacity-50 ml-2">[Mellanslag]</span>
        </button>
      )}
    </div>
  )
}
