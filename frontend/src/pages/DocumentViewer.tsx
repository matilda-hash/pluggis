import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import DOMPurify from 'dompurify'
import {
  ArrowLeft, Highlighter, X, RefreshCw, Check, BookOpen, Trash2,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import type { Document, Highlight, HighlightPriority, Deck, GeneratedCard } from '../types'
import { documentsApi, decksApi } from '../services/api'

// ── Priority config ────────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<HighlightPriority, { label: string; color: string; bg: string; mark: string }> = {
  important: { label: 'Viktig',   color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200', mark: 'mark-important' },
  difficult: { label: 'Svår',     color: 'text-red-700',    bg: 'bg-red-50 border-red-200',       mark: 'mark-difficult' },
  low:       { label: 'Låg prio', color: 'text-blue-600',   bg: 'bg-blue-50 border-blue-200',     mark: 'mark-low' },
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DocumentViewer() {
  const { docId } = useParams<{ docId: string }>()
  const navigate = useNavigate()
  const contentRef = useRef<HTMLDivElement>(null)

  const [doc, setDoc] = useState<Document | null>(null)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [decks, setDecks] = useState<Deck[]>([])
  const [loading, setLoading] = useState(true)

  const [activeHighlightPriority, setActiveHighlightPriority] = useState<HighlightPriority>('important')
  const [selectedHighlightIds, setSelectedHighlightIds] = useState<number[]>([])
  const [showGeneratePanel, setShowGeneratePanel] = useState(false)
  const [selectedDeckId, setSelectedDeckId] = useState<number | ''>('')
  const [numCards, setNumCards] = useState(20)
  const [generating, setGenerating] = useState(false)
  const [previewCards, setPreviewCards] = useState<GeneratedCard[] | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [showHighlightPanel, setShowHighlightPanel] = useState(true)

  const id = Number(docId)

  useEffect(() => {
    if (!id) return
    Promise.all([
      documentsApi.get(id),
      documentsApi.listHighlights(id),
      decksApi.list(),
    ]).then(([docData, hlData, decksData]) => {
      setDoc(docData)
      setHighlights(hlData)
      setDecks(decksData)
    }).finally(() => setLoading(false))
  }, [id])

  // Apply highlight marks to rendered HTML
  useEffect(() => {
    if (!contentRef.current || !highlights.length) return
    applyHighlightMarks(contentRef.current, highlights)
  }, [highlights, doc])

  // Text selection handler for creating highlights
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    const text = selection.toString().trim()
    if (text.length < 3) return

    const range = selection.getRangeAt(0)
    const container = contentRef.current
    if (!container || !container.contains(range.commonAncestorContainer)) return

    // Get block IDs from surrounding elements
    const startEl = _closestBlockEl(range.startContainer)
    const endEl = _closestBlockEl(range.endContainer)
    const rangeStart = startEl ? `${startEl.dataset.blockId}:${range.startOffset}` : undefined
    const rangeEnd = endEl ? `${endEl.dataset.blockId}:${range.endOffset}` : undefined

    selection.removeAllRanges()

    documentsApi.addHighlight(id, {
      priority: activeHighlightPriority,
      text_content: text,
      html_range_start: rangeStart,
      html_range_end: rangeEnd,
    }).then(newHighlight => {
      setHighlights(prev => [...prev, newHighlight])
    }).catch(console.error)
  }, [id, activeHighlightPriority])

  async function deleteHighlight(hid: number) {
    await documentsApi.deleteHighlight(id, hid)
    setHighlights(prev => prev.filter(h => h.id !== hid))
    setSelectedHighlightIds(prev => prev.filter(x => x !== hid))
  }

  async function handleGenerate() {
    if (!selectedDeckId) { alert('Välj en lek.'); return }
    setGenerating(true)
    setPreviewCards(null)
    try {
      const result = await documentsApi.generateCards(id, {
        highlight_ids: selectedHighlightIds.length > 0 ? selectedHighlightIds : undefined,
        deck_id: Number(selectedDeckId),
        num_cards: numCards,
      })
      setPreviewCards(result.cards)
    } catch (e) {
      console.error(e)
      alert('Kortgenerering misslyckades.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleConfirm() {
    if (!previewCards || !selectedDeckId) return
    setConfirming(true)
    try {
      await documentsApi.confirmCards(id, Number(selectedDeckId), previewCards)
      setPreviewCards(null)
      setShowGeneratePanel(false)
      alert(`${previewCards.length} kort sparade!`)
    } finally {
      setConfirming(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw size={24} className="animate-spin text-primary-500" />
    </div>
  )
  if (!doc) return <div className="text-center py-12 text-gray-500">Dokument hittades inte.</div>

  const safeHtml = DOMPurify.sanitize(doc.html_content, {
    ALLOWED_TAGS: ['div','p','h1','h2','h3','h4','ul','ol','li','table','tr','th','td','figure','strong','em','span','mark','br'],
    ALLOWED_ATTR: ['class','data-page','data-block-id','data-highlight-id','style'],
  })

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => navigate('/documents')} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft size={16} /> Tillbaka
        </button>
        <h1 className="text-xl font-bold text-gray-900 flex-1 truncate">{doc.title}</h1>

        {/* Priority selector */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          {(Object.keys(PRIORITY_CONFIG) as HighlightPriority[]).map(p => (
            <button
              key={p}
              onClick={() => setActiveHighlightPriority(p)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeHighlightPriority === p
                  ? `${PRIORITY_CONFIG[p].bg} ${PRIORITY_CONFIG[p].color} border`
                  : 'text-gray-600 hover:bg-white'
              }`}
            >
              <Highlighter size={13} />
              {PRIORITY_CONFIG[p].label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowGeneratePanel(v => !v)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
          disabled={highlights.length === 0}
        >
          <BookOpen size={14} />
          Generera kort ({highlights.length} markeringar)
        </button>
      </div>

      <div className="flex gap-6">
        {/* Document content */}
        <div className="flex-1 min-w-0">
          <div
            ref={contentRef}
            className="bg-white border border-gray-200 rounded-2xl p-8 document-content"
            onMouseUp={handleMouseUp}
            style={{ userSelect: 'text' }}
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        </div>

        {/* Right sidebar */}
        <div className="w-72 shrink-0 space-y-4">
          {/* Highlight panel */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-4 font-semibold text-gray-900 hover:bg-gray-50"
              onClick={() => setShowHighlightPanel(v => !v)}
            >
              <span>Markeringar ({highlights.length})</span>
              {showHighlightPanel ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {showHighlightPanel && (
              <div className="border-t divide-y max-h-80 overflow-y-auto">
                {highlights.length === 0 ? (
                  <p className="p-4 text-sm text-gray-400 text-center">
                    Välj text i dokumentet för att markera.
                  </p>
                ) : highlights.map(h => {
                  const cfg = PRIORITY_CONFIG[h.priority]
                  const checked = selectedHighlightIds.includes(h.id)
                  return (
                    <div key={h.id} className="p-3 flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSelectedHighlightIds(prev =>
                          checked ? prev.filter(x => x !== h.id) : [...prev, h.id]
                        )}
                        className="mt-0.5 rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color}`}>
                          {cfg.label}
                        </span>
                        <p className="text-xs text-gray-700 mt-1 line-clamp-2">{h.text_content}</p>
                      </div>
                      <button
                        onClick={() => deleteHighlight(h.id)}
                        className="text-gray-400 hover:text-red-500 p-0.5 shrink-0"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Generate panel */}
          {showGeneratePanel && (
            <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
              <h3 className="font-semibold text-gray-900">Generera kort</h3>
              {selectedHighlightIds.length > 0 && (
                <p className="text-xs text-primary-600">{selectedHighlightIds.length} valda markeringar</p>
              )}
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Lek</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  value={selectedDeckId}
                  onChange={e => setSelectedDeckId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">Välj lek...</option>
                  {decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Antal kort: {numCards}</label>
                <input
                  type="range" min={5} max={80} value={numCards}
                  onChange={e => setNumCards(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating || !selectedDeckId}
                className="w-full py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {generating ? <RefreshCw size={14} className="animate-spin" /> : <BookOpen size={14} />}
                {generating ? 'Genererar...' : 'Generera'}
              </button>

              {/* Preview */}
              {previewCards && (
                <div className="border-t pt-3 space-y-2">
                  <p className="text-xs font-medium text-gray-700">{previewCards.length} kort genererade</p>
                  <div className="max-h-48 overflow-y-auto space-y-2">
                    {previewCards.slice(0, 5).map((card, i) => (
                      <div key={i} className="text-xs bg-gray-50 rounded p-2">
                        <span className="text-gray-400 uppercase text-[10px]">{card.card_type}</span>
                        <p className="text-gray-800 font-medium">{card.front || card.cloze_text}</p>
                      </div>
                    ))}
                    {previewCards.length > 5 && (
                      <p className="text-xs text-gray-400 text-center">+{previewCards.length - 5} fler</p>
                    )}
                  </div>
                  <button
                    onClick={handleConfirm}
                    disabled={confirming}
                    className="w-full py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {confirming ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                    Spara alla kort
                  </button>
                  <button onClick={() => setPreviewCards(null)} className="w-full py-1.5 text-xs text-gray-500 hover:underline">
                    Avbryt
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Document styles */}
      <style>{`
        .document-content .pdf-page { margin-bottom: 2rem; }
        .document-content h1 { font-size: 1.5rem; font-weight: 700; margin: 1rem 0 0.5rem; }
        .document-content h2 { font-size: 1.25rem; font-weight: 600; margin: 0.75rem 0 0.4rem; }
        .document-content h3 { font-size: 1.1rem; font-weight: 600; margin: 0.6rem 0 0.3rem; }
        .document-content p { margin: 0.3rem 0; line-height: 1.7; font-size: 0.95rem; }
        .document-content table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }
        .document-content th, .document-content td { border: 1px solid #e5e7eb; padding: 6px 10px; font-size: 0.85rem; }
        .document-content th { background: #f9fafb; font-weight: 600; }
        .document-content mark { padding: 1px 2px; border-radius: 2px; }
        .mark-important { background-color: #fef08a; }
        .mark-difficult { background-color: #fecaca; }
        .mark-low { background-color: #bfdbfe; }
      `}</style>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _closestBlockEl(node: Node): HTMLElement | null {
  let el: Node | null = node
  while (el) {
    if (el instanceof HTMLElement && el.dataset?.blockId) return el
    el = el.parentNode
  }
  return null
}

function applyHighlightMarks(container: HTMLElement, highlights: Highlight[]) {
  // Remove existing marks
  container.querySelectorAll('mark[data-highlight-id]').forEach(m => {
    const parent = m.parentNode
    if (parent) {
      parent.replaceChild(document.createTextNode(m.textContent || ''), m)
      parent.normalize()
    }
  })

  // Apply new marks by searching for text content
  for (const h of highlights) {
    const cfg = PRIORITY_CONFIG[h.priority]
    const text = h.text_content
    if (!text || text.length < 3) continue
    _markText(container, text, h.id, cfg.mark)
  }
}

function _markText(container: HTMLElement, searchText: string, id: number, className: string) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const idx = node.textContent?.indexOf(searchText) ?? -1
    if (idx === -1) continue
    const range = document.createRange()
    range.setStart(node, idx)
    range.setEnd(node, idx + searchText.length)
    const mark = document.createElement('mark')
    mark.className = className
    mark.dataset.highlightId = String(id)
    try {
      range.surroundContents(mark)
    } catch {
      // Surrounds can fail if range crosses element boundaries; skip
    }
    break // only mark first occurrence
  }
}
