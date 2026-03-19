from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, JSON, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, default="Local User")
    email = Column(String, unique=True, nullable=True)
    password_hash = Column(String, nullable=True)  # nullable for migration; existing single user stays
    daily_goal = Column(Integer, default=80)
    created_at = Column(DateTime, default=datetime.utcnow)
    settings = Column(JSON, default={})

    decks = relationship("Deck", back_populates="user")
    card_states = relationship("CardState", back_populates="user")
    reviews = relationship("Review", back_populates="user")
    study_sessions = relationship("StudySession", back_populates="user")
    exams = relationship("Exam", back_populates="user", cascade="all, delete-orphan")
    calendar_events = relationship("CalendarEvent", back_populates="user", cascade="all, delete-orphan")
    lectures = relationship("Lecture", back_populates="user", cascade="all, delete-orphan")
    study_blocks = relationship("StudyBlock", back_populates="user", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="user", cascade="all, delete-orphan")
    oauth_tokens = relationship("OAuthToken", back_populates="user", cascade="all, delete-orphan")
    tag_dictionary = relationship("TagDictionary", back_populates="user", cascade="all, delete-orphan")
    weakness_metrics = relationship("WeaknessMetrics", back_populates="user", cascade="all, delete-orphan")


class Deck(Base):
    __tablename__ = "decks"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    color = Column(String, default="#4F46E5")
    source_type = Column(String, nullable=True)  # 'pdf', 'manual', 'audio'
    source_filename = Column(String, nullable=True)
    is_public = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="decks")
    cards = relationship("Card", back_populates="deck", cascade="all, delete-orphan")
    study_sessions = relationship("StudySession", back_populates="deck")
    documents = relationship("Document", back_populates="deck")


class Card(Base):
    __tablename__ = "cards"

    id = Column(Integer, primary_key=True, index=True)
    deck_id = Column(Integer, ForeignKey("decks.id"), nullable=False)
    card_type = Column(String, nullable=False, default="basic")  # 'basic', 'cloze'
    front = Column(Text, nullable=True)
    back = Column(Text, nullable=True)
    cloze_text = Column(Text, nullable=True)
    image_path = Column(String, nullable=True)
    occlusion_data = Column(JSON, nullable=True)
    is_suspended = Column(Boolean, default=False)
    is_keyword = Column(Boolean, default=False)   # True = nyckelordskort (short definition card)
    tags = Column(JSON, default=[])
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    deck = relationship("Deck", back_populates="cards")
    state = relationship("CardState", back_populates="card", uselist=False, cascade="all, delete-orphan")
    reviews = relationship("Review", back_populates="card", cascade="all, delete-orphan")
    meta = relationship("GeneratedCardMeta", back_populates="card", uselist=False, cascade="all, delete-orphan")


class CardState(Base):
    """Tracks the FSRS scheduling state for each card per user."""
    __tablename__ = "card_states"

    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False, unique=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # FSRS algorithm fields
    stability = Column(Float, default=0.0)
    difficulty = Column(Float, default=0.0)
    due = Column(DateTime, nullable=True)
    last_review = Column(DateTime, nullable=True)
    reps = Column(Integer, default=0)
    lapses = Column(Integer, default=0)
    # 0=New, 1=Learning, 2=Review, 3=Relearning
    state = Column(Integer, default=0)

    card = relationship("Card", back_populates="state")
    user = relationship("User", back_populates="card_states")


class Review(Base):
    """Full history of every review action taken on a card."""
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    rating = Column(Integer, nullable=False)  # 1=Again, 2=Hard, 3=Good, 4=Easy
    state_before = Column(Integer, nullable=False)
    stability_before = Column(Float, default=0.0)
    difficulty_before = Column(Float, default=0.0)
    stability_after = Column(Float, default=0.0)
    difficulty_after = Column(Float, default=0.0)
    scheduled_days = Column(Integer, default=0)
    elapsed_days = Column(Integer, default=0)
    reviewed_at = Column(DateTime, default=datetime.utcnow)

    card = relationship("Card", back_populates="reviews")
    user = relationship("User", back_populates="reviews")


class StudySession(Base):
    """Tracks each study session for statistics."""
    __tablename__ = "study_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    deck_id = Column(Integer, ForeignKey("decks.id"), nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)
    cards_studied = Column(Integer, default=0)
    again_count = Column(Integer, default=0)
    hard_count = Column(Integer, default=0)
    good_count = Column(Integer, default=0)
    easy_count = Column(Integer, default=0)
    skipped_count = Column(Integer, default=0)

    user = relationship("User", back_populates="study_sessions")
    deck = relationship("Deck", back_populates="study_sessions")


class Exam(Base):
    """Upcoming exam/test with a date and name, used for smart daily goal scheduling."""
    __tablename__ = "exams"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)          # e.g. "Neurologi tentamen"
    exam_date = Column(DateTime, nullable=False)
    description = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)            # free-text study notes for AI to parse
    study_config = Column(JSON, nullable=True)     # AI-generated study strategy
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="exams")


# ─── Calendar & Scheduling ────────────────────────────────────────────────────

class CalendarEvent(Base):
    """Synced Google Calendar events (or manually entered)."""
    __tablename__ = "calendar_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    google_event_id = Column(String, nullable=True, unique=True)
    title = Column(String, nullable=False)
    start_dt = Column(DateTime, nullable=False)
    end_dt = Column(DateTime, nullable=False)
    location = Column(Text, nullable=True)
    # 'lecture' | 'training' | 'vfu' | 'other'
    event_type = Column(String, nullable=False, default="other")
    is_in_person = Column(Boolean, default=False)
    calendar_id = Column(String, nullable=True)
    raw_json = Column(JSON, nullable=True)
    synced_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="calendar_events")
    lecture = relationship("Lecture", back_populates="calendar_event", uselist=False)


class Lecture(Base):
    """A scheduled lecture — can come from Google Calendar or be entered manually."""
    __tablename__ = "lectures"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    calendar_event_id = Column(Integer, ForeignKey("calendar_events.id"), nullable=True)
    title = Column(String, nullable=False)
    lecture_date = Column(DateTime, nullable=False)
    subject_tag = Column(String, nullable=True)
    is_in_person = Column(Boolean, default=False)
    is_difficult = Column(Boolean, default=False)
    # 'calendar' | 'manual'
    source = Column(String, nullable=False, default="manual")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="lectures")
    calendar_event = relationship("CalendarEvent", back_populates="lecture")
    study_blocks = relationship("StudyBlock", back_populates="lecture")


class StudyBlock(Base):
    """A planned or completed study session block."""
    __tablename__ = "study_blocks"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    lecture_id = Column(Integer, ForeignKey("lectures.id"), nullable=True)
    # 'pre_lecture' | 'post_lecture' | 'daily_repetition' | 'reading' | 'activation'
    block_type = Column(String, nullable=False)
    scheduled_date = Column(DateTime, nullable=False)
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    duration_minutes = Column(Integer, nullable=False, default=60)
    # 'planned' | 'started' | 'done' | 'skipped'
    status = Column(String, nullable=False, default="planned")
    google_event_id = Column(String, nullable=True)
    # 0=normal, 1=slightly compressed, 2=heavily compressed
    compression_level = Column(Integer, default=0)
    # Stores block-specific content: card_ids, quiz, bullets, youtube, etc.
    payload = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="study_blocks")
    lecture = relationship("Lecture", back_populates="study_blocks")


# ─── Documents & Highlights ───────────────────────────────────────────────────

class Document(Base):
    """A PDF document converted to structured HTML for highlighting."""
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    deck_id = Column(Integer, ForeignKey("decks.id"), nullable=True)
    title = Column(String, nullable=False)
    original_filename = Column(String, nullable=False)
    html_content = Column(Text, nullable=False)
    source_pdf_path = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="documents")
    deck = relationship("Deck", back_populates="documents")
    highlights = relationship("DocumentHighlight", back_populates="document", cascade="all, delete-orphan")
    generated_card_metas = relationship("GeneratedCardMeta", back_populates="document")


class DocumentHighlight(Base):
    """A highlighted text range in a document, tagged with priority."""
    __tablename__ = "document_highlights"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # 'important' | 'difficult' | 'low'
    priority = Column(String, nullable=False, default="important")
    text_content = Column(Text, nullable=False)
    html_range_start = Column(String, nullable=True)  # e.g. "block_42:0"
    html_range_end = Column(String, nullable=True)    # e.g. "block_42:85"
    created_at = Column(DateTime, default=datetime.utcnow)

    document = relationship("Document", back_populates="highlights")


# ─── Card Metadata ────────────────────────────────────────────────────────────

class GeneratedCardMeta(Base):
    """Rich metadata for AI-generated cards (tags, source, generation context)."""
    __tablename__ = "generated_card_meta"

    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False, unique=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    lecture_id = Column(Integer, ForeignKey("lectures.id"), nullable=True)
    highlight_ids = Column(JSON, default=[])
    # 'pdf_upload' | 'highlight' | 'pre_lecture' | 'manual'
    generation_context = Column(String, nullable=True)
    subject_tag = Column(String, nullable=True)
    concept_tag = Column(String, nullable=True)
    type_tag = Column(String, nullable=True)
    # '#foundation' | '#lecture' | None
    context_tag = Column(String, nullable=True)
    # Hidden from user: page refs, source excerpt, generation prompt info
    source_metadata = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow)

    card = relationship("Card", back_populates="meta")
    document = relationship("Document", back_populates="generated_card_metas")


# ─── Tags & Analytics ─────────────────────────────────────────────────────────

class TagDictionary(Base):
    """User's personal tag dictionary with usage counts."""
    __tablename__ = "tag_dictionary"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    tag = Column(String, nullable=False)
    # 'subject' | 'concept' | 'context' | 'type'
    tag_type = Column(String, nullable=False, default="concept")
    usage_count = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("user_id", "tag", name="uq_user_tag"),)

    user = relationship("User", back_populates="tag_dictionary")


class WeaknessMetrics(Base):
    """Precomputed weakness metrics per tag for scheduling prioritization."""
    __tablename__ = "weakness_metrics"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    tag = Column(String, nullable=False)
    lapse_count_30d = Column(Integer, default=0)
    total_reviews_30d = Column(Integer, default=0)
    lapse_rate = Column(Float, default=0.0)
    avg_stability = Column(Float, default=0.0)
    computed_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="weakness_metrics")


# ─── OAuth Tokens ─────────────────────────────────────────────────────────────

class OAuthToken(Base):
    """OAuth 2.0 tokens stored in DB (currently used for Google Calendar)."""
    __tablename__ = "oauth_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    provider = Column(String, nullable=False, default="google")
    access_token = Column(Text, nullable=False)
    refresh_token = Column(Text, nullable=True)
    token_expiry = Column(DateTime, nullable=True)
    scopes = Column(JSON, default=[])
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="oauth_tokens")


# ─── AI Scheduling System ──────────────────────────────────────────────────────

class StudentProfile(Base):
    """Onboarding data: schedule preferences, rhythm, commitments."""
    __tablename__ = "student_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)

    wake_time = Column(String, default="07:00")
    sleep_time = Column(String, default="23:00")
    peak_hours_start = Column(String, default="09:00")
    peak_hours_end = Column(String, default="13:00")
    max_daily_study_hours = Column(Float, default=7.0)
    preferred_session_length_minutes = Column(Integer, default=50)
    preferred_break_length_minutes = Column(Integer, default=10)
    recurring_commitments = Column(JSON, default=[])
    commute_to_campus_minutes = Column(Integer, default=0)
    study_location_preference = Column(String, default="home")
    gym_days = Column(JSON, default=[])
    gym_time = Column(String, default="evening")
    gym_duration_minutes = Column(Integer, default=60)
    session_structure_preference = Column(String, default="focus_50")
    difficulty_preference = Column(String, default="adaptive")
    feedback_style = Column(String, default="direct")
    prior_bio_exposure = Column(Boolean, default=False)
    prior_chem_exposure = Column(Boolean, default=False)
    self_efficacy_score = Column(Float, default=3.0)
    onboarding_completed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", backref="student_profile", uselist=False)


class ExamTopic(Base):
    """A study topic linked to an exam, tracked with topic-level FSRS."""
    __tablename__ = "exam_topics"

    id = Column(Integer, primary_key=True, index=True)
    exam_id = Column(Integer, ForeignKey("exams.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    parent_topic_id = Column(Integer, ForeignKey("exam_topics.id"), nullable=True)

    fsrs_stability = Column(Float, default=1.0)
    fsrs_difficulty = Column(Float, default=5.0)
    fsrs_retrievability = Column(Float, default=0.0)
    fsrs_last_review = Column(DateTime, nullable=True)
    fsrs_next_review = Column(DateTime, nullable=True)

    mastery_level = Column(String, default="not_started")
    mastery_score = Column(Float, default=0.0)
    total_study_minutes = Column(Integer, default=0)
    total_review_sessions = Column(Integer, default=0)
    average_quiz_score = Column(Float, default=0.0)
    last_quiz_score = Column(Float, nullable=True)
    error_streak = Column(Integer, default=0)
    estimated_hours_to_master = Column(Float, default=3.0)
    source_document_ids = Column(JSON, default=[])

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    exam = relationship("Exam", backref="topics")
    user = relationship("User", backref="exam_topics")
    subtopics = relationship("ExamTopic", backref="parent", remote_side=[id])


class AISchedule(Base):
    """AI-generated daily study schedule."""
    __tablename__ = "ai_schedules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    schedule_date = Column(String, nullable=False)
    generated_at = Column(DateTime, default=datetime.utcnow)
    total_study_minutes = Column(Integer, default=0)
    summary = Column(Text, nullable=True)
    tomorrow_preview = Column(Text, nullable=True)
    ai_raw = Column(JSON, nullable=True)
    generation_attempts = Column(Integer, default=1)
    student_approved = Column(Boolean, default=False)
    student_feedback = Column(Text, nullable=True)

    user = relationship("User", backref="ai_schedules")
    blocks = relationship("AIStudyBlock", back_populates="schedule", cascade="all, delete-orphan")


class AIStudyBlock(Base):
    """A single block within an AI-generated schedule."""
    __tablename__ = "ai_study_blocks"

    id = Column(Integer, primary_key=True, index=True)
    schedule_id = Column(Integer, ForeignKey("ai_schedules.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    topic_id = Column(Integer, ForeignKey("exam_topics.id"), nullable=True)

    block_number = Column(Integer, default=1)
    start_time = Column(String, nullable=True)
    end_time = Column(String, nullable=True)
    duration_minutes = Column(Integer, default=50)
    subject = Column(String, nullable=True)
    topic = Column(String, nullable=True)
    subtopic = Column(String, nullable=True)
    block_type = Column(String, nullable=False)
    study_technique = Column(String, nullable=True)
    activity_title = Column(String, nullable=True)
    activity_description = Column(Text, nullable=True)
    resources = Column(JSON, default=[])
    learning_objective = Column(Text, nullable=True)
    is_spaced_repetition = Column(Boolean, default=False)
    location = Column(String, default="home")
    requires_screen = Column(Boolean, default=True)
    difficulty = Column(Integer, default=3)
    break_after_minutes = Column(Integer, default=10)

    completed = Column(Boolean, default=False)
    completion_percentage = Column(Integer, default=0)
    self_reported_difficulty = Column(Integer, nullable=True)
    completion_notes = Column(Text, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    schedule = relationship("AISchedule", back_populates="blocks")
    user = relationship("User", backref="ai_study_blocks")
    exam_topic = relationship("ExamTopic", backref="study_blocks")


class WeeklyCheckin(Base):
    """Weekly study check-in with AI analysis."""
    __tablename__ = "weekly_checkins"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    week_start_date = Column(String, nullable=False)

    actual_study_hours = Column(Float, default=0.0)
    target_study_hours = Column(Float, default=0.0)
    sessions_completed = Column(Integer, default=0)
    sessions_skipped = Column(Integer, default=0)
    retention_by_subject = Column(JSON, default={})
    overall_satisfaction = Column(Integer, nullable=True)
    hardest_subject_this_week = Column(String, nullable=True)
    biggest_challenge = Column(Text, nullable=True)
    free_feedback = Column(Text, nullable=True)
    ai_assessment = Column(Text, nullable=True)
    ai_raw = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", backref="weekly_checkins")


class MockExam(Base):
    """An AI-generated mock exam."""
    __tablename__ = "mock_exams"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    exam_id = Column(Integer, ForeignKey("exams.id"), nullable=True)
    title = Column(String, nullable=False)
    duration_minutes = Column(Integer, default=60)
    instructions = Column(Text, nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    score_percent = Column(Float, nullable=True)
    time_taken_minutes = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", backref="mock_exams")
    questions = relationship("MockQuestion", back_populates="mock_exam", cascade="all, delete-orphan")


class MockQuestion(Base):
    """A question within a mock exam."""
    __tablename__ = "mock_questions"

    id = Column(Integer, primary_key=True, index=True)
    mock_exam_id = Column(Integer, ForeignKey("mock_exams.id"), nullable=False)
    topic_id = Column(Integer, ForeignKey("exam_topics.id"), nullable=True)
    question_number = Column(Integer, default=1)
    question_type = Column(String, default="mcq")
    difficulty = Column(String, default="medium")
    subject = Column(String, nullable=True)
    topic = Column(String, nullable=True)
    question_text = Column(Text, nullable=False)
    options = Column(JSON, nullable=True)
    correct_answer = Column(String, nullable=False)
    explanation = Column(Text, nullable=True)

    student_answer = Column(String, nullable=True)
    is_correct = Column(Boolean, nullable=True)
    time_to_answer_seconds = Column(Integer, nullable=True)
    fsrs_rating = Column(Integer, nullable=True)

    mock_exam = relationship("MockExam", back_populates="questions")
    exam_topic = relationship("ExamTopic", backref="mock_questions")


class ChatMessage(Base):
    """A message in the AI tutor conversation."""
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    role = Column(String, nullable=False)      # "user" | "assistant"
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", backref="chat_messages")
