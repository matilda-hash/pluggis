import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, Calendar, RefreshCw, Plus,
  Clock, BookOpen, RotateCcw, FileText, Zap, AlertCircle, Wifi, WifiOff,
  MapPin, Star, Trash2, Pencil, X, Check, Briefcase, List,
  CalendarDays, Upload, CheckCircle,
} from 'lucide-react'
import type {
  BlockPlan, StudyBlock, Lecture, LectureCreate,
  AnkiStatus, BlockStatus, CalendarEvent, CalendarStatus,
} from '../types'
import { scheduleApi, ankiApi, calendarApi } from '../services/api'

// ── Time constants ────────────────────────────────────────────────────────────
const DAY_START = 8
const DAY_END = 17
const HOURS = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i)
const TOTAL_MINUTES = (DAY_END - DAY_START) * 60
const WEEK_HOUR_PX = 64   // px per hour in week timeline
const FIVE_HOUR_PX = 22   // px per hour in 5-week mini timeline

// ── Styling ───────────────────────────────────────────────────────────────────
const BLOCK_CFG: Record<string, {
  label: string; gradient: string; light: string; border: string; icon: React.FC<{ size?: number }>
}> = {
  pre_lecture:      { label: 'Förberedelse',  gradient: 'from-blue-500 to-indigo-600',   light: 'bg-blue-50 text-blue-800',    border: 'border-l-blue-500',    icon: BookOpen },
  post_lecture:     { label: 'Genomgång',     gradient: 'from-purple-500 to-violet-600', light: 'bg-purple-50 text-purple-800', border: 'border-l-purple-500',  icon: FileText },
  daily_repetition: { label: 'Repetition',    gradient: 'from-emerald-500 to-green-600', light: 'bg-emerald-50 text-emerald-800', border: 'border-l-emerald-500', icon: RotateCcw },
  reading:          { label: 'Läsning',       gradient: 'from-amber-400 to-orange-500',  light: 'bg-amber-50 text-amber-800',   border: 'border-l-amber-500',   icon: BookOpen },
  activation:       { label: 'Aktivering',    gradient: 'from-orange-400 to-rose-500',   light: 'bg-orange-50 text-orange-800', border: 'border-l-orange-500',  icon: Zap },
}

const CAL_CFG: Record<string, { bg: string; text: string; label: string }> = {
  work:     { bg: 'bg-slate-300/70',   text: 'text-slate-700', label: 'Jobb' },
  lecture:  { bg: 'bg-indigo-200/70',  text: 'text-indigo-800', label: 'Föreläsning' },
  training: { bg: 'bg-rose-200/70',    text: 'text-rose-800',  label: 'Träning' },
  vfu:      { bg: 'bg-teal-200/70',    text: 'text-teal-800',  label: 'VFU' },
  other:    { bg: 'bg-gray-200/60',    text: 'text-gray-700',  label: '' },
}

const STATUS_LABELS: Record<BlockStatus, string> = {
  planned: 'Planerad', started: 'Pågår', done: 'Klar', skipped: 'Hoppades över',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function toIso(d: Date) { return d.toISOString().split('T')[0] }

function formatTime(iso: string | null) {
  if (!iso) return '–'
  return new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
}

function getWeekStart(date: Date): Date {
  const d = new Date(date); d.setHours(0, 0, 0, 0)
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay()
  d.setDate(d.getDate() + diff)
  return d
}

function getWeekDays(date: Date): Date[] {
  const start = getWeekStart(date)
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
}

function getFiveWeeks(anchorDate: Date): Date[][] {
  const start = getWeekStart(anchorDate)
  return Array.from({ length: 5 }, (_, w) => {
    return Array.from({ length: 7 }, (_, d) => {
      const day = new Date(start)
      day.setDate(start.getDate() + w * 7 + d)
      return day
    })
  })
}

/** Convert a datetime ISO string to minutes from midnight. */
function isoToMinutes(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

/** Top offset (px) for a given ISO time in the timeline. */
function timeToTop(iso: string, hourPx: number): number {
  const mins = isoToMinutes(iso) - DAY_START * 60
  return Math.max(0, (mins / 60) * hourPx)
}

/** Height (px) for a duration in minutes. */
function durationToHeight(mins: number, hourPx: number): number {
  return Math.max(4, (mins / 60) * hourPx)
}

/** Clamp a block to the visible 8-17 window. */
function clampToWindow(startIso: string, endIso: string) {
  const s = Math.max(isoToMinutes(startIso), DAY_START * 60)
  const e = Math.min(isoToMinutes(endIso), DAY_END * 60)
  return { top: ((s - DAY_START * 60) / 60), height: Math.max(0, (e - s) / 60) }
}

type ViewMode = 'day' | 'week' | 'fiveweek'
const WEEKDAY_SHORT = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön']

// ── Main Schedule component ────────────────────────────────────────────────────

export default function Schedule() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [plan, setPlan] = useState<BlockPlan | null>(null)
  const [savedBlocks, setSavedBlocks] = useState<StudyBlock[]>([])
  const [rangeBlocks, setRangeBlocks] = useState<StudyBlock[]>([])
  const [calEvents, setCalEvents] = useState<CalendarEvent[]>([])
  const [lectures, setLectures] = useState<Lecture[]>([])
  const [ankiStatus, setAnkiStatus] = useState<AnkiStatus>({ available: false, version: null })
  const [calStatus, setCalStatus] = useState<CalendarStatus>({ authenticated: false, email: null })
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pushMsg, setPushMsg] = useState('')
  const [showLectureForm, setShowLectureForm] = useState(false)
  const [editingLecture, setEditingLecture] = useState<Lecture | null>(null)
  const [expandedBlock, setExpandedBlock] = useState<number | null>(null)
  const [postWorkEnabled, setPostWorkEnabled] = useState(false)
  const [postWorkMinutes, setPostWorkMinutes] = useState(30)
  const navigate = useNavigate()

  const dateStr = toIso(currentDate)
  const weekDays = getWeekDays(currentDate)
  const fiveWeeks = getFiveWeeks(currentDate)
  const todayStr = toIso(new Date())

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadDay = useCallback(async () => {
    setLoading(true)
    try {
      const [planData, blocksData, lecturesData, ankiData, calData] = await Promise.all([
        scheduleApi.day(dateStr).catch(() => null),
        scheduleApi.blocks(dateStr, dateStr).catch(() => []),
        scheduleApi.lectures().catch(() => []),
        ankiApi.status().catch(() => ({ available: false, version: null })),
        calendarApi.status().catch(() => ({ authenticated: false, email: null })),
      ])
      setPlan(planData)
      setSavedBlocks(Array.isArray(blocksData) ? blocksData : [])
      setLectures(Array.isArray(lecturesData) ? lecturesData : [])
      setAnkiStatus(ankiData)
      setCalStatus(calData)
    } finally { setLoading(false) }
  }, [dateStr])

  const loadRange = useCallback(async (startDate: Date, endDate: Date) => {
    setLoading(true)
    const start = toIso(startDate)
    const end = toIso(endDate)
    try {
      const [blocks, events, lecturesData, calData] = await Promise.all([
        scheduleApi.blocks(start, end).catch(() => []),
        calendarApi.events(start + 'T00:00:00', end + 'T23:59:59').catch(() => []),
        scheduleApi.lectures().catch(() => []),
        calendarApi.status().catch(() => ({ authenticated: false, email: null })),
      ])
      setRangeBlocks(Array.isArray(blocks) ? blocks : [])
      setCalEvents(Array.isArray(events) ? events : [])
      setLectures(Array.isArray(lecturesData) ? lecturesData : [])
      setCalStatus(calData)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (viewMode === 'day') {
      loadDay()
    } else if (viewMode === 'week') {
      loadRange(weekDays[0], weekDays[6])
    } else {
      const weeks = getFiveWeeks(currentDate)
      loadRange(weeks[0][0], weeks[4][6])
    }
  }, [viewMode, currentDate])

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function generate(morningActivation = false) {
    setGenerating(true)
    try {
      const result = await scheduleApi.generate({
        date: dateStr,
        morning_activation: morningActivation,
        post_work_minutes: postWorkEnabled ? postWorkMinutes : 0,
      })
      setPlan(result)
      setSavedBlocks(result.blocks)
    } finally { setGenerating(false) }
  }

  async function syncCalendar() {
    setSyncing(true)
    try {
      await calendarApi.sync()
      if (viewMode === 'week') loadRange(weekDays[0], weekDays[6])
      else if (viewMode === 'fiveweek') {
        const weeks = getFiveWeeks(currentDate)
        loadRange(weeks[0][0], weeks[4][6])
      }
    } finally { setSyncing(false) }
  }

  async function pushToCalendar() {
    setPushing(true)
    setPushMsg('')
    try {
      let start: string, end: string
      if (viewMode === 'week') {
        start = toIso(weekDays[0]); end = toIso(weekDays[6])
      } else {
        const weeks = getFiveWeeks(currentDate)
        start = toIso(weeks[0][0]); end = toIso(weeks[4][6])
      }
      const res = await calendarApi.pushBlocks(start, end)
      setPushMsg(`${res.pushed} block skickade till Google Kalender`)
      // refresh to update google_event_id indicators
      if (viewMode === 'week') loadRange(weekDays[0], weekDays[6])
    } catch {
      setPushMsg('Misslyckades – kontrollera anslutning')
    } finally {
      setPushing(false)
      setTimeout(() => setPushMsg(''), 4000)
    }
  }

  async function updateStatus(blockId: number, status: BlockStatus) {
    if (blockId === 0) return
    await scheduleApi.updateBlock(blockId, status)
    setSavedBlocks(prev => prev.map(b => b.id === blockId ? { ...b, status } : b))
  }

  async function deleteBlock(blockId: number) {
    if (blockId === 0) return
    await scheduleApi.deleteBlock(blockId)
    setSavedBlocks(prev => prev.filter(b => b.id !== blockId))
  }

  // ── Navigation ───────────────────────────────────────────────────────────────
  function goBack() {
    setCurrentDate(d => {
      const n = new Date(d)
      n.setDate(n.getDate() - (viewMode === 'day' ? 1 : viewMode === 'week' ? 7 : 35))
      return n
    })
  }
  function goForward() {
    setCurrentDate(d => {
      const n = new Date(d)
      n.setDate(n.getDate() + (viewMode === 'day' ? 1 : viewMode === 'week' ? 7 : 35))
      return n
    })
  }

  const weekStart = weekDays[0], weekEnd = weekDays[6]
  const weekLabel = weekStart.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })
    + ' – ' + weekEnd.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' })

  const displayBlocks = savedBlocks.length > 0 ? savedBlocks : (plan?.blocks ?? [])
  const todayLectures = lectures.filter(l => l.lecture_date.startsWith(dateStr))

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 min-h-screen">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-primary-500 to-indigo-600 rounded-xl shadow">
            <Calendar size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Schema</h1>
            <p className="text-xs text-gray-500">Studieplanering med AI</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* View mode */}
          <div className="flex items-center bg-gray-100 rounded-xl p-1 text-sm">
            {(['day', 'week', 'fiveweek'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                  viewMode === mode
                    ? 'bg-white shadow text-primary-700'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {mode === 'day' && <><List size={13} /> Dag</>}
                {mode === 'week' && <><Calendar size={13} /> Vecka</>}
                {mode === 'fiveweek' && <><CalendarDays size={13} /> 5 veckor</>}
              </button>
            ))}
          </div>

          {/* Google Calendar controls */}
          {calStatus.authenticated && (
            <div className="flex items-center gap-2">
              <button
                onClick={syncCalendar}
                disabled={syncing}
                title="Importera händelser från Google Kalender"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-all"
              >
                <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                Synka
              </button>
              {viewMode !== 'day' && (
                <button
                  onClick={pushToCalendar}
                  disabled={pushing}
                  title="Skicka studieblock till Google Kalender"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gradient-to-r from-primary-600 to-indigo-600 text-white rounded-xl hover:opacity-90 disabled:opacity-50 transition-all shadow-sm"
                >
                  <Upload size={12} className={pushing ? 'animate-pulse' : ''} />
                  Skicka till GCal
                </button>
              )}
            </div>
          )}

          <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl border ${
            calStatus.authenticated
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-gray-50 border-gray-200 text-gray-500'
          }`}>
            {calStatus.authenticated ? <Wifi size={11} /> : <WifiOff size={11} />}
            {calStatus.authenticated ? (calStatus.email?.split('@')[0] ?? 'GCal') : 'Ej ansluten'}
          </div>

          <AnkiStatusBadge status={ankiStatus} />
        </div>
      </div>

      {/* Push message toast */}
      {pushMsg && (
        <div className="text-sm text-center py-2 px-4 bg-green-50 border border-green-200 text-green-700 rounded-xl">
          {pushMsg}
        </div>
      )}

      {/* ── Navigation ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
        <button onClick={goBack} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 text-center">
          {viewMode === 'day' ? (
            <span className="font-semibold text-gray-900">
              {currentDate.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              {dateStr === todayStr && <span className="ml-2 text-xs font-normal text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full">Idag</span>}
            </span>
          ) : viewMode === 'week' ? (
            <span className="font-semibold text-gray-900">{weekLabel}</span>
          ) : (
            <span className="font-semibold text-gray-900">
              {fiveWeeks[0][0].toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })}
              {' – '}
              {fiveWeeks[4][6].toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
        </div>
        <button onClick={goForward} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
          <ChevronRight size={18} />
        </button>
        <button
          onClick={() => setCurrentDate(new Date())}
          className="text-xs text-primary-600 hover:underline font-medium ml-1"
        >
          Idag
        </button>
      </div>

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      {viewMode !== 'day' && (
        <div className="flex items-center gap-3 flex-wrap px-1">
          {Object.entries(BLOCK_CFG).map(([type, cfg]) => (
            <div key={type} className="flex items-center gap-1.5 text-xs text-gray-500">
              <div className={`w-3 h-3 rounded bg-gradient-to-br ${cfg.gradient}`} />
              {cfg.label}
            </div>
          ))}
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <div className="w-3 h-3 rounded bg-slate-300/70" />
            Jobb/Händelse
          </div>
        </div>
      )}

      {/* ── Views ──────────────────────────────────────────────────────────── */}
      {viewMode === 'week' && (
        <WeekTimeline
          days={weekDays}
          blocks={rangeBlocks}
          calEvents={calEvents}
          loading={loading}
          todayStr={todayStr}
          onDayClick={d => { setCurrentDate(d); setViewMode('day') }}
          hourPx={WEEK_HOUR_PX}
        />
      )}

      {viewMode === 'fiveweek' && (
        <FiveWeekView
          weeks={fiveWeeks}
          blocks={rangeBlocks}
          calEvents={calEvents}
          loading={loading}
          todayStr={todayStr}
          onDayClick={d => { setCurrentDate(d); setViewMode('day') }}
        />
      )}

      {viewMode === 'day' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: schedule */}
          <div className="lg:col-span-2 space-y-4">
            {/* Generate controls */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => generate(false)}
                disabled={generating}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-600 to-indigo-600 text-white rounded-xl shadow-sm hover:opacity-90 disabled:opacity-50 font-medium text-sm transition-all"
              >
                <RefreshCw size={15} className={generating ? 'animate-spin' : ''} />
                {generating ? 'Genererar...' : 'Generera schema'}
              </button>
              <button
                onClick={() => generate(true)}
                disabled={generating}
                className="flex items-center gap-2 px-3 py-2 border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 disabled:opacity-50 text-sm transition-all"
              >
                <Zap size={13} /> Med morgonaktivering
              </button>
              {calStatus.authenticated && savedBlocks.length > 0 && (
                <button
                  onClick={async () => {
                    setPushing(true)
                    for (const b of savedBlocks) {
                      if (b.id && !b.google_event_id) await calendarApi.createBlock(b.id).catch(() => {})
                    }
                    setPushing(false)
                    await loadDay()
                  }}
                  disabled={pushing}
                  className="flex items-center gap-1.5 px-3 py-2 border border-primary-200 text-primary-700 bg-primary-50 rounded-xl hover:bg-primary-100 text-sm disabled:opacity-50 transition-all"
                >
                  <Upload size={13} className={pushing ? 'animate-pulse' : ''} />
                  Skicka till GCal
                </button>
              )}
            </div>

            {/* Post-work prompt */}
            {plan?.work_ends_at && (
              <PostWorkPrompt
                workEndsAt={plan.work_ends_at}
                enabled={postWorkEnabled}
                minutes={postWorkMinutes}
                onToggle={() => setPostWorkEnabled(v => !v)}
                onMinutesChange={setPostWorkMinutes}
              />
            )}

            {/* Summary */}
            {plan && (
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span className="flex items-center gap-1.5"><Clock size={13} /> {plan.total_minutes} min totalt</span>
                {plan.compression_applied && (
                  <span className="flex items-center gap-1 text-amber-600">
                    <AlertCircle size={13} /> Komprimerat
                  </span>
                )}
              </div>
            )}

            {/* Block list */}
            {loading ? (
              <div className="py-12 text-center text-gray-400">Laddar...</div>
            ) : displayBlocks.length === 0 ? (
              <EmptyDay />
            ) : (
              <div className="space-y-2.5">
                {displayBlocks.map((block, idx) => (
                  <StudyBlockCard
                    key={block.id || idx}
                    block={block}
                    expanded={expandedBlock === (block.id || idx)}
                    onToggle={() => setExpandedBlock(p => p === (block.id || idx) ? null : (block.id || idx))}
                    onStatusChange={s => updateStatus(block.id, s)}
                    onDelete={() => deleteBlock(block.id)}
                    onNavigatePreLecture={() => block.lecture_id && navigate(`/pre-lecture/${block.lecture_id}`)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Right: lectures */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Föreläsningar</h2>
              <button
                onClick={() => { setEditingLecture(null); setShowLectureForm(true) }}
                className="flex items-center gap-1 text-sm text-primary-600 hover:underline"
              >
                <Plus size={13} /> Lägg till
              </button>
            </div>
            {todayLectures.length === 0 ? (
              <p className="text-sm text-gray-400">Inga föreläsningar denna dag.</p>
            ) : (
              <div className="space-y-2">
                {todayLectures.map(l => (
                  <LectureCard
                    key={l.id}
                    lecture={l}
                    onEdit={() => { setEditingLecture(l); setShowLectureForm(true) }}
                    onDelete={async () => { await scheduleApi.deleteLecture(l.id); setLectures(p => p.filter(x => x.id !== l.id)) }}
                    onNavigate={() => navigate(`/pre-lecture/${l.id}`)}
                  />
                ))}
              </div>
            )}
            <div className="border-t pt-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Kommande</h3>
              <div className="space-y-1">
                {lectures
                  .filter(l => !l.lecture_date.startsWith(dateStr) && l.lecture_date > dateStr)
                  .slice(0, 5)
                  .map(l => (
                    <div key={l.id} className="text-sm text-gray-600 flex justify-between">
                      <span className="truncate">{l.title}</span>
                      <span className="text-gray-400 ml-2 whitespace-nowrap text-xs">
                        {new Date(l.lecture_date).toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lecture modal */}
      {showLectureForm && (
        <LectureFormModal
          initial={editingLecture}
          onClose={() => { setShowLectureForm(false); setEditingLecture(null) }}
          onSave={async (data) => {
            if (editingLecture) {
              const updated = await scheduleApi.updateLecture(editingLecture.id, data)
              setLectures(prev => prev.map(l => l.id === editingLecture.id ? updated : l))
            } else {
              const created = await scheduleApi.createLecture({ ...data, source: 'manual' })
              setLectures(prev => [...prev, created])
            }
            setShowLectureForm(false); setEditingLecture(null)
          }}
          defaultDate={dateStr}
        />
      )}
    </div>
  )
}

// ── Week timeline view ────────────────────────────────────────────────────────

function WeekTimeline({
  days, blocks, calEvents, loading, todayStr, onDayClick, hourPx,
}: {
  days: Date[]
  blocks: StudyBlock[]
  calEvents: CalendarEvent[]
  loading: boolean
  todayStr: string
  onDayClick: (d: Date) => void
  hourPx: number
}) {
  const totalHeight = (DAY_END - DAY_START) * hourPx
  const nowRef = useRef<HTMLDivElement>(null)

  // Group by day
  const blocksByDay: Record<string, StudyBlock[]> = {}
  for (const b of blocks) {
    const k = b.scheduled_date.split('T')[0]
    if (!blocksByDay[k]) blocksByDay[k] = []
    blocksByDay[k].push(b)
  }

  const eventsByDay: Record<string, CalendarEvent[]> = {}
  for (const e of calEvents) {
    const k = e.start_dt.split('T')[0]
    if (!eventsByDay[k]) eventsByDay[k] = []
    eventsByDay[k].push(e)
  }

  // Current time position
  const now = new Date()
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const nowTop = ((nowMins - DAY_START * 60) / 60) * hourPx

  if (loading) return <div className="py-16 text-center text-gray-400">Laddar schema...</div>

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Day headers */}
      <div className="grid border-b border-gray-100" style={{ gridTemplateColumns: '52px repeat(7, 1fr)' }}>
        <div className="py-3" />
        {days.map((day, i) => {
          const ds = toIso(day)
          const isToday = ds === todayStr
          const dayBlocks = blocksByDay[ds] ?? []
          const totalMins = dayBlocks.reduce((s, b) => s + b.duration_minutes, 0)
          return (
            <button
              key={ds}
              onClick={() => onDayClick(day)}
              className={`py-3 px-2 text-center border-l border-gray-100 transition-colors hover:bg-gray-50 ${
                isToday ? 'bg-primary-50' : ''
              }`}
            >
              <div className={`text-xs font-semibold mb-0.5 ${isToday ? 'text-primary-600' : 'text-gray-400'}`}>
                {WEEKDAY_SHORT[i]}
              </div>
              <div className={`text-lg font-bold leading-none ${isToday ? 'text-primary-700' : 'text-gray-800'}`}>
                {day.getDate()}
              </div>
              {totalMins > 0 && (
                <div className="text-xs text-gray-400 mt-1">
                  {totalMins >= 60 ? `${(totalMins / 60).toFixed(1)}h` : `${totalMins}m`}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Timeline grid */}
      <div className="flex overflow-x-auto">
        {/* Hour labels */}
        <div className="flex-shrink-0 w-[52px]" style={{ height: totalHeight }}>
          {HOURS.map(h => (
            <div
              key={h}
              className="relative"
              style={{ height: hourPx }}
            >
              <span className="absolute -top-2.5 right-2 text-[10px] text-gray-400 select-none font-mono">
                {String(h).padStart(2, '0')}
              </span>
            </div>
          ))}
          {/* Final hour label */}
          <div className="relative" style={{ height: 0 }}>
            <span className="absolute -top-2.5 right-2 text-[10px] text-gray-400 select-none font-mono">
              {String(DAY_END).padStart(2, '0')}
            </span>
          </div>
        </div>

        {/* Day columns */}
        <div className="flex-1 grid min-w-0" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {days.map((day, i) => {
            const ds = toIso(day)
            const isToday = ds === todayStr
            const dayBlocks = blocksByDay[ds] ?? []
            const dayEvents = eventsByDay[ds] ?? []
            return (
              <DayColumn
                key={ds}
                day={day}
                blocks={dayBlocks}
                events={dayEvents}
                isToday={isToday}
                hourPx={hourPx}
                totalHeight={totalHeight}
                nowTop={isToday ? nowTop : null}
                onClick={() => onDayClick(day)}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Single day column in timeline ─────────────────────────────────────────────

function DayColumn({
  day, blocks, events, isToday, hourPx, totalHeight, nowTop, onClick,
}: {
  day: Date
  blocks: StudyBlock[]
  events: CalendarEvent[]
  isToday: boolean
  hourPx: number
  totalHeight: number
  nowTop: number | null
  onClick: () => void
}) {
  return (
    <div
      className={`relative border-l border-gray-100 cursor-pointer group ${isToday ? 'bg-primary-50/30' : ''}`}
      style={{ height: totalHeight }}
      onClick={onClick}
    >
      {/* Hour grid lines */}
      {HOURS.map(h => (
        <div
          key={h}
          className="absolute left-0 right-0 border-t border-gray-100"
          style={{ top: (h - DAY_START) * hourPx }}
        />
      ))}

      {/* Calendar events (background) */}
      {events.map(evt => {
        if (!evt.start_dt || !evt.end_dt) return null
        const { top, height } = clampToWindow(evt.start_dt, evt.end_dt)
        if (height <= 0) return null
        const cfg = CAL_CFG[evt.event_type] ?? CAL_CFG.other
        return (
          <div
            key={evt.id}
            className={`absolute left-0.5 right-0.5 rounded-md ${cfg.bg} border border-white/50 overflow-hidden`}
            style={{ top: top * hourPx, height: Math.max(height * hourPx, 4), zIndex: 1 }}
          >
            <div className={`px-1.5 pt-0.5 text-[9px] font-semibold truncate ${cfg.text}`}>
              {evt.title || cfg.label}
            </div>
          </div>
        )
      })}

      {/* Study blocks */}
      {blocks.map((block, bi) => {
        if (!block.start_time || !block.end_time) return null
        const { top, height } = clampToWindow(block.start_time, block.end_time)
        if (height <= 0) return null
        const cfg = BLOCK_CFG[block.block_type] ?? BLOCK_CFG.reading
        const Icon = cfg.icon
        const isDone = block.status === 'done'
        const h = height * hourPx
        return (
          <div
            key={block.id || bi}
            className={`absolute left-1 right-1 rounded-lg bg-gradient-to-b ${cfg.gradient} shadow-sm overflow-hidden transition-transform group-hover:scale-[1.01] ${isDone ? 'opacity-50' : ''}`}
            style={{ top: top * hourPx + 1, height: Math.max(h - 2, 4), zIndex: 2 }}
            onClick={e => { e.stopPropagation() }}
          >
            <div className="px-1.5 pt-1 flex items-center gap-1">
              <Icon size={9} className="text-white/90 flex-shrink-0" />
              {h >= 20 && (
                <span className="text-[9px] font-semibold text-white/95 leading-tight truncate">
                  {cfg.label}
                </span>
              )}
            </div>
            {h >= 32 && (
              <div className="px-1.5 text-[8px] text-white/80 leading-tight">
                {formatTime(block.start_time)} – {formatTime(block.end_time)}
              </div>
            )}
            {block.google_event_id && h >= 20 && (
              <div className="absolute top-0.5 right-0.5">
                <div className="w-2 h-2 rounded-full bg-white/60" title="I Google Kalender" />
              </div>
            )}
          </div>
        )
      })}

      {/* Current time indicator */}
      {nowTop !== null && nowTop >= 0 && nowTop <= totalHeight && (
        <div
          className="absolute left-0 right-0 z-10 pointer-events-none"
          style={{ top: nowTop }}
        >
          <div className="h-0.5 bg-red-500 w-full relative">
            <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-red-500" />
          </div>
        </div>
      )}
    </div>
  )
}

// ── 5-week view ───────────────────────────────────────────────────────────────

function FiveWeekView({
  weeks, blocks, calEvents, loading, todayStr, onDayClick,
}: {
  weeks: Date[][]
  blocks: StudyBlock[]
  calEvents: CalendarEvent[]
  loading: boolean
  todayStr: string
  onDayClick: (d: Date) => void
}) {
  const hourPx = FIVE_HOUR_PX
  const totalHeight = (DAY_END - DAY_START) * hourPx

  const blocksByDay: Record<string, StudyBlock[]> = {}
  for (const b of blocks) {
    const k = b.scheduled_date.split('T')[0]
    if (!blocksByDay[k]) blocksByDay[k] = []
    blocksByDay[k].push(b)
  }

  const eventsByDay: Record<string, CalendarEvent[]> = {}
  for (const e of calEvents) {
    const k = e.start_dt.split('T')[0]
    if (!eventsByDay[k]) eventsByDay[k] = []
    eventsByDay[k].push(e)
  }

  if (loading) return <div className="py-16 text-center text-gray-400">Laddar 5-veckorsschema...</div>

  // Calculate total study hours across all 5 weeks
  const totalMins = blocks.reduce((s, b) => s + b.duration_minutes, 0)
  const doneBlocks = blocks.filter(b => b.status === 'done').length

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      {blocks.length > 0 && (
        <div className="flex items-center gap-4 text-sm text-gray-600 bg-white rounded-xl px-4 py-2.5 border border-gray-100 shadow-sm flex-wrap">
          <Clock size={13} />
          <span><strong>{(totalMins / 60).toFixed(1)} h</strong> planerat</span>
          <span className="text-gray-300">·</span>
          <span>{doneBlocks}/{blocks.length} block klara</span>
          <div className="flex-1 bg-gray-100 rounded-full h-1.5 max-w-xs min-w-[60px]">
            <div
              className="bg-gradient-to-r from-emerald-500 to-green-400 h-1.5 rounded-full transition-all"
              style={{ width: `${blocks.length ? Math.round(doneBlocks / blocks.length * 100) : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* 5-week grid */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Column headers (Mon–Sun) */}
        <div className="grid border-b border-gray-100" style={{ gridTemplateColumns: '44px repeat(7, 1fr)' }}>
          <div className="py-2 px-2 text-xs text-gray-400 font-semibold text-center">Vcka</div>
          {WEEKDAY_SHORT.map(dn => (
            <div key={dn} className="py-2 text-center text-xs font-semibold text-gray-500 border-l border-gray-100">
              {dn}
            </div>
          ))}
        </div>

        {/* Weeks */}
        {weeks.map((weekDays, wi) => {
          const weekNum = getISOWeekNumber(weekDays[0])
          return (
            <div
              key={wi}
              className="grid border-b border-gray-50 last:border-b-0"
              style={{ gridTemplateColumns: '44px repeat(7, 1fr)' }}
            >
              {/* Week number */}
              <div className="flex items-center justify-center py-1 text-xs text-gray-300 font-mono">
                {weekNum}
              </div>

              {/* Days */}
              {weekDays.map((day, di) => {
                const ds = toIso(day)
                const isToday = ds === todayStr
                const dayBlocks = blocksByDay[ds] ?? []
                const dayEvents = eventsByDay[ds] ?? []
                const dayMins = dayBlocks.reduce((s, b) => s + b.duration_minutes, 0)
                const isWeekend = di >= 5

                return (
                  <button
                    key={ds}
                    onClick={() => onDayClick(day)}
                    className={`border-l border-gray-100 p-1 text-left transition-all hover:bg-gray-50 hover:shadow-inner ${
                      isToday ? 'bg-primary-50/50' : isWeekend ? 'bg-gray-50/50' : ''
                    }`}
                  >
                    {/* Date label */}
                    <div className={`flex items-center justify-between mb-0.5 px-0.5 ${
                      isToday ? 'text-primary-700' : isWeekend ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      <span className="text-[9px] font-bold">{day.getDate()}</span>
                      {dayMins > 0 && (
                        <span className="text-[8px] opacity-70">
                          {dayMins >= 60 ? `${(dayMins / 60).toFixed(1)}h` : `${dayMins}m`}
                        </span>
                      )}
                    </div>

                    {/* Mini timeline */}
                    <div className="relative rounded overflow-hidden bg-gray-50" style={{ height: totalHeight }}>
                      {/* Hour lines */}
                      {HOURS.slice(0, -1).map(h => (
                        <div
                          key={h}
                          className="absolute left-0 right-0 border-t border-gray-200/50"
                          style={{ top: (h - DAY_START) * hourPx }}
                        />
                      ))}

                      {/* Calendar events */}
                      {dayEvents.map(evt => {
                        const { top, height } = clampToWindow(evt.start_dt, evt.end_dt)
                        if (height <= 0) return null
                        const cfg = CAL_CFG[evt.event_type] ?? CAL_CFG.other
                        return (
                          <div
                            key={evt.id}
                            className={`absolute left-0 right-0 ${cfg.bg}`}
                            style={{ top: top * hourPx, height: Math.max(height * hourPx, 2), zIndex: 1 }}
                          />
                        )
                      })}

                      {/* Study blocks */}
                      {dayBlocks.map((block, bi) => {
                        if (!block.start_time || !block.end_time) return null
                        const { top, height } = clampToWindow(block.start_time, block.end_time)
                        if (height <= 0) return null
                        const cfg = BLOCK_CFG[block.block_type] ?? BLOCK_CFG.reading
                        return (
                          <div
                            key={block.id || bi}
                            className={`absolute left-0 right-0 bg-gradient-to-b ${cfg.gradient} ${
                              block.status === 'done' ? 'opacity-40' : ''
                            }`}
                            style={{ top: top * hourPx, height: Math.max(height * hourPx, 2), zIndex: 2 }}
                          />
                        )
                      })}

                      {/* Today marker */}
                      {isToday && (() => {
                        const now = new Date()
                        const nowMins = now.getHours() * 60 + now.getMinutes()
                        if (nowMins < DAY_START * 60 || nowMins > DAY_END * 60) return null
                        const top = ((nowMins - DAY_START * 60) / 60) * hourPx
                        return (
                          <div
                            className="absolute left-0 right-0 h-px bg-red-500 z-10"
                            style={{ top }}
                          />
                        )
                      })()}
                    </div>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      <p className="text-xs text-gray-400 text-center">Klicka på en dag för att se detaljer och generera schema</p>
    </div>
  )
}

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

// ── Empty day placeholder ─────────────────────────────────────────────────────

function EmptyDay() {
  return (
    <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-gray-200 rounded-2xl text-center">
      <div className="p-4 bg-gray-50 rounded-2xl mb-3">
        <Calendar size={36} className="text-gray-300" />
      </div>
      <p className="text-gray-500 font-medium">Inga studieblock planerade</p>
      <p className="text-sm text-gray-400 mt-1">Klicka "Generera schema" för att skapa ett schema.</p>
    </div>
  )
}

// ── Post-work prompt ──────────────────────────────────────────────────────────

const POST_WORK_PRESETS = [20, 30, 45, 60]
const COMMUTE_HOME_MINUTES = 40

function PostWorkPrompt({
  workEndsAt, enabled, minutes, onToggle, onMinutesChange,
}: {
  workEndsAt: string; enabled: boolean; minutes: number
  onToggle: () => void; onMinutesChange: (m: number) => void
}) {
  const workEnd = new Date(workEndsAt)
  const homeTime = new Date(workEnd.getTime() + COMMUTE_HOME_MINUTES * 60000)
  const fmt = (d: Date) => d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className={`rounded-2xl border p-4 transition-all ${enabled ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-200'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Briefcase size={15} className={enabled ? 'text-indigo-600' : 'text-gray-400'} />
          <div>
            <span className="text-sm font-medium text-gray-800">Plugga efter jobbet?</span>
            <span className="text-xs text-gray-500 ml-2">
              Jobbet slutar {fmt(workEnd)} · hemma ~{fmt(homeTime)}
            </span>
          </div>
        </div>
        <button
          onClick={onToggle}
          className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-indigo-600' : 'bg-gray-300'}`}
        >
          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-1'}`} />
        </button>
      </div>
      {enabled && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-600">Hur många minuter?</span>
          {POST_WORK_PRESETS.map(p => (
            <button
              key={p}
              onClick={() => onMinutesChange(p)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${
                minutes === p ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-300'
              }`}
            >
              {p} min
            </button>
          ))}
          <input
            type="number" min={5} max={180} value={minutes}
            onChange={e => onMinutesChange(Math.max(5, Math.min(180, Number(e.target.value))))}
            className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-xs text-center"
          />
        </div>
      )}
    </div>
  )
}

// ── Study block card (day view) ───────────────────────────────────────────────

function StudyBlockCard({
  block, expanded, onToggle, onStatusChange, onDelete, onNavigatePreLecture,
}: {
  block: StudyBlock; expanded: boolean
  onToggle: () => void; onStatusChange: (s: BlockStatus) => void
  onDelete: () => void; onNavigatePreLecture: () => void
}) {
  const cfg = BLOCK_CFG[block.block_type] ?? BLOCK_CFG.reading
  const Icon = cfg.icon

  return (
    <div className={`rounded-2xl border-l-4 ${cfg.border} bg-white shadow-sm p-4 transition-all hover:shadow-md ${block.status === 'done' ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`mt-0.5 p-2 rounded-xl bg-gradient-to-br ${cfg.gradient} flex-shrink-0`}>
            <Icon size={14} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-800">{cfg.label}</span>
              {block.compression_level > 0 && (
                <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">komprimerad</span>
              )}
              {block.status !== 'planned' && (
                <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">
                  {STATUS_LABELS[block.status]}
                </span>
              )}
              {block.google_event_id && (
                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                  <CheckCircle size={9} /> GCal
                </span>
              )}
            </div>
            <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5">
              <Clock size={10} />
              {block.start_time
                ? `${formatTime(block.start_time)} – ${formatTime(block.end_time)}`
                : `${block.duration_minutes} min`}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {block.status !== 'done' && (
            <button
              onClick={() => onStatusChange('done')}
              className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 transition-colors"
              title="Markera klar"
            >
              <CheckCircle size={15} />
            </button>
          )}
          {block.status === 'planned' && (
            <button
              onClick={() => onStatusChange('started')}
              className="text-xs px-2 py-1 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Starta
            </button>
          )}
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
          >
            {expanded ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {expanded && block.payload && Object.keys(block.payload).length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          {block.block_type === 'pre_lecture' && (
            <>
              {(block.payload.what_to_listen_for as string[] | undefined)?.length ? (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-1">Lyssna efter:</p>
                  <ul className="text-xs text-gray-600 space-y-0.5 list-disc list-inside">
                    {(block.payload.what_to_listen_for as string[]).map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                </div>
              ) : null}
              <button onClick={onNavigatePreLecture} className="text-xs text-primary-600 hover:underline">
                Öppna förberedelseblock →
              </button>
            </>
          )}
          {block.block_type === 'daily_repetition' && (
            <p className="text-xs text-gray-500">
              {(block.payload.targeted_card_ids as number[] | undefined)?.length ?? 0} kort att repetera
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Lecture card ──────────────────────────────────────────────────────────────

function LectureCard({
  lecture, onEdit, onDelete, onNavigate,
}: {
  lecture: Lecture; onEdit: () => void; onDelete: () => void; onNavigate: () => void
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm space-y-1.5">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{lecture.title}</p>
          <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
            <Clock size={9} />
            {new Date(lecture.lecture_date).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
            {lecture.is_in_person && <span className="flex items-center gap-0.5"><MapPin size={9} /> Plats</span>}
            {lecture.is_difficult && <Star size={9} className="text-amber-400" />}
          </div>
        </div>
        <div className="flex gap-1 ml-2">
          <button onClick={onEdit} className="p-1 rounded hover:bg-gray-100"><Pencil size={12} className="text-gray-400" /></button>
          <button onClick={onDelete} className="p-1 rounded hover:bg-red-50"><Trash2 size={12} className="text-red-400" /></button>
        </div>
      </div>
      <button onClick={onNavigate} className="text-xs text-primary-600 hover:underline">
        Förberedelseblock →
      </button>
    </div>
  )
}

// ── Anki status badge ─────────────────────────────────────────────────────────

function AnkiStatusBadge({ status }: { status: AnkiStatus }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl border ${
      status.available ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-500'
    }`}>
      {status.available ? <Wifi size={11} /> : <WifiOff size={11} />}
      {status.available ? `Anki ${status.version ?? ''}` : 'Intern FSRS'}
    </div>
  )
}

// ── Lecture form modal ────────────────────────────────────────────────────────

function LectureFormModal({
  initial, onClose, onSave, defaultDate,
}: {
  initial: Lecture | null; onClose: () => void
  onSave: (data: LectureCreate) => Promise<void>; defaultDate: string
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [date, setDate] = useState(initial?.lecture_date?.slice(0, 16) ?? `${defaultDate}T09:00`)
  const [subject, setSubject] = useState(initial?.subject_tag ?? '')
  const [inPerson, setInPerson] = useState(initial?.is_in_person ?? false)
  const [difficult, setDifficult] = useState(initial?.is_difficult ?? false)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      await onSave({
        title,
        lecture_date: new Date(date).toISOString(),
        subject_tag: subject || undefined,
        is_in_person: inPerson,
        is_difficult: difficult,
      })
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">
            {initial ? 'Redigera föreläsning' : 'Lägg till föreläsning'}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Titel *</label>
            <input
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="T.ex. Immunologi — T-celler" required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Datum & tid *</label>
            <input
              type="datetime-local"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              value={date} onChange={e => setDate(e.target.value)} required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ämnestagg (valfritt)</label>
            <input
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              value={subject} onChange={e => setSubject(e.target.value)} placeholder="T.ex. immunologi"
            />
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={inPerson} onChange={e => setInPerson(e.target.checked)} className="rounded" />
              <MapPin size={13} /> På plats
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={difficult} onChange={e => setDifficult(e.target.checked)} className="rounded" />
              <Star size={13} className="text-amber-400" /> Svår
            </label>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 border border-gray-200 rounded-xl text-sm hover:bg-gray-50">
              Avbryt
            </button>
            <button type="submit" disabled={saving || !title.trim()}
              className="flex-1 py-2 bg-gradient-to-r from-primary-600 to-indigo-600 text-white rounded-xl text-sm hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
              {initial ? 'Spara' : 'Lägg till'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
