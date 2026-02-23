import axios from 'axios'
import type {
  AnkiStats,
  AnkiStatus,
  AppPreferences,
  AppSettings,
  BlockPlan,
  BlockStatus,
  CalendarEvent,
  CalendarStatus,
  Card,
  Deck,
  DashboardStats,
  Document,
  DocumentListItem,
  Exam,
  ExamCreate,
  GeneratedCard,
  Highlight,
  HighlightPriority,
  Lecture,
  LectureCreate,
  PreLecturePayload,
  ReviewResult,
  StudyBlock,
  StudySession,
  UploadResult,
  WeaknessMetric,
} from '../types'

const http = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// ─── Decks ────────────────────────────────────────────────────────────────────

export const decksApi = {
  list: (): Promise<Deck[]> => http.get('/decks/').then(r => r.data),

  create: (data: { name: string; description?: string; color?: string }): Promise<Deck> =>
    http.post('/decks/', data).then(r => r.data),

  get: (id: number): Promise<Deck> => http.get(`/decks/${id}`).then(r => r.data),

  update: (id: number, data: Partial<Deck>): Promise<Deck> =>
    http.put(`/decks/${id}`, data).then(r => r.data),

  delete: (id: number): Promise<void> => http.delete(`/decks/${id}`).then(r => r.data),
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
}

// ─── Anki ─────────────────────────────────────────────────────────────────────

export const ankiApi = {
  status: (): Promise<AnkiStatus> =>
    http.get('/anki/status').then(r => r.data),

  stats: (): Promise<AnkiStats> =>
    http.get('/anki/stats').then(r => r.data),

  exportCards: (cardIds: number[], deckName: string): Promise<{ exported: number; errors: string[] }> =>
    http.post('/anki/export', { card_ids: cardIds, deck_name: deckName }).then(r => r.data),

  importApkg: (file: File, deckId: number): Promise<{ imported: number; skipped: number; deck_name: string }> => {
    const form = new FormData()
    form.append('file', file)
    form.append('deck_id', String(deckId))
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
