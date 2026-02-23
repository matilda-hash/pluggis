"""
Schedule router — daily block generation and lecture management.
"""

from datetime import date, datetime, time, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db, DEFAULT_USER_ID
from ..models import CalendarEvent, CardState, Lecture, StudyBlock, User
from ..schemas import (
    BlockPlanOut, GenerateScheduleRequest, LectureCreate, LectureOut,
    LectureUpdate, StudyBlockOut, StudyBlockStatusUpdate,
)
from ..services.anki_connect import AnkiConnectClient
from ..services.scheduler import DailyScheduler, ScheduleInput

router = APIRouter(prefix="/schedule", tags=["schedule"])


# ── Schedule generation ────────────────────────────────────────────────────────

@router.get("/today", response_model=BlockPlanOut)
def get_today_schedule(db: Session = Depends(get_db)):
    return _get_schedule_for_date(date.today(), False, db)


@router.get("/day/{date_str}", response_model=BlockPlanOut)
def get_day_schedule(date_str: str, db: Session = Depends(get_db)):
    try:
        target = date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=422, detail="Date must be YYYY-MM-DD")
    return _get_schedule_for_date(target, False, db)


@router.post("/generate", response_model=BlockPlanOut)
def generate_schedule(req: GenerateScheduleRequest, db: Session = Depends(get_db)):
    """
    Generate and SAVE study blocks for a given date.
    Replaces any existing planned blocks for that date.
    """
    if req.date:
        try:
            target = date.fromisoformat(req.date)
        except ValueError:
            raise HTTPException(status_code=422, detail="Date must be YYYY-MM-DD")
    else:
        target = date.today()

    # Remove existing planned blocks for this date
    target_dt = datetime.combine(target, datetime.min.time())
    target_dt_end = target_dt + timedelta(days=1)
    db.query(StudyBlock).filter(
        StudyBlock.user_id == DEFAULT_USER_ID,
        StudyBlock.scheduled_date >= target_dt,
        StudyBlock.scheduled_date < target_dt_end,
        StudyBlock.status == "planned",
    ).delete()

    plan = _get_schedule_for_date(target, req.morning_activation, db, post_work_minutes=req.post_work_minutes)

    # Save blocks
    for block_out in plan.blocks:
        block = StudyBlock(
            user_id=DEFAULT_USER_ID,
            lecture_id=block_out.lecture_id,
            block_type=block_out.block_type,
            scheduled_date=block_out.scheduled_date,
            start_time=block_out.start_time,
            end_time=block_out.end_time,
            duration_minutes=block_out.duration_minutes,
            status="planned",
            compression_level=block_out.compression_level,
            payload=block_out.payload,
        )
        db.add(block)

    db.commit()

    # Push to Google Calendar if requested
    if req.push_to_calendar:
        from ..services.google_calendar import GoogleCalendarService
        svc = GoogleCalendarService(db, DEFAULT_USER_ID)
        if svc.is_authenticated():
            saved_blocks = db.query(StudyBlock).filter(
                StudyBlock.user_id == DEFAULT_USER_ID,
                StudyBlock.scheduled_date >= target_dt,
                StudyBlock.scheduled_date < target_dt_end,
            ).all()
            _labels = {
                "pre_lecture": "📚 Förberedelse",
                "post_lecture": "✏️ Genomgång",
                "daily_repetition": "🔄 Repetition",
                "reading": "📖 Läsning",
                "activation": "⚡ Aktivering",
            }
            for b in saved_blocks:
                if b.start_time and b.end_time:
                    gid = svc.create_event(
                        title=_labels.get(b.block_type, "📚 Studie"),
                        start=b.start_time,
                        end=b.end_time,
                    )
                    if gid:
                        b.google_event_id = gid
            db.commit()

    return plan


def _get_schedule_for_date(target: date, morning_activation: bool, db: Session, post_work_minutes: int = 0) -> BlockPlanOut:
    """Build a BlockPlanOut for target date without saving to DB."""
    tomorrow = target + timedelta(days=1)

    # Calendar events for target date
    target_dt = datetime.combine(target, datetime.min.time())
    target_dt_end = target_dt + timedelta(days=1)
    cal_events = (
        db.query(CalendarEvent)
        .filter(
            CalendarEvent.user_id == DEFAULT_USER_ID,
            CalendarEvent.start_dt >= target_dt,
            CalendarEvent.start_dt < target_dt_end,
        )
        .all()
    )

    # Lectures
    lectures_today = _get_lectures_for_date(target, db)
    lectures_tomorrow = _get_lectures_for_date(tomorrow, db)

    # Anki stats
    client = AnkiConnectClient()
    anki_due = anki_new = 0
    if client.is_available():
        due_r = client.get_due_cards()
        new_r = client.get_new_cards()
        anki_due = len(due_r.data or [])
        anki_new = len(new_r.data or [])

    # Internal FSRS counts
    now = datetime.utcnow()
    internal_due = (
        db.query(CardState)
        .filter(CardState.user_id == DEFAULT_USER_ID, CardState.state > 0, CardState.due <= now)
        .count()
    )
    internal_new = (
        db.query(CardState)
        .filter(CardState.user_id == DEFAULT_USER_ID, CardState.state == 0)
        .count()
    )

    # Load user preferences for study window
    user = db.query(User).filter(User.id == DEFAULT_USER_ID).first()
    user_settings = (user.settings or {}) if user else {}

    def _parse_time(s: str, fallback: time) -> time:
        try:
            h, m = s.split(":")
            return time(int(h), int(m))
        except Exception:
            return fallback

    work_start = _parse_time(user_settings.get("study_window_start", "08:00"), time(8, 0))
    work_end   = _parse_time(user_settings.get("study_window_end",   "17:00"), time(17, 0))

    # Use morning_activation from preferences if not set explicitly
    if not morning_activation:
        morning_activation = user_settings.get("morning_activation", False)

    # Compute work_ends_at for the frontend post-work study prompt
    work_events_today = sorted(
        [e for e in cal_events if e.event_type == "work"],
        key=lambda e: e.end_dt,
    )
    work_ends_at = work_events_today[-1].end_dt.isoformat() if work_events_today else None

    inp = ScheduleInput(
        target_date=target,
        calendar_events=cal_events,
        lectures_today=lectures_today,
        lectures_tomorrow=lectures_tomorrow,
        anki_due=anki_due,
        anki_new=anki_new,
        internal_due=internal_due,
        internal_new=internal_new,
        morning_activation=morning_activation,
        post_work_minutes=post_work_minutes,
    )

    scheduler = DailyScheduler(work_start=work_start, work_end=work_end)
    blocks = scheduler.generate(inp)

    total_minutes = sum(b.duration_minutes for b in blocks)
    compression_applied = any(b.compression_level > 0 for b in blocks)

    blocks_out = [
        StudyBlockOut(
            id=0,
            lecture_id=b.lecture_id,
            block_type=b.block_type,
            scheduled_date=b.scheduled_date,
            start_time=b.start_time,
            end_time=b.end_time,
            duration_minutes=b.duration_minutes,
            status=b.status,
            compression_level=b.compression_level,
            payload=b.payload or {},
            created_at=datetime.utcnow(),
        )
        for b in blocks
    ]

    # Apply per-day schedule limits from user preferences
    _WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    weekday_name = _WEEKDAYS[target.weekday()]
    study_days_cfg = user_settings.get("study_days", {})
    day_cfg = study_days_cfg.get(weekday_name, {})
    if isinstance(day_cfg, dict) and day_cfg:
        if not day_cfg.get("enabled", True):
            # Day is disabled — return empty schedule
            return BlockPlanOut(
                blocks=[], total_minutes=0, compression_applied=False,
                date=target.isoformat(), work_ends_at=work_ends_at,
            )
        max_h = day_cfg.get("max_hours")
        if max_h is not None:
            max_min = int(float(max_h) * 60)
            capped, used = [], 0
            for b in blocks_out:
                if used + b.duration_minutes <= max_min:
                    capped.append(b)
                    used += b.duration_minutes
            blocks_out = capped
            total_minutes = used
            compression_applied = any(b.compression_level > 0 for b in blocks_out)

    return BlockPlanOut(
        blocks=blocks_out,
        total_minutes=total_minutes,
        compression_applied=compression_applied,
        date=target.isoformat(),
        work_ends_at=work_ends_at,
    )


def _get_lectures_for_date(target: date, db: Session) -> list:
    target_dt = datetime.combine(target, datetime.min.time())
    target_dt_end = target_dt + timedelta(days=1)
    return (
        db.query(Lecture)
        .filter(
            Lecture.user_id == DEFAULT_USER_ID,
            Lecture.lecture_date >= target_dt,
            Lecture.lecture_date < target_dt_end,
        )
        .all()
    )


# ── Saved blocks management ────────────────────────────────────────────────────

@router.get("/blocks", response_model=list[StudyBlockOut])
def list_blocks(
    date_from: str = None,
    date_to: str = None,
    db: Session = Depends(get_db),
):
    query = db.query(StudyBlock).filter(StudyBlock.user_id == DEFAULT_USER_ID)
    if date_from:
        try:
            query = query.filter(StudyBlock.scheduled_date >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            query = query.filter(StudyBlock.scheduled_date <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    return query.order_by(StudyBlock.scheduled_date, StudyBlock.start_time).all()


@router.put("/blocks/{block_id}", response_model=StudyBlockOut)
def update_block_status(
    block_id: int,
    req: StudyBlockStatusUpdate,
    db: Session = Depends(get_db),
):
    valid = {"planned", "started", "done", "skipped"}
    if req.status not in valid:
        raise HTTPException(status_code=422, detail=f"status must be one of {valid}")
    block = _get_block(block_id, db)
    block.status = req.status
    db.commit()
    db.refresh(block)
    return block


@router.delete("/blocks/{block_id}")
def delete_block(block_id: int, db: Session = Depends(get_db)):
    block = _get_block(block_id, db)
    db.delete(block)
    db.commit()
    return {"ok": True}


def _get_block(block_id: int, db: Session) -> StudyBlock:
    block = db.query(StudyBlock).filter(
        StudyBlock.id == block_id,
        StudyBlock.user_id == DEFAULT_USER_ID,
    ).first()
    if not block:
        raise HTTPException(status_code=404, detail="Study block not found")
    return block


# ── Lecture management ────────────────────────────────────────────────────────

@router.get("/lectures", response_model=list[LectureOut])
def list_lectures(db: Session = Depends(get_db)):
    return (
        db.query(Lecture)
        .filter(Lecture.user_id == DEFAULT_USER_ID)
        .order_by(Lecture.lecture_date)
        .all()
    )


@router.post("/lectures", response_model=LectureOut)
def create_lecture(req: LectureCreate, db: Session = Depends(get_db)):
    lecture = Lecture(
        user_id=DEFAULT_USER_ID,
        title=req.title,
        lecture_date=req.lecture_date,
        subject_tag=req.subject_tag,
        is_in_person=req.is_in_person,
        is_difficult=req.is_difficult,
        source=req.source,
        notes=req.notes,
        calendar_event_id=req.calendar_event_id,
    )
    db.add(lecture)
    db.commit()
    db.refresh(lecture)
    return lecture


@router.put("/lectures/{lecture_id}", response_model=LectureOut)
def update_lecture(lecture_id: int, req: LectureUpdate, db: Session = Depends(get_db)):
    lecture = _get_lecture(lecture_id, db)
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(lecture, field, value)
    db.commit()
    db.refresh(lecture)
    return lecture


@router.delete("/lectures/{lecture_id}")
def delete_lecture(lecture_id: int, db: Session = Depends(get_db)):
    lecture = _get_lecture(lecture_id, db)
    db.delete(lecture)
    db.commit()
    return {"ok": True}


def _get_lecture(lecture_id: int, db: Session) -> Lecture:
    lecture = db.query(Lecture).filter(
        Lecture.id == lecture_id,
        Lecture.user_id == DEFAULT_USER_ID,
    ).first()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    return lecture
