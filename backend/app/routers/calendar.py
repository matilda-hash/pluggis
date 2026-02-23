"""
Google Calendar integration router.
Handles OAuth 2.0 flow and event sync.
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from ..database import get_db, DEFAULT_USER_ID
from ..models import CalendarEvent, Lecture
from ..schemas import (
    CalendarStatus, CalendarAuthStart, CalendarAuthCallback,
    CalendarEventOut, LectureOut,
)
from ..services.google_calendar import GoogleCalendarService

router = APIRouter(prefix="/calendar", tags=["calendar"])


def _cal_service(db: Session) -> GoogleCalendarService:
    return GoogleCalendarService(db, DEFAULT_USER_ID)


def _sync_events_to_db(svc: GoogleCalendarService, db: Session, days: int = 60) -> int:
    """Pull upcoming calendar events into the DB. Returns number of upserted events."""
    raw_events = svc.get_events(datetime.utcnow(), datetime.utcnow() + timedelta(days=days))
    synced = 0
    for raw in raw_events:
        gid = raw.get("id")
        if not gid:
            continue
        event_type = svc.classify_event(raw)
        in_person = svc.is_in_person(raw)
        start_str = raw.get("start", {}).get("dateTime") or raw.get("start", {}).get("date", "")
        end_str = raw.get("end", {}).get("dateTime") or raw.get("end", {}).get("date", "")
        try:
            start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00")).replace(tzinfo=None)
            end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00")).replace(tzinfo=None)
        except (ValueError, AttributeError):
            continue
        existing = db.query(CalendarEvent).filter(CalendarEvent.google_event_id == gid).first()
        if existing:
            existing.title = raw.get("summary", "(no title)")
            existing.start_dt = start_dt
            existing.end_dt = end_dt
            existing.event_type = event_type
            existing.is_in_person = in_person
            existing.location = raw.get("location")
            existing.raw_json = raw
            existing.synced_at = datetime.utcnow()
        else:
            event = CalendarEvent(
                user_id=DEFAULT_USER_ID,
                google_event_id=gid,
                title=raw.get("summary", "(no title)"),
                start_dt=start_dt,
                end_dt=end_dt,
                location=raw.get("location"),
                event_type=event_type,
                is_in_person=in_person,
                raw_json=raw,
            )
            db.add(event)
            if event_type == "lecture":
                db.flush()
                if not db.query(Lecture).filter(Lecture.calendar_event_id == event.id).first():
                    db.add(Lecture(
                        user_id=DEFAULT_USER_ID,
                        calendar_event_id=event.id,
                        title=raw.get("summary", "Lecture"),
                        lecture_date=start_dt,
                        is_in_person=in_person,
                        source="calendar",
                    ))
        synced += 1
    db.commit()
    return synced


@router.get("/status", response_model=CalendarStatus)
def calendar_status(db: Session = Depends(get_db)):
    svc = _cal_service(db)
    return CalendarStatus(
        authenticated=svc.is_authenticated(),
        email=svc.get_email(),
    )


@router.post("/auth/start")
def start_auth(req: CalendarAuthStart, db: Session = Depends(get_db)):
    """Generate Google OAuth consent URL."""
    svc = _cal_service(db)
    try:
        auth_url = svc.get_auth_url(req.client_id, req.client_secret, req.redirect_uri)
        return {"auth_url": auth_url}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/auth/callback")
def auth_callback_redirect(
    code: str = None,
    error: str = None,
    db: Session = Depends(get_db),
):
    """
    Handle Google's OAuth redirect (GET).
    Google redirects here after user consent with ?code=...
    We exchange the code then redirect back to the frontend settings page.
    """
    FRONTEND = "http://localhost:5173"

    if error:
        return RedirectResponse(f"{FRONTEND}/settings?calendar_error={error}")
    if not code:
        return RedirectResponse(f"{FRONTEND}/settings?calendar_error=no_code")

    svc = _cal_service(db)
    client_id, client_secret, redirect_uri = svc.get_saved_client_creds()

    if not client_id or not client_secret:
        return RedirectResponse(f"{FRONTEND}/settings?calendar_error=missing_credentials")

    fallback_uri = "http://localhost:8000/api/calendar/auth/callback"
    success = svc.exchange_code(code, client_id, client_secret, redirect_uri or fallback_uri)

    if success:
        # Auto-sync the next 60 days of events immediately after connecting
        try:
            _sync_events_to_db(svc, db, days=60)
        except Exception:
            pass  # Don't fail the redirect if sync errors
        return RedirectResponse(f"{FRONTEND}/settings?calendar=connected")
    return RedirectResponse(f"{FRONTEND}/settings?calendar_error=exchange_failed")


@router.post("/auth/callback")
def auth_callback(req: CalendarAuthCallback, db: Session = Depends(get_db)):
    """Exchange OAuth code for tokens and store them (manual flow fallback)."""
    svc = _cal_service(db)
    success = svc.exchange_code(req.code, req.client_id, req.client_secret, req.redirect_uri)
    if not success:
        raise HTTPException(status_code=400, detail="OAuth code exchange failed")
    return {"ok": True, "message": "Google Calendar connected successfully"}


@router.delete("/auth")
def disconnect(db: Session = Depends(get_db)):
    """Revoke and delete stored OAuth token."""
    svc = _cal_service(db)
    svc.revoke()
    return {"ok": True}


@router.post("/sync")
def sync_events(db: Session = Depends(get_db)):
    """Sync next 60 days of Google Calendar events to the CalendarEvent table."""
    svc = _cal_service(db)
    if not svc.is_authenticated():
        raise HTTPException(status_code=401, detail="Google Calendar not connected")
    synced = _sync_events_to_db(svc, db, days=60)
    return {"ok": True, "synced": synced}


@router.get("/events", response_model=list[CalendarEventOut])
def list_events(
    date_from: str = None,
    date_to: str = None,
    db: Session = Depends(get_db),
):
    """List synced calendar events from DB."""
    query = db.query(CalendarEvent).filter(CalendarEvent.user_id == DEFAULT_USER_ID)
    if date_from:
        try:
            query = query.filter(CalendarEvent.start_dt >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            query = query.filter(CalendarEvent.end_dt <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    events = query.order_by(CalendarEvent.start_dt).all()
    return events


@router.post("/create-block/{block_id}")
def create_calendar_block(block_id: int, db: Session = Depends(get_db)):
    """Push a StudyBlock to Google Calendar as an event."""
    from ..models import StudyBlock

    block = db.query(StudyBlock).filter(
        StudyBlock.id == block_id,
        StudyBlock.user_id == DEFAULT_USER_ID,
    ).first()
    if not block:
        raise HTTPException(status_code=404, detail="Study block not found")

    svc = _cal_service(db)
    if not svc.is_authenticated():
        raise HTTPException(status_code=401, detail="Google Calendar not connected")

    if not block.start_time or not block.end_time:
        raise HTTPException(status_code=400, detail="Block has no scheduled time")

    type_labels = {
        "pre_lecture": "📚 Förberedelse",
        "post_lecture": "✏️ Genomgång",
        "daily_repetition": "🔄 Repetition",
        "reading": "📖 Läsning",
        "activation": "⚡ Aktivering",
    }
    title = type_labels.get(block.block_type, "📚 Studieblock")

    gid = svc.create_event(
        title=title,
        start=block.start_time,
        end=block.end_time,
        description=f"AI-schemalagd studieblock ({block.duration_minutes} min)",
    )
    if gid:
        block.google_event_id = gid
        db.commit()
    return {"ok": bool(gid), "google_event_id": gid}


@router.post("/push-blocks")
def push_blocks_to_calendar(
    date_from: str,
    date_to: str,
    db: Session = Depends(get_db),
):
    """Push all saved study blocks in the date range to Google Calendar."""
    from ..models import StudyBlock

    svc = _cal_service(db)
    if not svc.is_authenticated():
        raise HTTPException(status_code=401, detail="Google Calendar not connected")

    try:
        dt_from = datetime.fromisoformat(date_from)
        dt_to = datetime.fromisoformat(date_to)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid date format, use YYYY-MM-DD")

    blocks = (
        db.query(StudyBlock)
        .filter(
            StudyBlock.user_id == DEFAULT_USER_ID,
            StudyBlock.scheduled_date >= dt_from,
            StudyBlock.scheduled_date <= dt_to,
            StudyBlock.start_time != None,
            StudyBlock.end_time != None,
        )
        .all()
    )

    type_labels = {
        "pre_lecture": "📚 Förberedelse",
        "post_lecture": "✏️ Genomgång",
        "daily_repetition": "🔄 Repetition",
        "reading": "📖 Läsning",
        "activation": "⚡ Aktivering",
    }

    pushed = 0
    for block in blocks:
        if block.google_event_id:
            continue  # Already synced
        gid = svc.create_event(
            title=type_labels.get(block.block_type, "📚 Studie"),
            start=block.start_time,
            end=block.end_time,
            description=f"AI-schemalagd studieblock ({block.duration_minutes} min)",
        )
        if gid:
            block.google_event_id = gid
            pushed += 1

    db.commit()
    return {"ok": True, "pushed": pushed}


@router.delete("/event/{google_event_id}")
def delete_calendar_event(google_event_id: str, db: Session = Depends(get_db)):
    """Delete a Google Calendar event."""
    svc = _cal_service(db)
    if not svc.is_authenticated():
        raise HTTPException(status_code=401, detail="Google Calendar not connected")
    success = svc.delete_event(google_event_id)
    return {"ok": success}
