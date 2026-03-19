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

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <BrowserRouter>
        <ErrorBoundary>
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
              <Route index element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
              <Route path="study" element={<ErrorBoundary><Study /></ErrorBoundary>} />
              <Route path="study/:deckId" element={<ErrorBoundary><Study /></ErrorBoundary>} />
              <Route path="upload" element={<ErrorBoundary><Upload /></ErrorBoundary>} />
              <Route path="cards/:deckId" element={<ErrorBoundary><Cards /></ErrorBoundary>} />
              <Route path="schedule" element={<ErrorBoundary><Schedule /></ErrorBoundary>} />
              <Route path="schedule/:date" element={<ErrorBoundary><Schedule /></ErrorBoundary>} />
              <Route path="documents" element={<ErrorBoundary><Documents /></ErrorBoundary>} />
              <Route path="documents/:docId" element={<ErrorBoundary><DocumentViewer /></ErrorBoundary>} />
              <Route path="pre-lecture/:lectureId" element={<ErrorBoundary><PreLecture /></ErrorBoundary>} />
              <Route path="settings" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
              <Route path="public-decks" element={<ErrorBoundary><PublicDecks /></ErrorBoundary>} />
              <Route path="ai-schedule" element={<ErrorBoundary><AISchedulePage /></ErrorBoundary>} />
              <Route path="ai-onboarding" element={<ErrorBoundary><AIOnboarding /></ErrorBoundary>} />
              <Route path="ai-topics" element={<ErrorBoundary><AITopics /></ErrorBoundary>} />
              <Route path="mock-exam/:examId" element={<ErrorBoundary><MockExamPage /></ErrorBoundary>} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  )
}
