import { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { useNavigate } from 'react-router-dom'
import { FileText, Upload as UploadIcon, Trash2, Check, Edit2, X, Loader2, Package } from 'lucide-react'
import { uploadApi, ankiApi, decksApi } from '../services/api'
import type { GeneratedCard, UploadResult, Deck } from '../types'

type Phase = 'upload' | 'generating' | 'preview' | 'saving' | 'done'
type ApkgPhase = 'idle' | 'importing' | 'done' | 'error'
type Mode = 'pdf' | 'apkg'

function ClozePreview({ text }: { text: string }) {
  return (
    <span>
      {text.split(/(\{\{[^}]+\}\})/g).map((part, i) => {
        const m = part.match(/^\{\{(.+)\}\}$/)
        return m ? (
          <mark key={i} className="bg-primary-100 text-primary-700 px-0.5 rounded not-italic font-medium">
            {m[1]}
          </mark>
        ) : <span key={i}>{part}</span>
      })}
    </span>
  )
}

type EditableCard = GeneratedCard & { id: string; editing: boolean }

export default function Upload() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('pdf')

  // ── PDF state ──────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [deckName, setDeckName] = useState('')
  const [numCards, setNumCards] = useState(40)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [cards, setCards] = useState<EditableCard[]>([])
  const [error, setError] = useState<string | null>(null)

  // ── APKG state ─────────────────────────────────────────────────────────────
  const [apkgFile, setApkgFile] = useState<File | null>(null)
  const [decks, setDecks] = useState<Deck[]>([])
  const [selectedDeckId, setSelectedDeckId] = useState<number | ''>('')
  const [apkgDeckMode, setApkgDeckMode] = useState<'existing' | 'new'>('existing')
  const [newDeckName, setNewDeckName] = useState('')
  const [apkgPhase, setApkgPhase] = useState<ApkgPhase>('idle')
  const [apkgResult, setApkgResult] = useState<{ imported: number; skipped: number; deck_name: string } | null>(null)
  const [apkgError, setApkgError] = useState<string | null>(null)

  useEffect(() => {
    if (mode === 'apkg') {
      decksApi.list().then(setDecks).catch(() => {})
    }
  }, [mode])

  // ── PDF dropzone ───────────────────────────────────────────────────────────
  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) {
      setFile(accepted[0])
      setDeckName(accepted[0].name.replace(/\.pdf$/i, ''))
      setError(null)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
  })

  // ── APKG dropzone ──────────────────────────────────────────────────────────
  const onApkgDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) {
      setApkgFile(accepted[0])
      setApkgError(null)
      setApkgResult(null)
      setApkgPhase('idle')
    }
  }, [])

  const { getRootProps: getApkgRootProps, getInputProps: getApkgInputProps, isDragActive: isApkgDragActive } = useDropzone({
    onDrop: onApkgDrop,
    accept: { 'application/octet-stream': ['.apkg'], '': ['.apkg'] },
    maxFiles: 1,
  })

  // ── PDF handlers ───────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!file) return
    setPhase('generating')
    setError(null)
    try {
      const res = await uploadApi.pdf(file, deckName || undefined, numCards)
      setResult(res)
      setCards(res.cards.map((c, i) => ({ ...c, id: `card-${i}`, editing: false })))
      setPhase('preview')
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Generering misslyckades. Kontrollera din API-nyckel och försök igen.'
      setError(msg)
      setPhase('upload')
    }
  }

  const handleSave = async () => {
    if (!result) return
    setPhase('saving')
    try {
      await uploadApi.confirm(result.deck_id, cards)
      setPhase('done')
    } catch {
      setError('Misslyckades att spara kort')
      setPhase('preview')
    }
  }

  const removeCard = (id: string) => setCards(prev => prev.filter(c => c.id !== id))
  const updateCard = (id: string, patch: Partial<EditableCard>) =>
    setCards(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))

  // ── APKG handler ───────────────────────────────────────────────────────────
  const handleApkgImport = async () => {
    const canImport = apkgFile && (
      (apkgDeckMode === 'existing' && selectedDeckId !== '') ||
      (apkgDeckMode === 'new' && newDeckName.trim() !== '')
    )
    if (!canImport) return
    setApkgPhase('importing')
    setApkgError(null)
    try {
      const res = apkgDeckMode === 'new'
        ? await ankiApi.importApkg(apkgFile!, undefined, newDeckName.trim())
        : await ankiApi.importApkg(apkgFile!, selectedDeckId as number)
      setApkgResult(res)
      setApkgPhase('done')
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Import misslyckades. Kontrollera att filen är en giltig .apkg-fil.'
      setApkgError(msg)
      setApkgPhase('error')
    }
  }

  // ── Done (PDF) ─────────────────────────────────────────────────────────────
  if (phase === 'done' && result) {
    return (
      <div className="max-w-lg mx-auto text-center py-16 space-y-6">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <Check size={32} className="text-green-500" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Kort sparade!</h2>
          <p className="text-gray-500">{cards.length} kort tillagda i <strong>{result.deck_name}</strong></p>
        </div>
        <div className="flex gap-3 justify-center">
          <button onClick={() => { setPhase('upload'); setFile(null); setResult(null) }} className="btn-secondary">
            Ladda upp mer
          </button>
          <button onClick={() => navigate(`/study/${result.deck_id}`)} className="btn-primary">
            Studera nu
          </button>
        </div>
      </div>
    )
  }

  // ── Preview (PDF) ──────────────────────────────────────────────────────────
  if (phase === 'preview' && result) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{result.deck_name}</h1>
            <p className="text-sm text-gray-500">{cards.length} kort genererade – granska, redigera och spara</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setPhase('upload')} className="btn-secondary text-sm">
              Börja om
            </button>
            <button onClick={handleSave} className="btn-primary text-sm flex items-center gap-2">
              <Check size={15} />
              Spara {cards.length} kort
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {cards.map(card => (
            <div key={card.id} className="card p-4">
              {card.editing ? (
                <div className="space-y-3">
                  {card.card_type === 'cloze' ? (
                    <textarea
                      className="w-full text-sm border border-gray-200 rounded-lg p-2 resize-none focus:ring-2 focus:ring-primary-300 outline-none"
                      rows={3}
                      value={card.cloze_text ?? ''}
                      onChange={e => updateCard(card.id, { cloze_text: e.target.value })}
                    />
                  ) : (
                    <>
                      <input
                        className="w-full text-sm border border-gray-200 rounded-lg p-2 focus:ring-2 focus:ring-primary-300 outline-none"
                        value={card.front ?? ''}
                        onChange={e => updateCard(card.id, { front: e.target.value })}
                        placeholder="Framsida (fråga)"
                      />
                      <textarea
                        className="w-full text-sm border border-gray-200 rounded-lg p-2 resize-none focus:ring-2 focus:ring-primary-300 outline-none"
                        rows={3}
                        value={card.back ?? ''}
                        onChange={e => updateCard(card.id, { back: e.target.value })}
                        placeholder="Baksida (svar)"
                      />
                    </>
                  )}
                  <button
                    onClick={() => updateCard(card.id, { editing: false })}
                    className="text-xs btn-secondary px-3 py-1.5"
                  >
                    Klar
                  </button>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full mr-2 ${
                      card.card_type === 'cloze'
                        ? 'bg-purple-50 text-purple-600'
                        : 'bg-blue-50 text-blue-600'
                    }`}>
                      {card.card_type}
                    </span>
                    {card.card_type === 'cloze' ? (
                      <p className="text-sm text-gray-700 mt-2">
                        <ClozePreview text={card.cloze_text ?? ''} />
                      </p>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-gray-800 mt-2">{card.front}</p>
                        <p className="text-sm text-gray-500 mt-1">{card.back}</p>
                      </>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => updateCard(card.id, { editing: true })}
                      className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      onClick={() => removeCard(card.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Main upload form ───────────────────────────────────────────────────────
  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Importera kort</h1>
        <p className="text-sm text-gray-500 mt-1">
          Ladda upp en PDF eller importera en Anki-kortlek (.apkg)
        </p>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => setMode('pdf')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
            mode === 'pdf'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileText size={15} />
          PDF → Flashkort
        </button>
        <button
          onClick={() => setMode('apkg')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
            mode === 'apkg'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Package size={15} />
          Importera .apkg
        </button>
      </div>

      {/* ── PDF mode ── */}
      {mode === 'pdf' && (
        <>
          {/* Drop zone */}
          <div
            {...getRootProps()}
            className={`card p-10 flex flex-col items-center justify-center cursor-pointer border-2 border-dashed transition-colors ${
              isDragActive
                ? 'border-primary-400 bg-primary-50'
                : file
                ? 'border-green-400 bg-green-50'
                : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
            }`}
          >
            <input {...getInputProps()} />
            {file ? (
              <>
                <FileText size={36} className="text-green-500 mb-3" />
                <p className="font-medium text-gray-800">{file.name}</p>
                <p className="text-sm text-gray-400 mt-1">
                  {(file.size / 1024 / 1024).toFixed(1)} MB – klicka för att byta
                </p>
              </>
            ) : (
              <>
                <UploadIcon size={36} className="text-gray-300 mb-3" />
                <p className="font-medium text-gray-600">Släpp en PDF här eller klicka för att bläddra</p>
                <p className="text-sm text-gray-400 mt-1">Stöder medicinska läroböcker, föreläsningsbilder, anteckningar</p>
              </>
            )}
          </div>

          {/* Options */}
          {file && (
            <div className="card p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Kortlekens namn</label>
                <input
                  type="text"
                  value={deckName}
                  onChange={e => setDeckName(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-300 outline-none"
                  placeholder="t.ex. Mikrobiologi – Kapitel 4"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Antal kort att generera
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={numCards}
                    onChange={e => setNumCards(Number(e.target.value))}
                    className="flex-1 accent-primary-600"
                  />
                  <span className="text-sm font-semibold text-gray-700 w-10 text-right">{numCards}</span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg border border-red-200 flex items-start gap-2">
              <X size={14} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={!file || phase === 'generating'}
            className="w-full btn-primary py-3 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {phase === 'generating' ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Claude läser din PDF...
              </>
            ) : (
              <>
                <UploadIcon size={16} />
                Generera flashkort
              </>
            )}
          </button>

          <p className="text-xs text-center text-gray-400">
            Kräver ANTHROPIC_API_KEY i backend/.env
          </p>
        </>
      )}

      {/* ── APKG mode ── */}
      {mode === 'apkg' && (
        <>
          {apkgPhase === 'done' && apkgResult ? (
            /* Success state */
            <div className="card p-8 text-center space-y-4">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <Check size={28} className="text-green-500" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-800">Import klar!</h2>
                <p className="text-gray-500 mt-1">
                  <strong>{apkgResult.imported}</strong> kort importerade
                  {apkgResult.skipped > 0 && (
                    <span className="text-gray-400"> · {apkgResult.skipped} hoppades över (duplicat)</span>
                  )}
                </p>
                <p className="text-sm text-gray-400 mt-1">Kortlek: <strong>{apkgResult.deck_name}</strong></p>
              </div>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => { setApkgFile(null); setApkgResult(null); setApkgPhase('idle'); setSelectedDeckId('') }}
                  className="btn-secondary"
                >
                  Importera fler
                </button>
                <button
                  onClick={() => navigate('/decks')}
                  className="btn-primary"
                >
                  Visa kortlekar
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* APKG drop zone */}
              <div
                {...getApkgRootProps()}
                className={`card p-10 flex flex-col items-center justify-center cursor-pointer border-2 border-dashed transition-colors ${
                  isApkgDragActive
                    ? 'border-primary-400 bg-primary-50'
                    : apkgFile
                    ? 'border-green-400 bg-green-50'
                    : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
                }`}
              >
                <input {...getApkgInputProps()} />
                {apkgFile ? (
                  <>
                    <Package size={36} className="text-green-500 mb-3" />
                    <p className="font-medium text-gray-800">{apkgFile.name}</p>
                    <p className="text-sm text-gray-400 mt-1">
                      {(apkgFile.size / 1024 / 1024).toFixed(1)} MB – klicka för att byta
                    </p>
                  </>
                ) : (
                  <>
                    <Package size={36} className="text-gray-300 mb-3" />
                    <p className="font-medium text-gray-600">Släpp en .apkg-fil här eller klicka för att bläddra</p>
                    <p className="text-sm text-gray-400 mt-1">Exportera en kortlek från Anki och ladda upp den här</p>
                  </>
                )}
              </div>

              {/* Deck selector */}
              {apkgFile && (
                <div className="card p-5 space-y-4">
                  {/* Mode toggle */}
                  <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                    <button
                      onClick={() => setApkgDeckMode('existing')}
                      className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        apkgDeckMode === 'existing'
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Befintlig kortlek
                    </button>
                    <button
                      onClick={() => setApkgDeckMode('new')}
                      className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        apkgDeckMode === 'new'
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Ny kortlek
                    </button>
                  </div>

                  {apkgDeckMode === 'existing' ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Lägg till i kortlek
                      </label>
                      <select
                        value={selectedDeckId}
                        onChange={e => setSelectedDeckId(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-300 outline-none bg-white"
                      >
                        <option value="">Välj kortlek...</option>
                        {decks.map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                      {decks.length === 0 && (
                        <p className="text-xs text-gray-400 mt-1">
                          Inga kortlekar hittades. Välj "Ny kortlek" för att skapa en.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Namn på ny kortlek
                      </label>
                      <input
                        type="text"
                        value={newDeckName}
                        onChange={e => setNewDeckName(e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-300 outline-none"
                        placeholder="t.ex. Mikrobiologi – Anki-import"
                      />
                    </div>
                  )}

                  <p className="text-xs text-gray-400">
                    Korten importeras till vald kortlek. Duplicat hoppas över automatiskt.
                  </p>
                </div>
              )}

              {apkgError && (
                <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg border border-red-200 flex items-start gap-2">
                  <X size={14} className="flex-shrink-0 mt-0.5" />
                  {apkgError}
                </div>
              )}

              <button
                onClick={handleApkgImport}
                disabled={
                  !apkgFile ||
                  apkgPhase === 'importing' ||
                  (apkgDeckMode === 'existing' && selectedDeckId === '') ||
                  (apkgDeckMode === 'new' && newDeckName.trim() === '')
                }
                className="w-full btn-primary py-3 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {apkgPhase === 'importing' ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Importerar kort...
                  </>
                ) : (
                  <>
                    <Package size={16} />
                    Importera kortlek
                  </>
                )}
              </button>

              <div className="card p-4 bg-blue-50 border-blue-100">
                <p className="text-xs text-blue-700 font-medium mb-1">Hur exporterar du från Anki?</p>
                <ol className="text-xs text-blue-600 space-y-1 list-decimal list-inside">
                  <li>Öppna Anki på din dator</li>
                  <li>Välj kortleken du vill exportera</li>
                  <li>Klicka på kugghjulet → Exportera</li>
                  <li>Välj format: <strong>Anki Deck Package (.apkg)</strong></li>
                  <li>Klicka Exportera och spara filen</li>
                </ol>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
