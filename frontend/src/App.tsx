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
            <Route index element={<Dashboard />} />
            <Route path="study" element={<Study />} />
            <Route path="study/:deckId" element={<Study />} />
            <Route path="upload" element={<Upload />} />
            <Route path="cards/:deckId" element={<Cards />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="schedule/:date" element={<Schedule />} />
            <Route path="documents" element={<Documents />} />
            <Route path="documents/:docId" element={<DocumentViewer />} />
            <Route path="pre-lecture/:lectureId" element={<PreLecture />} />
            <Route path="settings" element={<Settings />} />
            <Route path="public-decks" element={<PublicDecks />} />
            <Route path="ai-schedule" element={<AISchedulePage />} />
            <Route path="ai-onboarding" element={<AIOnboarding />} />
            <Route path="ai-topics" element={<AITopics />} />
            <Route path="mock-exam/:examId" element={<MockExamPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
