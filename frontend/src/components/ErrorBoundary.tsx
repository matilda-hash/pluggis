import { Component, ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
  resetKey?: string  // When this changes, auto-reset the boundary
}

interface State {
  hasError: boolean
  error: Error | null
  retryCount: number
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, retryCount: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidUpdate(prevProps: Props) {
    // Auto-reset when resetKey changes (e.g. on route navigation)
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null })
    }
  }

  componentDidCatch() {
    // Auto-retry once after 800ms — fixes transient initialization crashes
    if (this.state.retryCount === 0) {
      setTimeout(() => {
        this.setState(prev => ({
          hasError: false,
          error: null,
          retryCount: prev.retryCount + 1,
        }))
      }, 800)
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[40vh] flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <AlertTriangle size={36} className="text-amber-400 mx-auto mb-3" />
            <h2 className="text-base font-semibold text-gray-800 mb-2">Något gick fel</h2>
            <p className="text-xs text-gray-400 mb-5">
              {this.state.error?.message ?? 'Ett oväntat fel uppstod.'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null, retryCount: 0 })}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 flex items-center gap-2 mx-auto"
            >
              <RotateCcw size={14} />
              Försök igen
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
