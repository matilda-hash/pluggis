import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Trash2, Bot, User, Sparkles, Loader2 } from 'lucide-react'
import { tutorApi } from '../services/api'
import type { ChatMessage } from '../types'

function MessageBubble({ msg }: { msg: ChatMessage | { role: string; content: string; id: string } }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs ${
        isUser ? 'bg-pink-400' : 'bg-violet-500'
      }`}>
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      {/* Bubble */}
      <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
        isUser
          ? 'bg-pink-500 text-white rounded-tr-sm'
          : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm'
      }`}>
        {msg.content || <span className="text-gray-300 animate-pulse">●●●</span>}
      </div>
    </div>
  )
}

const SUGGESTIONS = [
  'Förklara renin-angiotensin-aldosteron-systemet',
  'Vad är skillnaden mellan T- och B-lymfocyter?',
  'Jag är stressad inför tentan, hur ska jag prioritera?',
  'Koppla ihop inflammation och patofysiologi för mig',
]

export default function TutorPage() {
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [clearing, setClearing] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    tutorApi.getHistory()
      .then(setHistory)
      .catch(() => {})
      .finally(() => setLoadingHistory(false))
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [history, streamingText, scrollToBottom])

  const handleSend = useCallback(async (messageText?: string) => {
    const text = (messageText ?? input).trim()
    if (!text || streaming) return

    setInput('')
    setStreaming(true)
    setStreamingText('')

    // Optimistically add user message
    const tempUserMsg: ChatMessage = {
      id: Date.now(),
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }
    setHistory(prev => [...prev, tempUserMsg])

    let accumulated = ''

    await tutorApi.streamChat(
      text,
      (chunk) => {
        accumulated += chunk
        setStreamingText(accumulated)
      },
      () => {
        // Stream done — add final assistant message to history
        const assistantMsg: ChatMessage = {
          id: Date.now() + 1,
          role: 'assistant',
          content: accumulated,
          created_at: new Date().toISOString(),
        }
        setHistory(prev => [...prev, assistantMsg])
        setStreamingText('')
        setStreaming(false)
      },
      (errMsg) => {
        const errorMsg: ChatMessage = {
          id: Date.now() + 1,
          role: 'assistant',
          content: `Fel: ${errMsg}`,
          created_at: new Date().toISOString(),
        }
        setHistory(prev => [...prev, errorMsg])
        setStreamingText('')
        setStreaming(false)
      },
    )
  }, [input, streaming])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = async () => {
    if (!window.confirm('Rensa all chatthistorik?')) return
    setClearing(true)
    await tutorApi.clearHistory().catch(() => {})
    setHistory([])
    setClearing(false)
  }

  const isEmpty = history.length === 0 && !streaming

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center">
            <Sparkles size={14} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-900">AI-handledare</h1>
            <p className="text-xs text-gray-400">Din personliga privathandledare med fullständigt kursmaterial</p>
          </div>
        </div>
        {history.length > 0 && (
          <button
            onClick={handleClear}
            disabled={clearing}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-500 transition-colors px-2 py-1"
            title="Ny konversation"
          >
            {clearing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            Ny konversation
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 min-h-0">
        {loadingHistory && (
          <div className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin text-gray-300" />
          </div>
        )}

        {isEmpty && !loadingHistory && (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-100 to-pink-100 flex items-center justify-center">
              <Sparkles size={28} className="text-violet-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800 mb-1">Hej! Jag är din AI-handledare</h2>
              <p className="text-sm text-gray-500 max-w-sm">
                Jag känner till dina tentor, kursmaterial och studieschema. Fråga mig om ämnen, be om förklaringar eller prata om hur du mår inför tentan.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="text-left text-xs px-3 py-2.5 rounded-xl border border-gray-200 bg-white hover:border-violet-300 hover:bg-violet-50 text-gray-600 hover:text-violet-700 transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isEmpty && history.map(msg => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {/* Streaming bubble */}
        {streaming && streamingText && (
          <MessageBubble
            msg={{ role: 'assistant', content: streamingText, id: 'streaming' }}
          />
        )}
        {streaming && !streamingText && (
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-violet-500 flex items-center justify-center">
              <Bot size={14} className="text-white" />
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
              <span className="flex gap-1">
                {[0,1,2].map(i => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 pt-3 flex-shrink-0">
        <div className="flex items-end gap-2 bg-white border border-gray-200 rounded-2xl px-3 py-2 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 transition-all">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Skriv din fråga... (Enter för att skicka, Shift+Enter för ny rad)"
            disabled={streaming}
            className="flex-1 resize-none text-sm outline-none text-gray-800 placeholder-gray-400 leading-relaxed max-h-32 overflow-y-auto bg-transparent"
            style={{ minHeight: '24px' }}
            onInput={e => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 128)}px`
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || streaming}
            className="flex-shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-all"
          >
            {streaming
              ? <Loader2 size={14} className="animate-spin" />
              : <Send size={14} />
            }
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5 text-center">
          AI-handledaren kan göra misstag — kontrollera viktiga fakta
        </p>
      </div>
    </div>
  )
}
