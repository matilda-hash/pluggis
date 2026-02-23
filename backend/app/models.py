from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, JSON, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, default="Local User")
    email = Column(String, unique=True, nullable=True)
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
