import axios from 'axios'
import type {
  AISchedule,
  AIStudyBlock,
  AnkiStats,
  AnkiStatus,
  AppPreferences,
  AppSettings,
  BlockPlan,
  BlockStatus,
  CalendarEvent,
  CalendarStatus,
  Card,
  ChatMessage,
  Deck,
  DashboardStats,
  Document,
  DocumentListItem,
  Exam,
  ExamAnalyzeMessage,
  ExamAnalyzeResponse,
  ExamCreate,
  ExamReadiness,
  ExamTopic,
  GeneratedCard,
  Highlight,
  HighlightPriority,
  Lecture,
  LectureCreate,
  MockExam,
  PreLecturePayload,
  ReviewResult,
  StudentProfile,
  StudyBlock,
  StudySession,
  Token,
  UploadResult,
  UserOut,
  WeaknessMetric,
  WeeklyCheckin,
} from '../types'

const _apiBase = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api'

const http = axios.create({
  baseURL: _apiBase,
  headers: { 'Content-Type': 'application/json' },
})

// Inject JWT token into every request
http.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers = config.headers ?? {}
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  register: (email: string, password: string, name?: string): Promise<Token> =>
    http.post('/auth/register', { email, password, name }).then(r => r.data),

  login: (email: string, password: string): Promise<Token> => {
    const form = new URLSearchParams()
    form.append('username', email)
    form.append('password', password)
    return http.post('/auth/login', form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).then(r => r.data)
  },

  me: (): Promise<UserOut> => http.get('/auth/me').then(r => r.data),
}

// ─── Decks ────────────────────────────────────────────────────────────────────

export const decksApi = {
  list: (): Promise<Deck[]> => http.get('/decks/').then(r => r.data),

  create: (data: { name: string; description?: string; color?: string }): Promise<Deck> =>
    http.post('/decks/', data).then(r => r.data),

  get: (id: number): Promise<Deck> => http.get(`/decks/${id}`).then(r => r.data),

  update: (id: number, data: Partial<Deck>): Promise<Deck> =>
    http.put(`/decks/${id}`, data).then(r => r.data),

  delete: (id: number): Promise<void> => http.delete(`/decks/${id}`).then(r => r.data),

  listPublic: (): Promise<Deck[]> => http.get('/decks/public').then(r => r.data),

  copy: (id: number): Promise<Deck> => http.post(`/decks/${id}/copy`).then(r => r.data),
}

// ─── Cards ────────────────────────────────────────────────────────────────────

export const cardsApi = {
  list: (deckId: number): Promise<Card[]> =>
    http.get('/cards/', { params: { deck_id: deckId } }).then(r => r.data),

  create: (data: {
    deck_id: number
    card_type: string
    front?: string
    back?: string
    cloze_text?: string
  }): Promise<Card> => http.post('/cards/', data).then(r => r.data),

  update: (id: number, data: Partial<Card>): Promise<Card> =>
    http.put(`/cards/${id}`, data).then(r => r.data),

  delete: (id: number): Promise<void> => http.delete(`/cards/${id}`).then(r => r.data),
}

// ─── Study ────────────────────────────────────────────────────────────────────

export const studyApi = {
  queue: (deckId?: number): Promise<Card[]> =>
    http.get('/study/queue', { params: { deck_id: deckId } }).then(r => r.data),

  review: (cardId: number, rating: number, sessionId?: number): Promise<ReviewResult> =>
    http.post('/study/review', { card_id: cardId, rating, session_id: sessionId }).then(r => r.data),

  startSession: (deckId?: number): Promise<StudySession> =>
    http.post('/study/session/start', { deck_id: deckId }).then(r => r.data),

  endSession: (sessionId: number): Promise<StudySession> =>
    http.post('/study/session/end', null, { params: { session_id: sessionId } }).then(r => r.data),
}

// ─── Upload ───────────────────────────────────────────────────────────────────

export const uploadApi = {
  pdf: (file: File, deckName?: string, numCards: number = 40): Promise<UploadResult> => {
    const form = new FormData()
    form.append('file', file)
    if (deckName) form.append('deck_name', deckName)
    form.append('num_cards', String(numCards))
    return http.post('/upload/pdf', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  confirm: (deckId: number, cards: GeneratedCard[]): Promise<{ cards_saved: number }> =>
    http.post('/upload/confirm', { deck_id: deckId, cards }).then(r => r.data),
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export const statsApi = {
  dashboard: (): Promise<DashboardStats> => http.get('/stats/dashboard').then(r => r.data),
  deck: (id: number) => http.get(`/stats/deck/${id}`).then(r => r.data),
}

// ─── Exams ────────────────────────────────────────────────────────────────────

export const examsApi = {
  list: (): Promise<Exam[]> => http.get('/exams/').then(r => r.data),

  create: (data: ExamCreate): Promise<Exam> =>
    http.post('/exams/', data).then(r => r.data),

  update: (id: number, data: Partial<ExamCreate>): Promise<Exam> =>
    http.put(`/exams/${id}`, data).then(r => r.data),

  delete: (id: number): Promise<void> =>
    http.delete(`/exams/${id}`).then(r => r.data),

  analyze: (id: number, messages: ExamAnalyzeMessage[]): Promise<ExamAnalyzeResponse> =>
    http.post(`/exams/${id}/analyze`, { messages }).then(r => r.data),
}

// ─── Anki ─────────────────────────────────────────────────────────────────────

export const ankiApi = {
  status: (): Promise<AnkiStatus> =>
    http.get('/anki/status').then(r => r.data),

  stats: (): Promise<AnkiStats> =>
    http.get('/anki/stats').then(r => r.data),

  exportCards: (cardIds: number[], deckName: string): Promise<{ exported: number; errors: string[] }> =>
    http.post('/anki/export', { card_ids: cardIds, deck_name: deckName }).then(r => r.data),

  importApkg: (
    file: File,
    deckId?: number,
    newDeckName?: string,
  ): Promise<{ imported: number; skipped: number; deck_name: string }> => {
    const form = new FormData()
    form.append('file', file)
    if (newDeckName) {
      form.append('new_deck_name', newDeckName)
    } else if (deckId) {
      form.append('deck_id', String(deckId))
    }
    return http.post('/anki/import', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
}

// ─── Calendar ─────────────────────────────────────────────────────────────────

export const calendarApi = {
  status: (): Promise<CalendarStatus> =>
    http.get('/calendar/status').then(r => r.data),

  startAuth: (clientId: string, clientSecret: string, redirectUri: string): Promise<{ auth_url: string }> =>
    http.post('/calendar/auth/start', { client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }).then(r => r.data),

  callback: (code: string, clientId: string, clientSecret: string, redirectUri: string): Promise<{ ok: boolean }> =>
    http.post('/calendar/auth/callback', { code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }).then(r => r.data),

  disconnect: (): Promise<{ ok: boolean }> =>
    http.delete('/calendar/auth').then(r => r.data),

  events: (dateFrom?: string, dateTo?: string): Promise<CalendarEvent[]> =>
    http.get('/calendar/events', { params: { date_from: dateFrom, date_to: dateTo } }).then(r => r.data),

  sync: (): Promise<{ ok: boolean; synced: number }> =>
    http.post('/calendar/sync').then(r => r.data),

  createBlock: (blockId: number): Promise<{ ok: boolean; google_event_id: string }> =>
    http.post(`/calendar/create-block/${blockId}`).then(r => r.data),

  deleteEvent: (googleEventId: string): Promise<{ ok: boolean }> =>
    http.delete(`/calendar/event/${googleEventId}`).then(r => r.data),

  pushBlocks: (dateFrom: string, dateTo: string): Promise<{ ok: boolean; pushed: number }> =>
    http.post('/calendar/push-blocks', null, { params: { date_from: dateFrom, date_to: dateTo } }).then(r => r.data),
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

export const scheduleApi = {
  today: (): Promise<BlockPlan> =>
    http.get('/schedule/today').then(r => r.data),

  day: (dateStr: string): Promise<BlockPlan> =>
    http.get(`/schedule/day/${dateStr}`).then(r => r.data),

  generate: (options: { date?: string; morning_activation?: boolean; push_to_calendar?: boolean; post_work_minutes?: number }): Promise<BlockPlan> =>
    http.post('/schedule/generate', options).then(r => r.data),

  generateWeek: (weekStart?: string): Promise<BlockPlan[]> =>
    http.post('/schedule/generate-week', null, { params: weekStart ? { week_start: weekStart } : {} }).then(r => r.data),

  blocks: (dateFrom?: string, dateTo?: string): Promise<StudyBlock[]> =>
    http.get('/schedule/blocks', { params: { date_from: dateFrom, date_to: dateTo } }).then(r => r.data),

  updateBlock: (id: number, status: BlockStatus): Promise<StudyBlock> =>
    http.put(`/schedule/blocks/${id}`, { status }).then(r => r.data),

  deleteBlock: (id: number): Promise<{ ok: boolean }> =>
    http.delete(`/schedule/blocks/${id}`).then(r => r.data),

  lectures: (): Promise<Lecture[]> =>
    http.get('/schedule/lectures').then(r => r.data),

  createLecture: (data: LectureCreate): Promise<Lecture> =>
    http.post('/schedule/lectures', data).then(r => r.data),

  updateLecture: (id: number, data: Partial<LectureCreate>): Promise<Lecture> =>
    http.put(`/schedule/lectures/${id}`, data).then(r => r.data),

  deleteLecture: (id: number): Promise<{ ok: boolean }> =>
    http.delete(`/schedule/lectures/${id}`).then(r => r.data),
}

// ─── Documents ────────────────────────────────────────────────────────────────

export const documentsApi = {
  upload: (
    file: File,
    deckId?: number,
    title?: string,
  ): Promise<{ document_id: number; title: string; html_content: string }> => {
    const form = new FormData()
    form.append('file', file)
    if (deckId) form.append('deck_id', String(deckId))
    if (title) form.append('title', title)
    return http.post('/documents/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  list: (): Promise<DocumentListItem[]> =>
    http.get('/documents/').then(r => r.data),

  get: (id: number): Promise<Document> =>
    http.get(`/documents/${id}`).then(r => r.data),

  delete: (id: number): Promise<{ ok: boolean }> =>
    http.delete(`/documents/${id}`).then(r => r.data),

  addHighlight: (
    docId: number,
    data: { priority: HighlightPriority; text_content: string; html_range_start?: string; html_range_end?: string },
  ): Promise<Highlight> =>
    http.post(`/documents/${docId}/highlights`, data).then(r => r.data),

  listHighlights: (docId: number): Promise<Highlight[]> =>
    http.get(`/documents/${docId}/highlights`).then(r => r.data),

  deleteHighlight: (docId: number, highlightId: number): Promise<{ ok: boolean }> =>
    http.delete(`/documents/${docId}/highlights/${highlightId}`).then(r => r.data),

  generateCards: (
    docId: number,
    data: { highlight_ids?: number[]; deck_id: number; num_cards?: number },
  ): Promise<UploadResult> =>
    http.post(`/documents/${docId}/generate-cards`, data).then(r => r.data),

  confirmCards: (
    docId: number,
    deckId: number,
    cards: GeneratedCard[],
  ): Promise<{ ok: boolean; cards_saved: number }> =>
    http.post(`/documents/${docId}/confirm-cards`, { deck_id: deckId, cards, document_id: docId }).then(r => r.data),
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export const settingsApi = {
  get: (): Promise<AppSettings> =>
    http.get('/settings/').then(r => r.data),

  update: (data: AppPreferences): Promise<AppSettings> =>
    http.put('/settings/', data).then(r => r.data),

  getPreferences: (): Promise<AppPreferences> =>
    http.get('/settings/preferences').then(r => r.data),

  updatePreferences: (data: AppPreferences): Promise<AppPreferences> =>
    http.put('/settings/preferences', data).then(r => r.data),
}

// ─── Tags & Weakness ──────────────────────────────────────────────────────────

export const tagsApi = {
  list: (): Promise<{ id: number; tag: string; tag_type: string; usage_count: number }[]> =>
    http.get('/tags/').then(r => r.data),

  weakness: (): Promise<WeaknessMetric[]> =>
    http.get('/tags/weakness').then(r => r.data),

  syncWeakness: (): Promise<{ ok: boolean }> =>
    http.post('/tags/sync-weakness').then(r => r.data),
}

// ─── Pre-lecture ──────────────────────────────────────────────────────────────

export const preLectureApi = {
  get: (lectureId: number): Promise<PreLecturePayload> =>
    http.get(`/pre-lecture/${lectureId}`).then(r => r.data),

  generateQuiz: (lectureId: number, numQuestions: number = 10): Promise<{ questions: PreLecturePayload['mini_quiz'] }> =>
    http.post(`/pre-lecture/${lectureId}/mini-quiz`, { num_questions: numQuestions }).then(r => r.data),

  refresh: (lectureId: number): Promise<PreLecturePayload> =>
    http.post(`/pre-lecture/${lectureId}/refresh`).then(r => r.data),
}

// ─── AI Schedule ──────────────────────────────────────────────────────────────

export const aiScheduleApi = {
  // Profile / Onboarding
  getProfile: (): Promise<StudentProfile> =>
    http.get('/ai-schedule/profile').then(r => r.data),

  saveProfile: (data: Partial<StudentProfile>): Promise<StudentProfile> =>
    http.post('/ai-schedule/profile', data).then(r => r.data),

  // Topics
  listTopics: (examId?: number): Promise<ExamTopic[]> =>
    http.get('/ai-schedule/topics', { params: examId ? { exam_id: examId } : {} }).then(r => r.data),

  createTopic: (data: {
    exam_id: number
    name: string
    subject: string
    parent_topic_id?: number
  }): Promise<ExamTopic> =>
    http.post('/ai-schedule/topics', data).then(r => r.data),

  bulkCreateTopics: (topics: Array<{
    exam_id: number
    name: string
    subject: string
  }>): Promise<ExamTopic[]> =>
    http.post('/ai-schedule/topics/bulk', { topics }).then(r => r.data),

  reviewTopic: (topicId: number, rating: 1 | 2 | 3 | 4): Promise<ExamTopic> =>
    http.post(`/ai-schedule/topics/${topicId}/review`, { rating }).then(r => r.data),

  deleteTopic: (topicId: number): Promise<{ ok: boolean }> =>
    http.delete(`/ai-schedule/topics/${topicId}`).then(r => r.data),

  // Daily schedule
  getToday: (regenerate = false): Promise<AISchedule> =>
    http.get('/ai-schedule/schedule/today', { params: { regenerate } }).then(r => r.data),

  submitFeedback: (feedback: string): Promise<AISchedule> =>
    http.post('/ai-schedule/schedule/feedback', { feedback_type: 'free_text', feedback_text: feedback }).then(r => r.data),

  completeBlock: (blockId: number, data: {
    completion_percentage?: number
    self_reported_difficulty?: number
    completion_notes?: string
  }): Promise<AIStudyBlock> =>
    http.post(`/ai-schedule/schedule/block/${blockId}/complete`, data).then(r => r.data),

  getWeek: (weekStart?: string): Promise<AISchedule[]> =>
    http.get('/ai-schedule/schedule/week', { params: weekStart ? { week_start: weekStart } : {} }).then(r => r.data),

  // Mock exams
  generateMockExam: (data: {
    exam_id?: number
    duration_minutes?: number
    n_questions?: number
  }): Promise<MockExam> =>
    http.post('/ai-schedule/mock-exam/generate', data).then(r => r.data),

  getMockExam: (examId: number): Promise<MockExam> =>
    http.get(`/ai-schedule/mock-exam/${examId}`).then(r => r.data),

  listMockExams: (): Promise<MockExam[]> =>
    http.get('/ai-schedule/mock-exam').then(r => r.data),

  submitMockExam: (examId: number, answers: Record<number, string>): Promise<MockExam> =>
    http.post(`/ai-schedule/mock-exam/${examId}/submit`, { answers }).then(r => r.data),

  // Weekly check-in
  getCheckin: (): Promise<WeeklyCheckin> =>
    http.get('/ai-schedule/checkin/weekly').then(r => r.data),

  saveCheckin: (data: {
    overall_satisfaction?: number
    hardest_subject_this_week?: string
    biggest_challenge?: string
    free_feedback?: string
  }): Promise<WeeklyCheckin> =>
    http.post('/ai-schedule/checkin/weekly', data).then(r => r.data),

  // Analytics
  getReadiness: (): Promise<ExamReadiness[]> =>
    http.get('/ai-schedule/analytics/readiness').then(r => r.data),
}

// ─── AI Tutor ─────────────────────────────────────────────────────────────────

export const tutorApi = {
  getHistory: (): Promise<ChatMessage[]> =>
    http.get('/tutor/history').then(r => r.data),

  clearHistory: (): Promise<{ ok: boolean }> =>
    http.delete('/tutor/history').then(r => r.data),

  /** Returns the base URL for SSE streaming (caller handles EventSource/fetch) */
  getChatUrl: (): string => `${_apiBase}/tutor/chat`,

  /** Send a message and stream the response via fetch SSE. */
  streamChat: async (
    message: string,
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (msg: string) => void,
  ): Promise<void> => {
    const token = localStorage.getItem('token')
    const res = await fetch(`${_apiBase}/tutor/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message }),
    })
    if (!res.ok || !res.body) {
      onError('Kunde inte ansluta till handledaren.')
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const payload = JSON.parse(line.slice(6))
          if (payload.chunk) onChunk(payload.chunk)
          if (payload.done) onDone()
          if (payload.error) onError(payload.error)
        } catch {
          // malformed line — skip
        }
      }
    }
  },
}
