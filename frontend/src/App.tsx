import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Study from './pages/Study'
import Upload from './pages/Upload'
import Cards from './pages/Cards'
import Schedule from './pages/Schedule'
import Documents from './pages/Documents'
import DocumentViewer from './pages/DocumentViewer'
import PreLecture from './pages/PreLecture'
import Settings from './pages/Settings'
import Login from './pages/Login'
import Register from './pages/Register'
import PublicDecks from './pages/PublicDecks'
import AISchedulePage from './pages/AISchedule'
import AIOnboarding from './pages/AIOnboarding'
import AITopics from './pages/AITopics'
import MockExamPage from './pages/MockExamPage'
import { Loader2 } from 'lucide-react'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastProvider } from './components/Toast'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return <>{children}</>
}

// Resets ErrorBoundary automatically on every route change
function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  return (
    <ErrorBoundary resetKey={location.pathname}>
      {children}
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            {/* Public auth routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            {/* Protected app routes */}
            <Route element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }>
              <Route index element={<RouteErrorBoundary><Dashboard /></RouteErrorBoundary>} />
              <Route path="study" element={<RouteErrorBoundary><Study /></RouteErrorBoundary>} />
              <Route path="study/:deckId" element={<RouteErrorBoundary><Study /></RouteErrorBoundary>} />
              <Route path="upload" element={<RouteErrorBoundary><Upload /></RouteErrorBoundary>} />
              <Route path="cards/:deckId" element={<RouteErrorBoundary><Cards /></RouteErrorBoundary>} />
              <Route path="schedule" element={<RouteErrorBoundary><Schedule /></RouteErrorBoundary>} />
              <Route path="schedule/:date" element={<RouteErrorBoundary><Schedule /></RouteErrorBoundary>} />
              <Route path="documents" element={<RouteErrorBoundary><Documents /></RouteErrorBoundary>} />
              <Route path="documents/:docId" element={<RouteErrorBoundary><DocumentViewer /></RouteErrorBoundary>} />
              <Route path="pre-lecture/:lectureId" element={<RouteErrorBoundary><PreLecture /></RouteErrorBoundary>} />
              <Route path="settings" element={<RouteErrorBoundary><Settings /></RouteErrorBoundary>} />
              <Route path="public-decks" element={<RouteErrorBoundary><PublicDecks /></RouteErrorBoundary>} />
              <Route path="ai-schedule" element={<RouteErrorBoundary><AISchedulePage /></RouteErrorBoundary>} />
              <Route path="ai-onboarding" element={<RouteErrorBoundary><AIOnboarding /></RouteErrorBoundary>} />
              <Route path="ai-topics" element={<RouteErrorBoundary><AITopics /></RouteErrorBoundary>} />
              <Route path="mock-exam/:examId" element={<RouteErrorBoundary><MockExamPage /></RouteErrorBoundary>} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  )
}
