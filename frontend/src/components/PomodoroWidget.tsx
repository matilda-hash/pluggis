import { useState, useEffect, useRef, useCallback } from 'react'
import { Timer, X, RotateCcw, Play, Pause, Coffee } from 'lucide-react'

type Mode = '25/5' | '50/10'
type Phase = 'work' | 'break'

const MODES: Record<Mode, { work: number; brk: number; label: string }> = {
  '25/5':  { work: 25, brk: 5,  label: 'Pomodoro 25/5'  },
  '50/10': { work: 50, brk: 10, label: 'Fokus 50/10'    },
}

export default function PomodoroWidget() {
  const [open, setOpen]         = useState(false)
  const [mode, setMode]         = useState<Mode>('25/5')
  const [phase, setPhase]       = useState<Phase>('work')
  const [seconds, setSeconds]   = useState(MODES['25/5'].work * 60)
  const [running, setRunning]   = useState(false)
  const [sessions, setSessions] = useState(0)
  const intervalRef             = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioRef                = useRef<AudioContext | null>(null)

  const totalSeconds = phase === 'work' ? MODES[mode].work * 60 : MODES[mode].brk * 60
  const progress     = ((totalSeconds - seconds) / totalSeconds) * 100

  const playBeep = useCallback(() => {
    try {
      const ctx = new AudioContext()
      audioRef.current = ctx
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = phase === 'work' ? 880 : 440
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
      osc.start()
      osc.stop(ctx.currentTime + 0.8)
    } catch {
      // AudioContext not available
    }
  }, [phase])

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setSeconds(s => {
          if (s <= 1) {
            playBeep()
            // Switch phase
            setPhase(prev => {
              const next: Phase = prev === 'work' ? 'break' : 'work'
              if (prev === 'work') setSessions(n => n + 1)
              setSeconds(next === 'work' ? MODES[mode].work * 60 : MODES[mode].brk * 60)
              return next
            })
            return 0
          }
          return s - 1
        })
      }, 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [running, mode, playBeep])

  const handleModeChange = (m: Mode) => {
    setMode(m)
    setPhase('work')
    setSeconds(MODES[m].work * 60)
    setRunning(false)
  }

  const reset = () => {
    setPhase('work')
    setSeconds(MODES[mode].work * 60)
    setRunning(false)
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  const circumference = 2 * Math.PI * 40
  const strokeDashoffset = circumference * (1 - progress / 100)

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 bg-pink-500 hover:bg-pink-600 text-white rounded-full p-3.5 shadow-lg transition-all hover:scale-105"
          title="Pomodoro-timer"
        >
          <Timer size={20} />
        </button>
      )}

      {/* Widget panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 bg-white rounded-2xl shadow-2xl border border-pink-100 w-64 select-none">
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Timer size={14} className="text-pink-500" />
              <span className="text-xs font-semibold text-gray-700">Pomodoro</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
              <X size={14} />
            </button>
          </div>

          {/* Mode tabs */}
          <div className="flex gap-1 px-3 pt-3">
            {(['25/5', '50/10'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => handleModeChange(m)}
                className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${
                  mode === m
                    ? 'bg-pink-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Phase indicator */}
          <div className="flex justify-center mt-2">
            <span className={`text-xs font-medium px-3 py-0.5 rounded-full ${
              phase === 'work'
                ? 'bg-rose-100 text-rose-600'
                : 'bg-green-100 text-green-600'
            }`}>
              {phase === 'work' ? 'Fokustid' : <span className="flex items-center gap-1"><Coffee size={10} /> Paus</span>}
            </span>
          </div>

          {/* Circular progress + time */}
          <div className="flex flex-col items-center py-4">
            <div className="relative w-24 h-24">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 96 96">
                <circle
                  cx="48" cy="48" r="40"
                  fill="none"
                  stroke="#f3f4f6"
                  strokeWidth="7"
                />
                <circle
                  cx="48" cy="48" r="40"
                  fill="none"
                  stroke={phase === 'work' ? '#ec4899' : '#22c55e'}
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  className="transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-gray-800 tabular-nums leading-none">
                  {mm}:{ss}
                </span>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-3 pb-3">
            <button
              onClick={reset}
              className="p-2 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              title="Återställ"
            >
              <RotateCcw size={15} />
            </button>
            <button
              onClick={() => setRunning(r => !r)}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-sm ${
                running
                  ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  : 'bg-pink-500 text-white hover:bg-pink-600'
              }`}
            >
              {running ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
            </button>
            <div className="w-8 text-center">
              <span className="text-xs text-gray-400">{sessions} <span className="text-gray-300">sess</span></span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
