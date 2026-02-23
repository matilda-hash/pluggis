// ─── Card types ───────────────────────────────────────────────────────────────

export type CardType =
  | 'basic'
  | 'cloze'
  | 'image_occlusion'
  | 'definition_to_term'
  | 'term_to_definition'
  | 'single_cloze'
  | 'multi_cloze'
  | 'true_false'
  | 'cause_effect'
  | 'effect_cause'
  | 'light_scenario'
  | 'process_sequence'
  | 'contrast_comparison'
  | 'numerical_recall'

export type CardStateEnum = 0 | 1 | 2 | 3 // New | Learning | Review | Relearning

export interface CardState {
  stability: number
  difficulty: number
  due: string | null
  last_review: string | null
  reps: number
  lapses: number
  state: CardStateEnum
}

export interface Card {
  id: number
  deck_id: number
  card_type: CardType
  front: string | null
  back: string | null
  cloze_text: string | null
  is_suspended: boolean
  tags: string[]
  created_at: string
  state: CardState | null
}

// ─── Deck types ───────────────────────────────────────────────────────────────

export type DeckStatus = 'mastered' | 'maintaining' | 'in_progress' | 'new'

export interface DeckStats {
  total_cards: number
  new_cards: number
  due_today: number
  learning: number
  review: number
  mastery_rate: number
  status: DeckStatus
  recent_forget_rate: number  // fraction of Again in last 7 days
  exam_priority: number       // 0–1 relevance to nearest exam
}

export interface Deck {
  id: number
  name: string
  description: string | null
  color: string
  source_type: string | null
  source_filename: string | null
  is_active: boolean
  created_at: string
  stats: DeckStats | null
}

// ─── Study types ──────────────────────────────────────────────────────────────

export type Rating = 1 | 2 | 3 | 4 // Again | Hard | Good | Easy

export interface ReviewResult {
  ok: boolean
  next_due: string
  new_state: number
  stability: number
  interval_days: number
}

export interface StudySession {
  id: number
  deck_id: number | null
  started_at: string
  ended_at: string | null
  cards_studied: number
  again_count: number
  hard_count: number
  good_count: number
  easy_count: number
}

// ─── Stats types ──────────────────────────────────────────────────────────────

export interface DailyCount {
  date: string
  count: number
}

export interface TodayStats {
  cards_studied: number
  time_studied_minutes: number
  est_time_goal_minutes: number  // estimated time to complete smart_daily_goal
  again: number
  hard: number
  good: number
  easy: number
  skipped: number
  streak: number
  daily_goal: number
  smart_daily_goal: number       // AI-adjusted goal
  total_due: number
  nearest_exam_name: string | null
  nearest_exam_days: number | null
}

// ─── Exam types ───────────────────────────────────────────────────────────────

export interface Exam {
  id: number
  name: string
  exam_date: string
  description: string | null
  created_at: string
  days_remaining: number | null
  relevant_deck_ids: number[]
}

export interface ExamCreate {
  name: string
  exam_date: string
  description?: string
}

export interface DashboardStats {
  today: TodayStats
  weekly: DailyCount[]
  history: DailyCount[]
  new_cards_history: DailyCount[]
}

// ─── Upload types ─────────────────────────────────────────────────────────────

export interface GeneratedCard {
  card_type: CardType
  front: string | null
  back: string | null
  cloze_text: string | null
  tags: string[]
  subject_tag: string | null
  concept_tag: string | null
  type_tag: string | null
  context_tag: string | null
  source_metadata: Record<string, unknown>
}

export interface UploadResult {
  deck_id: number
  deck_name: string
  cards_generated: number
  cards: GeneratedCard[]
}

// ─── Anki types ───────────────────────────────────────────────────────────────

export interface AnkiStatus {
  available: boolean
  version: string | null
}

export interface AnkiStats {
  available: boolean
  due: number
  new_cards: number
  lapses_by_tag: Record<string, number>
  est_review_minutes: number
}

// ─── Calendar types ───────────────────────────────────────────────────────────

export interface CalendarStatus {
  authenticated: boolean
  email: string | null
}

export interface CalendarEvent {
  id: number
  google_event_id: string | null
  title: string
  start_dt: string
  end_dt: string
  location: string | null
  event_type: string
  is_in_person: boolean
}

// ─── Lecture types ────────────────────────────────────────────────────────────

export interface Lecture {
  id: number
  title: string
  lecture_date: string
  subject_tag: string | null
  is_in_person: boolean
  is_difficult: boolean
  source: 'calendar' | 'manual'
  notes: string | null
  created_at: string
}

export interface LectureCreate {
  title: string
  lecture_date: string
  subject_tag?: string
  is_in_person?: boolean
  is_difficult?: boolean
  source?: string
  notes?: string
  calendar_event_id?: number
}

// ─── Study blocks ─────────────────────────────────────────────────────────────

export type BlockType =
  | 'pre_lecture'
  | 'post_lecture'
  | 'daily_repetition'
  | 'reading'
  | 'activation'

export type BlockStatus = 'planned' | 'started' | 'done' | 'skipped'

export interface StudyBlock {
  id: number
  lecture_id: number | null
  block_type: BlockType
  scheduled_date: string
  start_time: string | null
  end_time: string | null
  duration_minutes: number
  status: BlockStatus
  compression_level: number
  payload: Record<string, unknown>
  created_at: string
  google_event_id: string | null
}

export interface BlockPlan {
  blocks: StudyBlock[]
  total_minutes: number
  compression_applied: boolean
  date: string
  work_ends_at: string | null  // ISO datetime of last work event end, if any
}

// ─── Documents ────────────────────────────────────────────────────────────────

export type HighlightPriority = 'important' | 'difficult' | 'low'

export interface Document {
  id: number
  title: string
  original_filename: string
  html_content: string
  deck_id: number | null
  created_at: string
}

export interface DocumentListItem {
  id: number
  title: string
  original_filename: string
  deck_id: number | null
  highlight_count: number
  created_at: string
}

export interface Highlight {
  id: number
  document_id: number
  priority: HighlightPriority
  text_content: string
  html_range_start: string | null
  html_range_end: string | null
  created_at: string
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface DaySchedule {
  enabled: boolean
  max_hours: number   // max study hours for this day
}

export interface AppPreferences {
  daily_goal: number
  morning_activation: boolean
  study_window_start: string
  study_window_end: string
  anki_connect_url: string
  weekly_hours: number
  study_days: Record<string, DaySchedule>  // "monday"…"sunday" → config
}

export interface AppSettings {
  preferences: AppPreferences
  anki_available: boolean
  calendar_authenticated: boolean
  calendar_email: string | null
}

// ─── Weakness ─────────────────────────────────────────────────────────────────

export interface WeaknessMetric {
  tag: string
  lapse_rate: number
  lapse_count_30d: number
  total_reviews_30d: number
  avg_stability: number
  computed_at: string
}

// ─── Pre-lecture ──────────────────────────────────────────────────────────────

export interface MiniQuizQuestion {
  question: string
  answer: string
  card_type: string
}

export interface YouTubeSuggestion {
  title: string
  search_query: string
}

export interface PreLecturePayload {
  lecture_title: string
  block_duration_minutes: number
  card_review_minutes: number
  targeted_card_ids: number[]
  mini_quiz: MiniQuizQuestion[]
  what_to_listen_for: string[]
  reading_task: string | null
  youtube_suggestions: YouTubeSuggestion[]
}
