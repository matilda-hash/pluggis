from pydantic import BaseModel
from typing import Optional, List, Any, Dict
from datetime import datetime, date


# ─── Card State ───────────────────────────────────────────────────────────────

class CardStateOut(BaseModel):
    stability: float
    difficulty: float
    due: Optional[datetime]
    last_review: Optional[datetime]
    reps: int
    lapses: int
    state: int

    class Config:
        from_attributes = True


# ─── Cards ────────────────────────────────────────────────────────────────────

class CardCreate(BaseModel):
    deck_id: int
    card_type: str = "basic"
    front: Optional[str] = None
    back: Optional[str] = None
    cloze_text: Optional[str] = None
    tags: List[str] = []


class CardUpdate(BaseModel):
    card_type: Optional[str] = None
    front: Optional[str] = None
    back: Optional[str] = None
    cloze_text: Optional[str] = None
    is_suspended: Optional[bool] = None
    tags: Optional[List[str]] = None


class CardOut(BaseModel):
    id: int
    deck_id: int
    card_type: str
    front: Optional[str]
    back: Optional[str]
    cloze_text: Optional[str]
    is_suspended: bool
    tags: List[Any]
    created_at: datetime
    state: Optional[CardStateOut]

    class Config:
        from_attributes = True


# ─── Decks ────────────────────────────────────────────────────────────────────

class DeckCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: str = "#4F46E5"


class DeckUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    is_active: Optional[bool] = None


class DeckStats(BaseModel):
    total_cards: int
    new_cards: int
    due_today: int
    learning: int
    review: int
    mastery_rate: float
    status: str                      # 'mastered' | 'in_progress' | 'maintaining' | 'new'
    recent_forget_rate: float = 0.0  # fraction of Again ratings in last 7 days
    exam_priority: float = 0.0       # 0–1 relevance score to nearest upcoming exam


class DeckOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    color: str
    source_type: Optional[str]
    source_filename: Optional[str]
    is_active: bool
    created_at: datetime
    stats: Optional[DeckStats] = None

    class Config:
        from_attributes = True


# ─── Reviews ──────────────────────────────────────────────────────────────────

class ReviewSubmit(BaseModel):
    card_id: int
    rating: int  # 1=Igen, 2=Svårt, 3=Bra, 4=Lätt
    session_id: Optional[int] = None


class ReviewOut(BaseModel):
    id: int
    card_id: int
    rating: int
    state_before: int
    stability_after: float
    difficulty_after: float
    scheduled_days: int
    elapsed_days: int
    reviewed_at: datetime

    class Config:
        from_attributes = True


# ─── Study Session ────────────────────────────────────────────────────────────

class SessionStart(BaseModel):
    deck_id: Optional[int] = None


class SessionOut(BaseModel):
    id: int
    deck_id: Optional[int]
    started_at: datetime
    ended_at: Optional[datetime]
    cards_studied: int
    again_count: int
    hard_count: int
    good_count: int
    easy_count: int

    class Config:
        from_attributes = True


# ─── Upload ───────────────────────────────────────────────────────────────────

class GeneratedCard(BaseModel):
    card_type: str
    front: Optional[str] = None
    back: Optional[str] = None
    cloze_text: Optional[str] = None
    # Extended tag metadata (populated by ExpandedCardGenerator)
    tags: List[str] = []
    subject_tag: Optional[str] = None
    concept_tag: Optional[str] = None
    type_tag: Optional[str] = None
    context_tag: Optional[str] = None
    source_metadata: Dict[str, Any] = {}


class UploadResult(BaseModel):
    deck_id: int
    deck_name: str
    cards_generated: int
    cards: List[GeneratedCard]


class CardsBulkCreate(BaseModel):
    deck_id: int
    cards: List[GeneratedCard]


# ─── Exams ────────────────────────────────────────────────────────────────────

class ExamCreate(BaseModel):
    name: str
    exam_date: datetime
    description: Optional[str] = None


class ExamUpdate(BaseModel):
    name: Optional[str] = None
    exam_date: Optional[datetime] = None
    description: Optional[str] = None


class ExamOut(BaseModel):
    id: int
    name: str
    exam_date: datetime
    description: Optional[str]
    created_at: datetime
    days_remaining: Optional[int] = None  # computed
    relevant_deck_ids: List[int] = []     # computed

    class Config:
        from_attributes = True


# ─── Stats ────────────────────────────────────────────────────────────────────

class DailyCount(BaseModel):
    date: str
    count: int


class TodayStats(BaseModel):
    cards_studied: int
    time_studied_minutes: int
    est_time_goal_minutes: int    # estimated total time to complete smart_daily_goal
    again: int
    hard: int
    good: int
    easy: int
    skipped: int
    streak: int
    daily_goal: int
    smart_daily_goal: int         # AI-adjusted goal based on exam + performance
    total_due: int
    nearest_exam_name: Optional[str] = None
    nearest_exam_days: Optional[int] = None


class DashboardStats(BaseModel):
    today: TodayStats
    weekly: List[DailyCount]
    history: List[DailyCount]
    new_cards_history: List[DailyCount]


# ─── Anki ─────────────────────────────────────────────────────────────────────

class AnkiStatus(BaseModel):
    available: bool
    version: Optional[str] = None


class AnkiStats(BaseModel):
    available: bool
    due: int
    new_cards: int
    lapses_by_tag: Dict[str, int]
    est_review_minutes: int


class AnkiExportRequest(BaseModel):
    card_ids: List[int]
    deck_name: str


# ─── Calendar ─────────────────────────────────────────────────────────────────

class CalendarStatus(BaseModel):
    authenticated: bool
    email: Optional[str] = None


class CalendarAuthStart(BaseModel):
    client_id: str
    client_secret: str
    redirect_uri: str


class CalendarAuthCallback(BaseModel):
    code: str
    client_id: str
    client_secret: str
    redirect_uri: str


class CalendarEventOut(BaseModel):
    id: int
    google_event_id: Optional[str]
    title: str
    start_dt: datetime
    end_dt: datetime
    location: Optional[str]
    event_type: str
    is_in_person: bool

    class Config:
        from_attributes = True


# ─── Lectures ─────────────────────────────────────────────────────────────────

class LectureCreate(BaseModel):
    title: str
    lecture_date: datetime
    subject_tag: Optional[str] = None
    is_in_person: bool = False
    is_difficult: bool = False
    source: str = "manual"
    notes: Optional[str] = None
    calendar_event_id: Optional[int] = None


class LectureUpdate(BaseModel):
    title: Optional[str] = None
    lecture_date: Optional[datetime] = None
    subject_tag: Optional[str] = None
    is_in_person: Optional[bool] = None
    is_difficult: Optional[bool] = None
    notes: Optional[str] = None


class LectureOut(BaseModel):
    id: int
    title: str
    lecture_date: datetime
    subject_tag: Optional[str]
    is_in_person: bool
    is_difficult: bool
    source: str
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ─── Study Blocks ─────────────────────────────────────────────────────────────

class StudyBlockOut(BaseModel):
    id: int
    lecture_id: Optional[int]
    block_type: str
    scheduled_date: datetime
    start_time: Optional[datetime]
    end_time: Optional[datetime]
    duration_minutes: int
    status: str
    compression_level: int
    payload: Dict[str, Any]
    created_at: datetime
    google_event_id: Optional[str] = None

    class Config:
        from_attributes = True


class StudyBlockStatusUpdate(BaseModel):
    status: str  # 'planned' | 'started' | 'done' | 'skipped'


class BlockPlanOut(BaseModel):
    blocks: List[StudyBlockOut]
    total_minutes: int
    compression_applied: bool
    date: str
    work_ends_at: Optional[str] = None   # ISO datetime of last work event end (if any)


class GenerateScheduleRequest(BaseModel):
    date: Optional[str] = None  # YYYY-MM-DD, defaults to today
    morning_activation: bool = False
    push_to_calendar: bool = False
    post_work_minutes: int = 0           # minutes to add after work + commute home


# ─── Documents ────────────────────────────────────────────────────────────────

class DocumentOut(BaseModel):
    id: int
    title: str
    original_filename: str
    html_content: str
    deck_id: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class DocumentListItem(BaseModel):
    id: int
    title: str
    original_filename: str
    deck_id: Optional[int]
    highlight_count: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class HighlightCreate(BaseModel):
    priority: str = "important"  # 'important' | 'difficult' | 'low'
    text_content: str
    html_range_start: Optional[str] = None
    html_range_end: Optional[str] = None


class HighlightOut(BaseModel):
    id: int
    document_id: int
    priority: str
    text_content: str
    html_range_start: Optional[str]
    html_range_end: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class GenerateFromHighlightsRequest(BaseModel):
    highlight_ids: Optional[List[int]] = None  # None = use all highlights
    deck_id: int
    num_cards: int = 30


class ConfirmDocumentCards(BaseModel):
    deck_id: int
    cards: List[GeneratedCard]
    document_id: int


# ─── Tags & Weakness ──────────────────────────────────────────────────────────

class TagOut(BaseModel):
    id: int
    tag: str
    tag_type: str
    usage_count: int

    class Config:
        from_attributes = True


class WeaknessMetricOut(BaseModel):
    tag: str
    lapse_rate: float
    lapse_count_30d: int
    total_reviews_30d: int
    avg_stability: float
    computed_at: datetime

    class Config:
        from_attributes = True


# ─── Settings ─────────────────────────────────────────────────────────────────

class DaySchedule(BaseModel):
    enabled: bool = True
    max_hours: float = 8.0   # max study hours for this day (0 = same as disabled)


class AppPreferences(BaseModel):
    daily_goal: int = 80
    morning_activation: bool = False
    study_window_start: str = "08:00"
    study_window_end: str = "17:00"
    anki_connect_url: str = "http://localhost:8765"
    weekly_hours: float = 30.0
    study_days: Dict[str, Any] = {}  # key = "monday"…"sunday", value = DaySchedule dict


class SettingsOut(BaseModel):
    preferences: AppPreferences
    anki_available: bool
    calendar_authenticated: bool
    calendar_email: Optional[str] = None


# ─── Pre-Lecture ──────────────────────────────────────────────────────────────

class MiniQuizQuestion(BaseModel):
    question: str
    answer: str
    card_type: str = "basic"


class YouTubeSuggestion(BaseModel):
    title: str
    search_query: str


class PreLecturePayload(BaseModel):
    lecture_id: int
    lecture_title: str
    block_duration_minutes: int
    card_review_minutes: int
    targeted_card_ids: List[int]
    mini_quiz: List[MiniQuizQuestion]
    what_to_listen_for: List[str]
    reading_task: Optional[str]
    youtube_suggestions: List[YouTubeSuggestion]


class MiniQuizRequest(BaseModel):
    num_questions: int = 10


# ─── Anki Sync ────────────────────────────────────────────────────────────────

class ImportApkgResult(BaseModel):
    imported: int
    skipped: int
    deck_name: str


class ExportAnkiResult(BaseModel):
    exported: int
    errors: List[str]
