"""
Google Calendar integration router.
Handles OAuth 2.0 flow and event sync.
"""

import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

_STOCKHOLM = ZoneInfo("Europe/Stockholm")

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import CalendarEvent, Lecture, OAuthToken, User
from ..schemas import (
    CalendarStatus, CalendarAuthStart, CalendarAuthCallback,
    CalendarEventOut,
)
from ..services.google_calendar import GoogleCalendarService

router = APIRouter(prefix="/calendar", tags=["calendar"])

_FRONTEND = os.getenv("FRONTEND_URL", "http://localhost:5173")


def _cal_service(db: Session, user_id: int) -> GoogleCalendarService:
    return GoogleCalendarService(db, user_id)


def _sync_events_to_db(svc: GoogleCalendarService, db: Session, user_id: int, days: int = 60) -> int:
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
            start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00")).astimezone(_STOCKHOLM).replace(tzinfo=None)
            end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00")).astimezone(_STOCKHOLM).replace(tzinfo=None)
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
                user_id=user_id,
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
                        user_id=user_id,
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
def calendar_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = _cal_service(db, current_user.id)
    return CalendarStatus(
        authenticated=svc.is_authenticated(),
        email=svc.get_email(),
        needs_reauth=svc.needs_reauth() if svc.is_authenticated() else False,
    )


@router.post("/auth/start")
def start_auth(
    req: CalendarAuthStart,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate Google OAuth consent URL."""
    svc = _cal_service(db, current_user.id)
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
    We find the user via stored OAuth token record, exchange the code, then redirect to frontend.
    """
    frontend = _FRONTEND

    if error:
        return RedirectResponse(f"{frontend}/settings?calendar_error={error}")
    if not code:
        return RedirectResponse(f"{frontend}/settings?calendar_error=no_code")

    # Find user who most recently started an OAuth flow
    token_record = db.query(OAuthToken).order_by(OAuthToken.updated_at.desc()).first()
    if not token_record:
        user = db.query(User).first()
        if not user:
            return RedirectResponse(f"{frontend}/settings?calendar_error=no_user")
        user_id = user.id
    else:
        user_id = token_record.user_id

    svc = _cal_service(db, user_id)
    client_id, client_secret, redirect_uri = svc.get_saved_client_creds()

    if not client_id or not client_secret:
        return RedirectResponse(f"{frontend}/settings?calendar_error=missing_credentials")

    backend_url = os.getenv("BACKEND_URL", "http://localhost:8000")
    fallback_uri = f"{backend_url}/api/calendar/auth/callback"
    success = svc.exchange_code(code, client_id, client_secret, redirect_uri or fallback_uri)

    if success:
        try:
            _sync_events_to_db(svc, db, user_id, days=60)
        except Exception:
            pass
        return RedirectResponse(f"{frontend}/settings?calendar=connected")
    return RedirectResponse(f"{frontend}/settings?calendar_error=exchange_failed")


@router.post("/auth/callback")
def auth_callback(
    req: CalendarAuthCallback,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Exchange OAuth code for tokens and store them (manual flow fallback)."""
    svc = _cal_service(db, current_user.id)
    success = svc.exchange_code(req.code, req.client_id, req.client_secret, req.redirect_uri)
    if not success:
        raise HTTPException(status_code=400, detail="OAuth code exchange failed")
    return {"ok": True, "message": "Google Calendar connected successfully"}


@router.delete("/auth")
def disconnect(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Revoke and delete stored OAuth token."""
    svc = _cal_service(db, current_user.id)
    svc.revoke()
    return {"ok": True}


@router.post("/sync")
def sync_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Sync next 60 days of Google Calendar events to the CalendarEvent table."""
    svc = _cal_service(db, current_user.id)
    if not svc.is_authenticated():
        raise HTTPException(status_code=401, detail="Google Calendar not connected")
    synced = _sync_events_to_db(svc, db, current_user.id, days=60)
    return {"ok": True, "synced": synced}


@router.get("/events", response_model=list[CalendarEventOut])
def list_events(
    date_from: str = None,
    date_to: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List synced calendar events from DB."""
    query = db.query(CalendarEvent).filter(CalendarEvent.user_id == current_user.id)
    if date_from:
        try:
            query = query.filter(CalendarEvent.start_dt >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            query = query.filter(CalendarEvent.start_dt <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    return query.order_by(CalendarEvent.start_dt).all()


@router.post("/create-block/{block_id}")
def create_calendar_block(
    block_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Push a StudyBlock to Google Calendar as an event."""
    from ..models import StudyBlock

    block = db.query(StudyBlock).filter(
        StudyBlock.id == block_id,
        StudyBlock.user_id == current_user.id,
    ).first()
    if not block:
        raise HTTPException(status_code=404, detail="Study block not found")

    svc = _cal_service(db, current_user.id)
    if not svc.is_authenticated():
        raise HTTPException(status_code=401, detail="Google Calendar not connected")

    if not block.start_time or not block.end_time:
        raise HTTPException(status_code=400, detail="Block has no scheduled time")

    type_labels = {
        "pre_lecture":      "📚 Förberedelse",
        "post_lecture":     "✏️ Genomgång",
        "daily_repetition": "🔄 Repetition",
        "reading":          "📖 Läsning",
        "activation":       "⚡ Aktivering",
        "practice_test":    "📝 Övningsprov",
        "timed_drill":      "⏱ Tidsbegränsad drill",
        "mistake_review":   "🔍 Felgenomgång",
        "active_recall":    "🧠 Aktiv återkallning",
        "case_study":       "🩺 Fallstudie",
        "resource":         "▶️ Studiematerial",
    }
    payload_label = (block.payload or {}).get("label", "")
    base = type_labels.get(block.block_type, "📚 Studieblock")
    title = f"{base}: {payload_label}" if payload_label else base
    desc = (block.payload or {}).get("description") or f"AI-schemalagd studieblock ({block.duration_minutes} min)"

    gid = svc.create_event(
        title=title,
        start=block.start_time,
        end=block.end_time,
        description=desc,
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
    current_user: User = Depends(get_current_user),
):
    """Push all saved study blocks in the date range to Google Calendar."""
    from ..models import StudyBlock

    svc = _cal_service(db, current_user.id)
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
            StudyBlock.user_id == current_user.id,
            StudyBlock.scheduled_date >= dt_from,
            StudyBlock.scheduled_date <= dt_to,
            StudyBlock.start_time != None,
            StudyBlock.end_time != None,
        )
        .all()
    )

    _NON_STUDY = {"lunch", "gym", "break"}

    type_labels = {
        "pre_lecture":      "📚 Förberedelse",
        "post_lecture":     "✏️ Genomgång",
        "daily_repetition": "🔄 Repetition",
        "reading":          "📖 Läsning",
        "activation":       "⚡ Aktivering",
        "practice_test":    "📝 Övningsprov",
        "timed_drill":      "⏱ Tidsbegränsad drill",
        "mistake_review":   "🔍 Felgenomgång",
        "active_recall":    "🧠 Aktiv återkallning",
        "case_study":       "🩺 Fallstudie",
        "resource":         "▶️ Studiematerial",
    }

    pushed = 0
    errors = []
    for block in blocks:
        if block.block_type in _NON_STUDY:
            continue
        if block.google_event_id:
            continue
        label = type_labels.get(block.block_type, "📚 Studieblock")
        # Include the specific activity label from payload if available
        payload_label = (block.payload or {}).get("label", "")
        if payload_label:
            title = f"{label}: {payload_label}"
        else:
            title = label
        desc = (block.payload or {}).get("description", "")
        if not desc:
            desc = f"AI-schemalagd studieblock ({block.duration_minutes} min)"
        gid = svc.create_event(
            title=title,
            start=block.start_time,
            end=block.end_time,
            description=desc,
        )
        if gid:
            block.google_event_id = gid
            pushed += 1
        else:
            errors.append(block.id)

    db.commit()
    return {"ok": True, "pushed": pushed, "failed": len(errors)}


@router.delete("/event/{google_event_id}")
def delete_calendar_event(
    google_event_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a Google Calendar event."""
    svc = _cal_service(db, current_user.id)
    if not svc.is_authenticated():
        raise HTTPException(status_code=401, detail="Google Calendar not connected")
    success = svc.delete_event(google_event_id)
    return {"ok": success}
