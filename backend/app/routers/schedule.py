"""
Schedule router — daily block generation and lecture management.
"""

from datetime import date, datetime, time, timedelta
from typing import Optional, TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import CalendarEvent, CardState, Exam, Lecture, StudyBlock, User
from ..schemas import (
    BlockPlanOut, GenerateScheduleRequest, LectureCreate, LectureOut,
    LectureUpdate, StudyBlockOut, StudyBlockStatusUpdate,
)
from ..services.anki_connect import AnkiConnectClient
from ..services.scheduler import DailyScheduler, NON_STUDY_TYPES, ScheduleInput

router = APIRouter(prefix="/schedule", tags=["schedule"])


# ── Schedule generation ────────────────────────────────────────────────────────

@router.get("/today", response_model=BlockPlanOut)
def get_today_schedule(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _get_schedule_for_date(date.today(), False, db, current_user.id)


@router.get("/day/{date_str}", response_model=BlockPlanOut)
def get_day_schedule(
    date_str: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        target = date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=422, detail="Date must be YYYY-MM-DD")
    return _get_schedule_for_date(target, False, db, current_user.id)


@router.post("/generate", response_model=BlockPlanOut)
def generate_schedule(
    req: GenerateScheduleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate and SAVE study blocks for a given date (delete-then-create)."""
    if req.date:
        try:
            target = date.fromisoformat(req.date)
        except ValueError:
            raise HTTPException(status_code=422, detail="Date must be YYYY-MM-DD")
    else:
        target = date.today()

    plan = _get_schedule_for_date(target, req.morning_activation, db, current_user.id, post_work_minutes=req.post_work_minutes)
    _save_plan_for_date(target, plan, req.push_to_calendar, db, current_user.id)
    return plan


@router.post("/generate-week", response_model=list[BlockPlanOut])
def generate_week(
    week_start: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate and save study blocks for Mon–Sun of the given week (or current week)."""
    if week_start:
        try:
            start = date.fromisoformat(week_start)
        except ValueError:
            raise HTTPException(status_code=422, detail="week_start must be YYYY-MM-DD")
    else:
        today = date.today()
        start = today - timedelta(days=today.weekday())  # Monday of current week
    results = []
    for i in range(7):
        target = start + timedelta(days=i)
        plan = _get_schedule_for_date(target, False, db, current_user.id)
        _save_plan_for_date(target, plan, False, db, current_user.id)
        results.append(plan)
    return results


def _save_plan_for_date(
    target: date,
    plan: "BlockPlanOut",
    push_to_calendar: bool,
    db: Session,
    user_id: int,
) -> None:
    """Delete existing planned blocks for the day and create new ones from plan."""
    from ..services.google_calendar import GoogleCalendarService

    target_dt = datetime.combine(target, datetime.min.time())
    target_dt_end = target_dt + timedelta(days=1)

    # Delete existing planned blocks for the day (and their calendar events)
    existing_blocks = (
        db.query(StudyBlock)
        .filter(
            StudyBlock.user_id == user_id,
            StudyBlock.scheduled_date >= target_dt,
            StudyBlock.scheduled_date < target_dt_end,
            StudyBlock.status == "planned",
        )
        .all()
    )

    cal_svc: Optional[GoogleCalendarService] = None
    if push_to_calendar:
        cal_svc = GoogleCalendarService(db, user_id)
        if not cal_svc.is_authenticated():
            cal_svc = None

    for b in existing_blocks:
        if b.google_event_id and cal_svc:
            cal_svc.delete_event(b.google_event_id)
        db.delete(b)

    db.flush()

    # Create new blocks
    new_blocks = []
    for block_out in plan.blocks:
        b = StudyBlock(
            user_id=user_id,
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
        db.add(b)
        new_blocks.append(b)

    db.flush()  # Assign IDs before calendar sync

    # Calendar sync for new study blocks (skip lunch/break/gym)
    if cal_svc:
        _labels = {
            "pre_lecture": "📚 Förberedelse",
            "post_lecture": "✏️ Genomgång",
            "daily_repetition": "🔄 Repetition",
            "reading": "📖 Läsning",
            "activation": "⚡ Aktivering",
            "practice_test": "📝 Övningsprov",
            "timed_drill": "⏱️ Tidsbegränsad drill",
            "mistake_review": "🔍 Felgenomgång",
            "active_recall": "🧠 Aktiv återkallning",
            "case_study": "🏥 Fallstudie",
            "resource": "🎬 Studiematerial",
        }
        for b in new_blocks:
            if not b.start_time or not b.end_time:
                continue
            if b.block_type in NON_STUDY_TYPES:
                continue
            base_label = _labels.get(b.block_type, "📚 Studie")
            payload_label = (b.payload or {}).get("label", "")
            title = f"{base_label}: {payload_label}" if payload_label else base_label
            desc = (b.payload or {}).get("description") or f"AI-schemalagd studieblock ({b.duration_minutes} min)"
            gid = cal_svc.create_event(title=title, start=b.start_time, end=b.end_time, description=desc)
            if gid:
                b.google_event_id = gid

    db.commit()


def _get_schedule_for_date(
    target: date,
    morning_activation: bool,
    db: Session,
    user_id: int,
    post_work_minutes: int = 0,
) -> BlockPlanOut:
    """Build a BlockPlanOut for target date without saving to DB."""
    tomorrow = target + timedelta(days=1)

    target_dt = datetime.combine(target, datetime.min.time())
    target_dt_end = target_dt + timedelta(days=1)
    cal_events = (
        db.query(CalendarEvent)
        .filter(
            CalendarEvent.user_id == user_id,
            CalendarEvent.start_dt >= target_dt,
            CalendarEvent.start_dt < target_dt_end,
        )
        .all()
    )

    lectures_today = _get_lectures_for_date(target, db, user_id)
    lectures_tomorrow = _get_lectures_for_date(tomorrow, db, user_id)

    # Anki stats
    client = AnkiConnectClient()
    anki_due = anki_new = 0
    if client.is_available():
        due_r = client.get_due_cards()
        new_r = client.get_new_cards()
        anki_due = len(due_r.data or [])
        anki_new = len(new_r.data or [])

    now = datetime.utcnow()
    internal_due = (
        db.query(CardState)
        .filter(CardState.user_id == user_id, CardState.state > 0, CardState.due <= now)
        .count()
    )
    internal_new = (
        db.query(CardState)
        .filter(CardState.user_id == user_id, CardState.state == 0)
        .count()
    )

    user = db.query(User).filter(User.id == user_id).first()
    user_settings = (user.settings or {}) if user else {}

    def _parse_time(s: str, fallback: time) -> time:
        try:
            h, m = s.split(":")
            return time(int(h), int(m))
        except Exception:
            return fallback

    work_start = _parse_time(user_settings.get("study_window_start", "08:00"), time(8, 0))
    work_end   = _parse_time(user_settings.get("study_window_end",   "17:00"), time(17, 0))

    if not morning_activation:
        morning_activation = user_settings.get("morning_activation", False)

    work_events_today = sorted(
        [e for e in cal_events if e.event_type == "work"],
        key=lambda e: e.end_dt,
    )
    work_ends_at = work_events_today[-1].end_dt.isoformat() if work_events_today else None

    # Get nearest upcoming exam's study config (or fall back to name-based detection)
    now_dt = datetime.combine(target, datetime.min.time())
    nearest_exam = (
        db.query(Exam)
        .filter(Exam.user_id == user_id, Exam.exam_date >= now_dt)
        .order_by(Exam.exam_date.asc())
        .first()
    )
    if nearest_exam and nearest_exam.study_config:
        exam_study_config = nearest_exam.study_config
    elif nearest_exam:
        exam_study_config = _auto_study_config(nearest_exam.name or "")
    else:
        exam_study_config = None

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
        exam_study_config=exam_study_config,
    )

    scheduler = DailyScheduler(work_start=work_start, work_end=work_end)
    blocks = scheduler.generate(inp)

    total_minutes = sum(b.duration_minutes for b in blocks if b.block_type not in NON_STUDY_TYPES)
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

    _WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    weekday_name = _WEEKDAYS[target.weekday()]
    study_days_cfg = user_settings.get("study_days", {})
    day_cfg = study_days_cfg.get(weekday_name)
    # day_cfg can be None (day never configured), {} (empty), or {"enabled": bool, "max_hours": N}
    if isinstance(day_cfg, dict):
        if not day_cfg.get("enabled", True):
            return BlockPlanOut(
                blocks=[], total_minutes=0, compression_applied=False,
                date=target.isoformat(), work_ends_at=work_ends_at,
            )
        max_h = day_cfg.get("max_hours")
        if max_h is not None:
            max_min = int(float(max_h) * 60)
            capped, used = [], 0
            for b in blocks_out:
                if b.block_type in NON_STUDY_TYPES:
                    capped.append(b)  # always include non-study blocks
                elif used + b.duration_minutes <= max_min:
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


def _get_lectures_for_date(target: date, db: Session, user_id: int) -> list:
    target_dt = datetime.combine(target, datetime.min.time())
    target_dt_end = target_dt + timedelta(days=1)
    return (
        db.query(Lecture)
        .filter(
            Lecture.user_id == user_id,
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
    current_user: User = Depends(get_current_user),
):
    query = db.query(StudyBlock).filter(StudyBlock.user_id == current_user.id)
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
    current_user: User = Depends(get_current_user),
):
    valid = {"planned", "started", "done", "skipped"}
    if req.status not in valid:
        raise HTTPException(status_code=422, detail=f"status must be one of {valid}")
    block = _get_block(block_id, current_user.id, db)
    block.status = req.status
    db.commit()
    db.refresh(block)
    return block


@router.delete("/blocks/{block_id}")
def delete_block(
    block_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    block = _get_block(block_id, current_user.id, db)
    db.delete(block)
    db.commit()
    return {"ok": True}


def _get_block(block_id: int, user_id: int, db: Session) -> StudyBlock:
    block = db.query(StudyBlock).filter(
        StudyBlock.id == block_id,
        StudyBlock.user_id == user_id,
    ).first()
    if not block:
        raise HTTPException(status_code=404, detail="Study block not found")
    return block


# ── Lecture management ────────────────────────────────────────────────────────

@router.get("/lectures", response_model=list[LectureOut])
def list_lectures(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Lecture)
        .filter(Lecture.user_id == current_user.id)
        .order_by(Lecture.lecture_date)
        .all()
    )


@router.post("/lectures", response_model=LectureOut)
def create_lecture(
    req: LectureCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lecture = Lecture(
        user_id=current_user.id,
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
def update_lecture(
    lecture_id: int,
    req: LectureUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lecture = _get_lecture(lecture_id, current_user.id, db)
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(lecture, field, value)
    db.commit()
    db.refresh(lecture)
    return lecture


@router.delete("/lectures/{lecture_id}")
def delete_lecture(
    lecture_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lecture = _get_lecture(lecture_id, current_user.id, db)
    db.delete(lecture)
    db.commit()
    return {"ok": True}


def _get_lecture(lecture_id: int, user_id: int, db: Session) -> Lecture:
    lecture = db.query(Lecture).filter(
        Lecture.id == lecture_id,
        Lecture.user_id == user_id,
    ).first()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    return lecture


# ── Auto study config fallback ─────────────────────────────────────────────────

def _auto_study_config(exam_name: str) -> Optional[dict]:
    """
    When an exam has no AI-generated study_config, infer a sensible default
    from the exam name so the scheduler still generates smart blocks.
    Returns None for unrecognised names (scheduler falls back to plain reading).
    """
    name = exam_name.lower()

    if any(kw in name for kw in ["högskoleprovet", "hsp", "högskoleprov", "hogskoleprov"]):
        return {
            "exam_type": "hogskoleprovet",
            "study_type": "practice_tests",
            "no_flashcards": True,
            "practice_test_minutes": 180,
            "daily_practice_tests": 0,
            "daily_hours_min": 2,
            "daily_hours_max": 4,
            "activities": [
                {
                    "block_type": "practice_test",
                    "duration_minutes": 180,
                    "label": "Fullständigt övningsprov",
                    "description": "Gör ett komplett övningsprov (3 timmar) under tidsbegränsning – mobiltelefon av, inga avbrott, simulera verkliga tentaförhållanden. Anteckna vilka frågetyper du fastnar på.",
                },
                {
                    "block_type": "mistake_review",
                    "duration_minutes": 45,
                    "label": "Felgenomgång",
                    "description": "Gå igenom varje fel från gårdagens övningsprov. Förstå exakt varför varje svar var fel – skriv ner det gemensamma mönstret för dina misstag.",
                },
                {
                    "block_type": "timed_drill",
                    "duration_minutes": 25,
                    "label": "Tidsbegränsad drill – NOG",
                    "description": "Lös 15 NOG-frågor på 20 minuter utan att stanna upp. Rätta efteråt och notera vilka resonemang som gick snett.",
                },
                {
                    "block_type": "timed_drill",
                    "duration_minutes": 30,
                    "label": "Tidsbegränsad drill – LÄS",
                    "description": "Gör 10 LÄS-frågor på 25 minuter. Markera svarstexten direkt i läspassagen – öva på att hitta svaret utan att tolka.",
                },
                {
                    "block_type": "active_recall",
                    "duration_minutes": 20,
                    "label": "Mönsteranalys",
                    "description": "Ta fram dina anteckningar om vanliga fallgropar. Skriv ner 3 konkreta strategier du ska använda i nästa prov och läs dem högt.",
                },
                {
                    "block_type": "resource",
                    "duration_minutes": 20,
                    "label": "YouTube – kvantitativ del",
                    "description": "Sök 'högskoleprovet NOG förklaring' på YouTube – välj ett video på 15–20 min. Titta passivt under lunchen, inga anteckningar behövs.",
                },
            ],
        }

    if any(kw in name for kw in [
        "anatomi", "histologi", "biokemi", "fysiologi", "tenta", "termin",
        "medicinsk", "läkare", "läkarprogrammet", "neurologi", "kardiologi",
        "immunologi", "mikrobiologi", "farmakologi", "patologi",
    ]):
        return {
            "exam_type": "medical_school",
            "study_type": "mixed",
            "no_flashcards": False,
            "practice_test_minutes": 60,
            "daily_practice_tests": 0,
            "daily_hours_min": 4,
            "daily_hours_max": 8,
            "activities": [
                {
                    "block_type": "active_recall",
                    "duration_minutes": 60,
                    "label": "Aktiv återkallning",
                    "description": "Ta ett tomt papper. Skriv allt du kan om dagens ämne utan att titta i anteckningarna. Jämför sedan och markera luckorna – gå igenom dem direkt.",
                },
                {
                    "block_type": "daily_repetition",
                    "duration_minutes": 45,
                    "label": "FSRS-repetition",
                    "description": "Öppna appen och gå igenom dagens förfallna flashcards. Prioritera 'Igen'-kort – förklara varje svar högt för dig själv innan du vänder kortet.",
                },
                {
                    "block_type": "case_study",
                    "duration_minutes": 40,
                    "label": "Fallstudie",
                    "description": "En patient söker med symtom relaterade till dagens ämne. Vad är den underliggande mekanismen? Skriv ditt svar, kontrollera sedan mot dina anteckningar.",
                },
                {
                    "block_type": "timed_drill",
                    "duration_minutes": 30,
                    "label": "MCQ-drill",
                    "description": "Sätt en timer på 20 minuter och lös 15 MCQ-frågor om ämnet utan hjälpmedel. Rätta efteråt och gå igenom varje fel individuellt.",
                },
                {
                    "block_type": "mistake_review",
                    "duration_minutes": 30,
                    "label": "Felkortsgranskning",
                    "description": "Filtrera på kort med 'Igen'-betyg från senaste veckan i appen. Gå igenom varje kort och förklara rätt svar högt – om du inte kan förklara det, lägg det i en separat hög.",
                },
                {
                    "block_type": "resource",
                    "duration_minutes": 25,
                    "label": "Ninja Nerd – aktivt tittande",
                    "description": "Sök 'Ninja Nerd [ämne]' på YouTube – välj första resultatet (ca 20–30 min). Pausa efter varje avsnitt och repetera nyckelbegreppen innan du fortsätter.",
                },
            ],
        }

    return None
