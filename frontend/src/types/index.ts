// ─── Auth types ───────────────────────────────────────────────────────────────

export interface UserOut {
  id: number
  email: string | null
  name: string
  daily_goal: number
  created_at: string
}

export interface Token {
  access_token: string
  token_type: string
}

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
  is_public: boolean
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

export interface ExamStudyConfig {
  study_type: 'flashcards' | 'practice_tests' | 'reading' | 'mixed'
  no_flashcards: boolean
  practice_test_minutes: number
  daily_practice_tests: number
  summary: string
}

export interface Exam {
  id: number
  name: string
  exam_date: string
  description: string | null
  notes: string | null
  study_config: ExamStudyConfig | null
  created_at: string
  days_remaining: number | null
  relevant_deck_ids: number[]
}

export interface ExamCreate {
  name: string
  exam_date: string
  description?: string
  notes?: string
}

export interface ExamAnalyzeMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ExamAnalyzeResponse {
  done: boolean
  question?: string
  options?: string[]
  strategy?: ExamStudyConfig
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
  needs_reauth?: boolean
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
  | 'practice_test'
  | 'timed_drill'
  | 'mistake_review'
  | 'active_recall'
  | 'case_study'
  | 'resource'
  | 'lunch'
  | 'break'
  | 'gym'

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
  redirect_uri: string | null
}

// ─── AI Schedule types ────────────────────────────────────────────────────────

export type MasteryLevel = 'not_started' | 'learning' | 'familiar' | 'proficient' | 'mastered'

export interface StudentProfile {
  id: number
  user_id: number
  wake_time: string
  sleep_time: string
  peak_hours_start: string | null
  peak_hours_end: string | null
  max_daily_study_hours: number
  preferred_session_length_minutes: number
  preferred_break_length_minutes: number
  recurring_commitments: unknown[]
  commute_to_campus_minutes: number
  study_location_preference: string
  gym_days: string[]
  gym_time: string | null
  gym_duration_minutes: number
  session_structure_preference: string
  difficulty_preference: string
  feedback_style: string
  prior_bio_exposure: string
  prior_chem_exposure: string
  self_efficacy_score: number
  onboarding_completed: boolean
}

export interface ExamTopic {
  id: number
  exam_id: number
  user_id: number
  name: string
  subject: string
  parent_topic_id: number | null
  fsrs_stability: number
  fsrs_difficulty: number
  fsrs_retrievability: number
  fsrs_last_review: string | null
  fsrs_next_review: string | null
  mastery_level: MasteryLevel
  mastery_score: number
  total_study_minutes: number
  total_review_sessions: number
  average_quiz_score: number
  last_quiz_score: number | null
  error_streak: number
  estimated_hours_to_master: number | null
  source_document_ids: number[]
}

export interface AIStudyBlock {
  id: number
  schedule_id: number
  user_id: number
  topic_id: number | null
  block_number: number
  start_time: string
  end_time: string
  duration_minutes: number
  subject: string
  topic: string
  subtopic: string | null
  block_type: BlockType
  study_technique: string
  activity_title: string
  activity_description: string
  resources: string[]
  learning_objective: string
  is_spaced_repetition: boolean
  location: string | null
  requires_screen: boolean
  difficulty: number
  break_after_minutes: number
  completed: boolean
  completion_percentage: number
  self_reported_difficulty: number | null
  completion_notes: string | null
  completed_at: string | null
}

export interface ProactiveAlert {
  type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  category: string
  title: string
  message: string
  action: string | null
  topic_name: string | null
  exam_name: string | null
}

export interface AISchedule {
  id: number
  user_id: number
  schedule_date: string
  generated_at: string
  total_study_minutes: number
  summary: string
  tomorrow_preview: string | null
  generation_attempts: number
  student_approved: boolean
  student_feedback: string | null
  blocks: AIStudyBlock[]
  alerts: ProactiveAlert[]
}

export interface MockQuestion {
  id: number
  mock_exam_id: number
  topic_id: number | null
  question_number: number
  question_type: 'mcq' | 'short_answer'
  difficulty: 'easy' | 'medium' | 'hard'
  subject: string
  topic: string
  question_text: string
  options: string[] | null
  correct_answer: string
  explanation: string
  student_answer: string | null
  is_correct: boolean | null
  time_to_answer_seconds: number | null
  fsrs_rating: number | null
}

export interface MockExam {
  id: number
  user_id: number
  exam_id: number | null
  title: string
  duration_minutes: number
  instructions: string
  created_at: string
  submitted_at: string | null
  score_percent: number | null
  time_taken_minutes: number | null
  questions: MockQuestion[]
}

export interface WeeklyCheckin {
  id: number
  user_id: number
  week_start_date: string
  actual_study_hours: number
  target_study_hours: number | null
  sessions_completed: number
  sessions_skipped: number
  retention_by_subject: Record<string, number>
  overall_satisfaction: number | null
  hardest_subject_this_week: string | null
  biggest_challenge: string | null
  free_feedback: string | null
  ai_assessment: Record<string, unknown> | null
}

export interface TopicReadiness {
  topic_id: number
  topic_name: string
  mastery_score: number
  mastery_level: MasteryLevel
  retrievability: number
  next_review: string | null
  estimated_hours_to_master: number | null
}

export interface ExamReadiness {
  exam_id: number
  exam_name: string
  exam_date: string
  days_remaining: number
  readiness_score: number
  topics: TopicReadiness[]
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

// ─── AI Tutor ─────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  created_at: string
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
