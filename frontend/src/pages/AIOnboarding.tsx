import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ChevronLeft, Check } from 'lucide-react'
import { aiScheduleApi } from '../services/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormData {
  wake_time: string
  sleep_time: string
  peak_hours_start: string
  peak_hours_end: string
  max_daily_study_hours: number
  preferred_session_length_minutes: number
  preferred_break_length_minutes: number
  commute_to_campus_minutes: number
  study_location_preference: string
  gym_days: string[]
  gym_time: string
  gym_duration_minutes: number
  session_structure_preference: string
  difficulty_preference: string
  feedback_style: string
  prior_bio_exposure: string
  prior_chem_exposure: string
  self_efficacy_score: number
}

const DEFAULT: FormData = {
  wake_time: '07:00',
  sleep_time: '23:00',
  peak_hours_start: '09:00',
  peak_hours_end: '12:00',
  max_daily_study_hours: 6,
  preferred_session_length_minutes: 50,
  preferred_break_length_minutes: 10,
  commute_to_campus_minutes: 0,
  study_location_preference: 'hemma',
  gym_days: [],
  gym_time: '',
  gym_duration_minutes: 60,
  session_structure_preference: 'mixed',
  difficulty_preference: 'balanced',
  feedback_style: 'direct',
  prior_bio_exposure: 'gymnasiet',
  prior_chem_exposure: 'gymnasiet',
  self_efficacy_score: 3,
}

const DAYS = ['måndag','tisdag','onsdag','torsdag','fredag','lördag','söndag']
const DAYS_EN = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']

// ─── Step helpers ─────────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5 justify-center mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i < current ? 'bg-primary-500 w-6' :
            i === current ? 'bg-primary-400 w-8' :
            'bg-gray-200 w-4'
          }`}
        />
      ))}
    </div>
  )
}

function OptionButton({
  label, description, selected, onClick,
}: { label: string; description?: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border-2 transition-all text-sm ${
        selected
          ? 'border-primary-500 bg-primary-50 text-primary-800'
          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
      }`}
    >
      <div className="font-medium">{label}</div>
      {description && <div className="text-xs mt-0.5 opacity-70">{description}</div>}
    </button>
  )
}

// ─── Steps ────────────────────────────────────────────────────────────────────

function Step0Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center space-y-4">
      <div className="text-4xl">🎓</div>
      <h2 className="text-2xl font-bold text-gray-900">Välkommen till Pluggis AI!</h2>
      <p className="text-gray-600 leading-relaxed text-sm max-w-sm mx-auto">
        Vi skapar ett personligt studieupplägg baserat på din situation.
        Det tar ungefär 3 minuter att komma igång.
      </p>
      <button onClick={onNext} className="btn-primary px-8 py-3 text-base">
        Kom igång
      </button>
    </div>
  )
}

function Step1Sleep({ data, set }: { data: FormData; set: (k: keyof FormData, v: unknown) => void }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-gray-900">Din dag</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-gray-600">Vaknar</label>
          <input
            type="time" value={data.wake_time}
            onChange={e => set('wake_time', e.target.value)}
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-300 outline-none"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Lägger sig</label>
          <input
            type="time" value={data.sleep_time}
            onChange={e => set('sleep_time', e.target.value)}
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-300 outline-none"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Skarpast (från)</label>
          <input
            type="time" value={data.peak_hours_start}
            onChange={e => set('peak_hours_start', e.target.value)}
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-300 outline-none"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Skarpast (till)</label>
          <input
            type="time" value={data.peak_hours_end}
            onChange={e => set('peak_hours_end', e.target.value)}
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-300 outline-none"
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600">
          Max studietimmar per dag: <span className="text-primary-600 font-bold">{data.max_daily_study_hours}h</span>
        </label>
        <input
          type="range" min={2} max={12} value={data.max_daily_study_hours}
          onChange={e => set('max_daily_study_hours', Number(e.target.value))}
          className="w-full mt-1"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600">
          Pendlingstid till campus: <span className="text-primary-600 font-bold">{data.commute_to_campus_minutes} min</span>
        </label>
        <input
          type="range" min={0} max={90} step={5} value={data.commute_to_campus_minutes}
          onChange={e => set('commute_to_campus_minutes', Number(e.target.value))}
          className="w-full mt-1"
        />
      </div>
    </div>
  )
}

function Step2Sessions({ data, set }: { data: FormData; set: (k: keyof FormData, v: unknown) => void }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-gray-900">Studiesessioner</h3>
      <div>
        <label className="text-xs font-medium text-gray-600">
          Sessioner på: <span className="text-primary-600 font-bold">{data.preferred_session_length_minutes} min</span>
        </label>
        <input
          type="range" min={20} max={120} step={5} value={data.preferred_session_length_minutes}
          onChange={e => set('preferred_session_length_minutes', Number(e.target.value))}
          className="w-full mt-1"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600">
          Pauser på: <span className="text-primary-600 font-bold">{data.preferred_break_length_minutes} min</span>
        </label>
        <input
          type="range" min={5} max={30} step={5} value={data.preferred_break_length_minutes}
          onChange={e => set('preferred_break_length_minutes', Number(e.target.value))}
          className="w-full mt-1"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600 block mb-2">Sessionstruktur</label>
        <div className="space-y-2">
          {[
            { v: 'pomodoro', l: 'Pomodoro', d: '25 min fokus · 5 min paus' },
            { v: 'mixed', l: 'Varierat', d: 'Anpassat efter aktivitet' },
            { v: 'long_blocks', l: 'Långa block', d: '90+ min djupfokus' },
          ].map(({ v, l, d }) => (
            <OptionButton
              key={v} label={l} description={d}
              selected={data.session_structure_preference === v}
              onClick={() => set('session_structure_preference', v)}
            />
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600 block mb-2">Studielokal</label>
        <div className="grid grid-cols-3 gap-2">
          {[['hemma','🏠 Hemma'],['bibliotek','📚 Bibliotek'],['campus','🎓 Campus']].map(([v,l]) => (
            <OptionButton key={v} label={l} selected={data.study_location_preference === v} onClick={() => set('study_location_preference', v)} />
          ))}
        </div>
      </div>
    </div>
  )
}

function Step3Gym({ data, set }: { data: FormData; set: (k: keyof FormData, v: unknown) => void }) {
  const toggle = (day: string) => {
    const current = data.gym_days
    set('gym_days', current.includes(day) ? current.filter(d => d !== day) : [...current, day])
  }
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-gray-900">Träning</h3>
      <p className="text-sm text-gray-500">Vi reserverar tid för träning i schemat så det aldrig krockar.</p>
      <div>
        <label className="text-xs font-medium text-gray-600 block mb-2">Träningsdagar</label>
        <div className="flex gap-2 flex-wrap">
          {DAYS.map((d, i) => {
            const en = DAYS_EN[i]
            const sel = data.gym_days.includes(en)
            return (
              <button
                key={en}
                onClick={() => toggle(en)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  sel ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {d.slice(0,3)}
              </button>
            )
          })}
        </div>
      </div>
      {data.gym_days.length > 0 && (
        <>
          <div>
            <label className="text-xs font-medium text-gray-600">Tränar klockan</label>
            <input
              type="time" value={data.gym_time}
              onChange={e => set('gym_time', e.target.value)}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-300 outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">
              Träningslängd: <span className="text-primary-600 font-bold">{data.gym_duration_minutes} min</span>
            </label>
            <input
              type="range" min={30} max={120} step={15} value={data.gym_duration_minutes}
              onChange={e => set('gym_duration_minutes', Number(e.target.value))}
              className="w-full mt-1"
            />
          </div>
        </>
      )}
    </div>
  )
}

function Step4Background({ data, set }: { data: FormData; set: (k: keyof FormData, v: unknown) => void }) {
  const exposureLevels = [
    { v: 'ingen', l: 'Ingen', d: 'Aldrig studerat det' },
    { v: 'gymnasiet', l: 'Gymnasiet', d: 'Naturvetenskap på gym' },
    { v: 'högskolekurs', l: 'Högskolekurs', d: 'En eller flera kurser' },
    { v: 'avancerat', l: 'Avancerat', d: 'Djup förkunskap' },
  ]
  return (
    <div className="space-y-5">
      <h3 className="text-lg font-bold text-gray-900">Din bakgrund</h3>
      <div>
        <label className="text-xs font-medium text-gray-600 block mb-2">Förkunskaper i biologi</label>
        <div className="space-y-2">
          {exposureLevels.map(({ v, l, d }) => (
            <OptionButton key={v} label={l} description={d}
              selected={data.prior_bio_exposure === v}
              onClick={() => set('prior_bio_exposure', v)}
            />
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600 block mb-2">Förkunskaper i kemi</label>
        <div className="space-y-2">
          {exposureLevels.map(({ v, l, d }) => (
            <OptionButton key={v} label={l} description={d}
              selected={data.prior_chem_exposure === v}
              onClick={() => set('prior_chem_exposure', v)}
            />
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600 block mb-2">
          Hur säker känner du dig inför studierna? (1 = osäker, 5 = mycket säker)
        </label>
        <div className="flex gap-3">
          {[1,2,3,4,5].map(n => (
            <button
              key={n}
              onClick={() => set('self_efficacy_score', n)}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${
                data.self_efficacy_score === n
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function Step5Preferences({ data, set }: { data: FormData; set: (k: keyof FormData, v: unknown) => void }) {
  return (
    <div className="space-y-5">
      <h3 className="text-lg font-bold text-gray-900">Dina preferenser</h3>
      <div>
        <label className="text-xs font-medium text-gray-600 block mb-2">Svårighetsnivå</label>
        <div className="space-y-2">
          {[
            { v: 'gentle', l: 'Lugnt', d: 'Bygg upp gradvis, lägre intensitet' },
            { v: 'balanced', l: 'Balanserat', d: 'Utmanande men hållbart' },
            { v: 'intensive', l: 'Intensivt', d: 'Maximal inlärning, hög intensitet' },
          ].map(({ v, l, d }) => (
            <OptionButton key={v} label={l} description={d}
              selected={data.difficulty_preference === v}
              onClick={() => set('difficulty_preference', v)}
            />
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600 block mb-2">Feedback-stil</label>
        <div className="space-y-2">
          {[
            { v: 'encouraging', l: 'Uppmuntrande', d: 'Fokus på framsteg och styrkor' },
            { v: 'direct', l: 'Direkt', d: 'Rakt på sak, inga omsvep' },
            { v: 'analytical', l: 'Analytisk', d: 'Data och statistik i fokus' },
          ].map(({ v, l, d }) => (
            <OptionButton key={v} label={l} description={d}
              selected={data.feedback_style === v}
              onClick={() => set('feedback_style', v)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

const TOTAL_STEPS = 6  // 0=welcome, 1-5=form steps

export default function AIOnboarding() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [data, setData] = useState<FormData>(DEFAULT)
  const [saving, setSaving] = useState(false)

  const set = (k: keyof FormData, v: unknown) => setData(prev => ({ ...prev, [k]: v }))

  const handleFinish = async () => {
    setSaving(true)
    try {
      await aiScheduleApi.saveProfile({
        ...data,
        gym_time: data.gym_time || null,
      } as never)
      // Redirect to topics page so user can add exam topics before first schedule
      navigate('/ai-topics')
    } finally {
      setSaving(false)
    }
  }

  const canGoNext = step > 0  // all steps are optional / have defaults

  if (step === 0) {
    return (
      <div className="max-w-md mx-auto pt-12">
        <Step0Welcome onNext={() => setStep(1)} />
      </div>
    )
  }

  const stepContent = [
    null,
    <Step1Sleep data={data} set={set} />,
    <Step2Sessions data={data} set={set} />,
    <Step3Gym data={data} set={set} />,
    <Step4Background data={data} set={set} />,
    <Step5Preferences data={data} set={set} />,
  ]

  const isLast = step === TOTAL_STEPS - 1

  return (
    <div className="max-w-md mx-auto">
      <StepIndicator current={step} total={TOTAL_STEPS} />

      <div className="card p-6">
        {stepContent[step]}
      </div>

      <div className="flex items-center justify-between mt-4">
        <button
          onClick={() => setStep(s => s - 1)}
          className="btn-secondary text-sm flex items-center gap-1.5"
        >
          <ChevronLeft size={15} /> Tillbaka
        </button>

        {isLast ? (
          <button
            onClick={handleFinish}
            disabled={saving}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            {saving ? 'Sparar...' : (
              <><Check size={14} /> Kom igång!</>
            )}
          </button>
        ) : (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={!canGoNext}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            Nästa <ChevronRight size={15} />
          </button>
        )}
      </div>
    </div>
  )
}
