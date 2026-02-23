import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import {
  FileText, Upload, Highlighter, Trash2, RefreshCw, Package,
} from 'lucide-react'
import type { DocumentListItem, Deck } from '../types'
import { documentsApi, decksApi, ankiApi } from '../services/api'

export default function Documents() {
  const [docs, setDocs] = useState<DocumentListItem[]>([])
  const [decks, setDecks] = useState<Deck[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [selectedDeckId, setSelectedDeckId] = useState<number | ''>('')
  const [importingApkg, setImportingApkg] = useState(false)
  const [apkgDeckId, setApkgDeckId] = useState<number | ''>('')
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([
      documentsApi.list(),
      decksApi.list(),
    ]).then(([docsData, decksData]) => {
      setDocs(docsData)
      setDecks(decksData)
    }).finally(() => setLoading(false))
  }, [])

  const onDropPdf = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    setUploading(true)
    try {
      const result = await documentsApi.upload(
        file,
        selectedDeckId ? Number(selectedDeckId) : undefined,
      )
      navigate(`/documents/${result.document_id}`)
    } catch (e) {
      console.error('Upload failed', e)
    } finally {
      setUploading(false)
    }
  }, [selectedDeckId, navigate])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropPdf,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: false,
    disabled: uploading,
  })

  async function handleDeleteDoc(id: number) {
    if (!confirm('Ta bort dokumentet?')) return
    await documentsApi.delete(id)
    setDocs(prev => prev.filter(d => d.id !== id))
  }

  async function handleImportApkg(file: File) {
    if (!apkgDeckId) { alert('Välj ett lek att importera till.'); return }
    setImportingApkg(true)
    try {
      const result = await ankiApi.importApkg(file, Number(apkgDeckId))
      alert(`Importerade ${result.imported} kort (${result.skipped} hoppades över) till ${result.deck_name}`)
    } catch (e) {
      console.error(e)
      alert('Import misslyckades')
    } finally {
      setImportingApkg(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <FileText size={24} className="text-primary-600" />
        <h1 className="text-2xl font-bold text-gray-900">Dokument</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: upload + list */}
        <div className="lg:col-span-2 space-y-4">
          {/* PDF upload zone */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
            <h2 className="font-semibold text-gray-900">Ladda upp PDF</h2>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600">Länka till lek (valfritt):</label>
              <select
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm flex-1"
                value={selectedDeckId}
                onChange={e => setSelectedDeckId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Ingen lek</option>
                {decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                isDragActive ? 'border-primary-500 bg-primary-50' : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
              } ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <input {...getInputProps()} />
              {uploading ? (
                <div className="flex flex-col items-center gap-2">
                  <RefreshCw size={32} className="text-primary-500 animate-spin" />
                  <p className="text-sm text-gray-600">Konverterar PDF till HTML...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload size={32} className="text-gray-400" />
                  <p className="text-sm font-medium text-gray-700">
                    {isDragActive ? 'Släpp PDF här' : 'Dra och släpp en PDF, eller klicka för att välja'}
                  </p>
                  <p className="text-xs text-gray-400">PDF-filer • konverteras för markering</p>
                </div>
              )}
            </div>
          </div>

          {/* Document list */}
          {loading ? (
            <div className="text-center py-8 text-gray-400">Laddar...</div>
          ) : docs.length === 0 ? (
            <div className="text-center py-12 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
              <FileText size={48} className="mx-auto mb-3 opacity-30" />
              <p>Inga dokument uppladdade ännu.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {docs.map(doc => (
                <div
                  key={doc.id}
                  className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between hover:border-primary-300 transition-colors cursor-pointer"
                  onClick={() => navigate(`/documents/${doc.id}`)}
                >
                  <div className="flex items-start gap-3">
                    <FileText size={20} className="text-primary-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-gray-900">{doc.title}</p>
                      <p className="text-xs text-gray-500">{doc.original_filename}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                        <span>{new Date(doc.created_at).toLocaleDateString('sv-SE')}</span>
                        {doc.highlight_count > 0 && (
                          <span className="flex items-center gap-1">
                            <Highlighter size={11} />
                            {doc.highlight_count} markeringar
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteDoc(doc.id) }}
                    className="p-2 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Anki import */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Package size={18} className="text-indigo-600" />
              <h2 className="font-semibold text-gray-900">Importera Anki-lek</h2>
            </div>
            <p className="text-xs text-gray-500">Importera en .apkg-fil och lägg till korten i en intern lek.</p>
            <div>
              <label className="text-sm text-gray-600 mb-1 block">Importera till lek:</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={apkgDeckId}
                onChange={e => setApkgDeckId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Välj lek...</option>
                {decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <label className={`block w-full py-2 px-4 text-center text-sm border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 ${importingApkg ? 'opacity-50 cursor-not-allowed' : ''}`}>
              {importingApkg ? (
                <span className="flex items-center justify-center gap-2">
                  <RefreshCw size={14} className="animate-spin" /> Importerar...
                </span>
              ) : (
                '+ Välj .apkg-fil'
              )}
              <input
                type="file"
                accept=".apkg"
                className="hidden"
                disabled={importingApkg}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) handleImportApkg(file)
                }}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
