import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { CheckCircle2, AlertTriangle, X, Info } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info'
type Toast = { id: number; message: string; type: ToastType }

const ToastContext = createContext<(msg: string, type?: ToastType) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

const ICONS = {
  success: <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />,
  error:   <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />,
  info:    <Info size={16} className="text-blue-500 flex-shrink-0" />,
}

const BG = {
  success: 'bg-white border-green-200',
  error:   'bg-white border-red-200',
  info:    'bg-white border-blue-200',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  let nextId = 0

  const show = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++nextId
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }, [])

  const remove = (id: number) => setToasts(prev => prev.filter(t => t.id !== id))

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-lg text-sm text-gray-800 pointer-events-auto
              animate-in slide-in-from-bottom-2 ${BG[t.type]}`}
          >
            {ICONS[t.type]}
            <span>{t.message}</span>
            <button onClick={() => remove(t.id)} className="ml-2 text-gray-400 hover:text-gray-600">
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
