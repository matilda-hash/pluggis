import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Settings2, Wifi, WifiOff, Calendar, Check, RefreshCw,
  ExternalLink, AlertTriangle, ChevronDown, ChevronUp,
} from 'lucide-react'
import type { AppSettings, AppPreferences, WeaknessMetric, DaySchedule } from '../types'
import { settingsApi, calendarApi, ankiApi, tagsApi } from '../services/api'
import { useToast } from '../components/Toast'

// ── Week schedule constants ────────────────────────────────────────────────────

const DAYS_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
type DayKey = typeof DAYS_ORDER[number]

const DAY_LABELS: Record<DayKey, string> = {
  monday: 'Mån', tuesday: 'Tis', wednesday: 'Ons',
  thursday: 'Tor', friday: 'Fre', saturday: 'Lör', sunday: 'Sön',
}

const DEFAULT_DAY: DaySchedule = { enabled: true, max_hours: 8 }

export default function Settings() {
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [prefs, setPrefs] = useState<AppPreferences>({
    daily_goal: 80,
    morning_activation: false,
    study_window_start: '08:00',
    study_window_end: '17:00',
    anki_connect_url: 'http://localhost:8765',
    weekly_hours: 30,
    study_days: {},
  })
  const [weaknessMetrics, setWeaknessMetrics] = useState<WeaknessMetric[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncingWeakness, setSyncingWeakness] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    anki: true, calendar: true, preferences: true, schedule: true, weakness: false,
  })

  // OAuth wizard state
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [oauthLoading, setOauthLoading] = useState(false)
  const [calendarSyncing, setCalendarSyncing] = useState(false)
  const [calendarError, setCalendarError] = useState<string | null>(null)

  const REDIRECT_URI = 'http://localhost:8000/api/calendar/auth/callback'

  useEffect(() => {
    // Handle redirect back from Google OAuth
    const calendarParam = searchParams.get('calendar')
    const errorParam = searchParams.get('calendar_error')
    if (calendarParam === 'connected' || errorParam) {
      setSearchParams({}, { replace: true }) // clean URL
      if (errorParam) {
        setCalendarError(`Anslutning misslyckades: ${errorParam}`)
      }
      // Reload settings to reflect new auth state
      settingsApi.get().then(s => { setSettings(s); setPrefs(s.preferences) })
    }

    Promise.all([
      settingsApi.get(),
      tagsApi.weakness(),
    ]).then(([s, wm]) => {
      setSettings(s)
      setPrefs(s.preferences)
      setWeaknessMetrics(wm)
    }).finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSection(key: keyof typeof expandedSections) {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  async function savePrefs() {
    // Validate study window
    if (prefs.study_window_start >= prefs.study_window_end) {
      toast('Starttiden måste vara före sluttiden', 'error')
      return
    }
    setSaving(true)
    try {
      const updated = await settingsApi.update(prefs)
      setSettings(updated)
      toast('Inställningar sparade')
    } catch {
      toast('Kunde inte spara inställningar', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function testAnkiConnection() {
    const status = await ankiApi.status()
    setSettings(prev => prev ? { ...prev, anki_available: status.available } : prev)
    alert(status.available ? `Anki ansluten (v${status.version})` : 'Anki ej tillgänglig. Öppna Anki och installera AnkiConnect.')
  }

  async function startOAuth() {
    if (!clientId.trim() || !clientSecret.trim()) {
      alert('Fyll i Client ID och Client Secret.')
      return
    }
    setOauthLoading(true)
    setCalendarError(null)
    try {
      const result = await calendarApi.startAuth(clientId.trim(), clientSecret.trim(), REDIRECT_URI)
      // Open Google consent screen — backend will handle the redirect back
      window.location.href = result.auth_url
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Okänt fel'
      setCalendarError(`Kunde inte starta auktorisering: ${msg}`)
      setOauthLoading(false)
    }
  }

  async function disconnectCalendar() {
    if (!confirm('Koppla bort Google Kalender?')) return
    await calendarApi.disconnect()
    setSettings(prev => prev ? { ...prev, calendar_authenticated: false, calendar_email: null } : prev)
  }

  async function syncCalendar() {
    setCalendarSyncing(true)
    try {
      const result = await calendarApi.sync()
      alert(`Synkroniserade ${result.synced} händelser.`)
    } finally {
      setCalendarSyncing(false)
    }
  }

  async function syncWeakness() {
    setSyncingWeakness(true)
    try {
      await tagsApi.syncWeakness()
      const wm = await tagsApi.weakness()
      setWeaknessMetrics(wm)
    } finally {
      setSyncingWeakness(false)
    }
  }

  // ── Week schedule helpers ──────────────────────────────────────────────────

  function getDayConfig(day: DayKey): DaySchedule {
    return prefs.study_days[day] ?? { ...DEFAULT_DAY }
  }

  function updateDayConfig(day: DayKey, changes: Partial<DaySchedule>) {
    const current = getDayConfig(day)
    setPrefs(p => ({
      ...p,
      study_days: { ...p.study_days, [day]: { ...current, ...changes } },
    }))
  }

  // Compute how many hours per enabled day to hit the weekly target
  function autoDistributeHours(): string {
    const enabledDays = DAYS_ORDER.filter(d => getDayConfig(d).enabled).length
    if (enabledDays === 0) return '–'
    return (prefs.weekly_hours / enabledDays).toFixed(1)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw size={24} className="animate-spin text-primary-500" />
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Settings2 size={24} className="text-primary-600" />
        <h1 className="text-2xl font-bold text-gray-900">Inställningar</h1>
      </div>

      {/* Anki section */}
      <SettingsCard
        title="Anki"
        expanded={expandedSections.anki}
        onToggle={() => toggleSection('anki')}
        status={settings?.anki_available
          ? { color: 'bg-green-500', label: 'Ansluten' }
          : { color: 'bg-gray-400', label: 'Ej tillgänglig' }
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            {settings?.anki_available
              ? <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm"><Wifi size={14} /> Anki är ansluten och redo</div>
              : <div className="flex items-center gap-2 text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"><WifiOff size={14} /> Anki ej detekterad</div>
            }
            <button
              onClick={testAnkiConnection}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50"
            >
              Testa anslutning
            </button>
          </div>

          {!settings?.anki_available && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm space-y-2">
              <p className="font-semibold text-blue-800">Hur man installerar AnkiConnect:</p>
              <ol className="list-decimal list-inside text-blue-700 space-y-1">
                <li>Ladda ner och installera <a href="https://apps.ankiweb.net" target="_blank" rel="noopener noreferrer" className="underline">Anki</a></li>
                <li>Gå till Verktyg → Tillägg → Hämta tillägg</li>
                <li>Ange kod: <code className="bg-blue-100 px-1 rounded">2055492159</code></li>
                <li>Starta om Anki</li>
                <li>Klicka "Testa anslutning" ovan</li>
              </ol>
            </div>
          )}

          <div>
            <label className="text-sm text-gray-600 block mb-1">AnkiConnect URL</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={prefs.anki_connect_url}
              onChange={e => setPrefs(p => ({ ...p, anki_connect_url: e.target.value }))}
            />
          </div>
        </div>
      </SettingsCard>

      {/* Google Calendar section */}
      <SettingsCard
        title="Google Kalender"
        expanded={expandedSections.calendar}
        onToggle={() => toggleSection('calendar')}
        status={settings?.calendar_authenticated
          ? { color: 'bg-green-500', label: settings.calendar_email ?? 'Ansluten' }
          : { color: 'bg-gray-400', label: 'Ej ansluten' }
        }
      >
        {settings?.calendar_authenticated ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm">
              <Calendar size={14} /> Ansluten som {settings.calendar_email}
            </div>
            <div className="flex gap-3">
              <button
                onClick={syncCalendar}
                disabled={calendarSyncing}
                className="flex items-center gap-2 text-sm border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50"
              >
                <RefreshCw size={14} className={calendarSyncing ? 'animate-spin' : ''} />
                Synka händelser
              </button>
              <button
                onClick={disconnectCalendar}
                className="text-sm text-red-600 hover:underline"
              >
                Koppla bort
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm space-y-1">
              <p className="font-semibold text-amber-800">Förutsättningar (Google Cloud Console):</p>
              <ol className="list-decimal list-inside text-amber-700 space-y-0.5">
                <li>Skapa ett projekt på <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="underline">Google Cloud Console <ExternalLink size={10} className="inline" /></a></li>
                <li>Aktivera Google Calendar API</li>
                <li>Skapa OAuth 2.0-klientuppgifter (Webbapplikation)</li>
                <li>Lägg till auktoriserad omdirigerings-URI: <code className="bg-amber-100 px-1 rounded text-xs">{REDIRECT_URI}</code></li>
              </ol>
            </div>

            {calendarError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                {calendarError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 block mb-1">Client ID</label>
                <input
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
                  value={clientId}
                  onChange={e => { setClientId(e.target.value); setCalendarError(null) }}
                  placeholder="123456789-abc...apps.googleusercontent.com"
                  disabled={oauthLoading}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 block mb-1">Client Secret</label>
                <input
                  type="password"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={clientSecret}
                  onChange={e => { setClientSecret(e.target.value); setCalendarError(null) }}
                  disabled={oauthLoading}
                />
              </div>
              <p className="text-xs text-gray-400">
                När du klickar nedan öppnas Google — efter att du godkänt omdirigeras du automatiskt tillbaka hit.
              </p>
              <button
                onClick={startOAuth}
                disabled={!clientId.trim() || !clientSecret.trim() || oauthLoading}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {oauthLoading
                  ? <><RefreshCw size={14} className="animate-spin" /> Öppnar Google...</>
                  : <><Calendar size={14} /> Anslut Google Kalender</>
                }
              </button>
            </div>
          </div>
        )}
      </SettingsCard>

      {/* Preferences section */}
      <SettingsCard
        title="Preferenser"
        expanded={expandedSections.preferences}
        onToggle={() => toggleSection('preferences')}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-600 block mb-1">Dagligt mål (kort)</label>
              <input
                type="number"
                min={10} max={500}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={prefs.daily_goal}
                onChange={e => setPrefs(p => ({ ...p, daily_goal: Number(e.target.value) }))}
              />
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">Studiefönster</label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm"
                  value={prefs.study_window_start}
                  onChange={e => setPrefs(p => ({ ...p, study_window_start: e.target.value }))}
                />
                <span className="text-gray-400">–</span>
                <input
                  type="time"
                  className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm"
                  value={prefs.study_window_end}
                  onChange={e => setPrefs(p => ({ ...p, study_window_end: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => setPrefs(p => ({ ...p, morning_activation: !p.morning_activation }))}
              className={`relative w-10 h-6 rounded-full transition-colors ${prefs.morning_activation ? 'bg-primary-600' : 'bg-gray-200'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${prefs.morning_activation ? 'translate-x-5' : 'translate-x-1'}`} />
            </div>
            <span className="text-sm text-gray-700">Morgonaktivering (15 min) varje dag</span>
          </label>

          <button
            onClick={savePrefs}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
            Spara inställningar
          </button>
        </div>
      </SettingsCard>

      {/* Veckoschema section */}
      <SettingsCard
        title="Veckoschema"
        expanded={expandedSections.schedule}
        onToggle={() => toggleSection('schedule')}
      >
        <div className="space-y-5">
          {/* Weekly hours target */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block">Studiemål (timmar/vecka)</label>
              <p className="text-xs text-gray-400 mt-0.5">
                Automatisk fördelning: ~{autoDistributeHours()} h/aktiverad dag
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1} max={100} step={0.5}
                className="w-20 border border-gray-200 rounded-lg px-3 py-2 text-sm text-center"
                value={prefs.weekly_hours}
                onChange={e => setPrefs(p => ({ ...p, weekly_hours: Number(e.target.value) }))}
              />
              <span className="text-sm text-gray-500">h</span>
            </div>
          </div>

          {/* Day toggles */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-3">Studiedagar & maxgränser</p>
            <div className="grid grid-cols-7 gap-1.5">
              {DAYS_ORDER.map(day => {
                const cfg = getDayConfig(day)
                return (
                  <div key={day} className="flex flex-col items-center gap-1.5">
                    {/* Day toggle button */}
                    <button
                      onClick={() => updateDayConfig(day, { enabled: !cfg.enabled })}
                      className={`w-full py-2 rounded-lg text-xs font-semibold border transition-all ${
                        cfg.enabled
                          ? 'bg-primary-600 border-primary-600 text-white'
                          : 'bg-gray-100 border-gray-200 text-gray-400'
                      }`}
                    >
                      {DAY_LABELS[day]}
                    </button>
                    {/* Max hours input (only when enabled) */}
                    {cfg.enabled && (
                      <input
                        type="number"
                        min={0.5} max={16} step={0.5}
                        title={`Max timmar ${DAY_LABELS[day]}`}
                        className="w-full border border-gray-200 rounded-lg px-1 py-1 text-xs text-center"
                        value={cfg.max_hours}
                        onChange={e => updateDayConfig(day, { max_hours: Number(e.target.value) })}
                      />
                    )}
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Klicka en dag för att aktivera/inaktivera. Siffran under är max-timmar den dagen.
            </p>
          </div>

          <button
            onClick={savePrefs}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
            Spara veckoschema
          </button>
        </div>
      </SettingsCard>

      {/* Weakness section */}
      <SettingsCard
        title="Svaghetsanalys"
        expanded={expandedSections.weakness}
        onToggle={() => toggleSection('weakness')}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">Taggar sorterade efter glömningsfrekvens (30 dagar)</p>
            <button
              onClick={syncWeakness}
              disabled={syncingWeakness}
              className="flex items-center gap-1.5 text-sm border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50"
            >
              <RefreshCw size={13} className={syncingWeakness ? 'animate-spin' : ''} />
              Uppdatera
            </button>
          </div>

          {weaknessMetrics.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Inga data ännu. Klicka "Uppdatera" för att beräkna.</p>
          ) : (
            <div className="space-y-2">
              {weaknessMetrics.slice(0, 10).map(m => (
                <div key={m.tag} className="flex items-center gap-3">
                  <span className="text-sm text-gray-700 w-40 truncate">{m.tag}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${m.lapse_rate > 0.4 ? 'bg-red-500' : m.lapse_rate > 0.2 ? 'bg-amber-400' : 'bg-green-400'}`}
                      style={{ width: `${Math.round(m.lapse_rate * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 w-12 text-right">{Math.round(m.lapse_rate * 100)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingsCard>
    </div>
  )
}

// ── Settings card ──────────────────────────────────────────────────────────────

function SettingsCard({
  title, expanded, onToggle, children, status,
}: {
  title: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
  status?: { color: string; label: string }
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-5 hover:bg-gray-50 text-left"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-gray-900">{title}</span>
          {status && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className={`w-2 h-2 rounded-full ${status.color}`} />
              {status.label}
            </div>
          )}
        </div>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {expanded && <div className="px-5 pb-5 border-t">{children}</div>}
    </div>
  )
}
