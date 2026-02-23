import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
