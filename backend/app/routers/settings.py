"""
User settings and preferences router.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db, DEFAULT_USER_ID
from ..models import User
from ..schemas import AppPreferences, SettingsOut
from ..services.anki_connect import AnkiConnectClient
from ..services.google_calendar import GoogleCalendarService

router = APIRouter(prefix="/settings", tags=["settings"])


def _get_user(db: Session) -> User:
    return db.query(User).filter(User.id == DEFAULT_USER_ID).first()


@router.get("/", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    user = _get_user(db)
    prefs = _parse_prefs(user)

    anki_client = AnkiConnectClient()
    cal_svc = GoogleCalendarService(db, DEFAULT_USER_ID)

    return SettingsOut(
        preferences=prefs,
        anki_available=anki_client.is_available(),
        calendar_authenticated=cal_svc.is_authenticated(),
        calendar_email=cal_svc.get_email(),
    )


@router.put("/", response_model=SettingsOut)
def update_settings(req: AppPreferences, db: Session = Depends(get_db)):
    user = _get_user(db)
    settings = user.settings or {}
    settings.update({
        "daily_goal": req.daily_goal,
        "morning_activation": req.morning_activation,
        "study_window_start": req.study_window_start,
        "study_window_end": req.study_window_end,
        "anki_connect_url": req.anki_connect_url,
        "weekly_hours": req.weekly_hours,
        "study_days": req.study_days,
    })
    user.settings = settings
    user.daily_goal = req.daily_goal
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(user, "settings")  # Force SQLAlchemy to detect JSON mutation
    db.commit()

    anki_client = AnkiConnectClient()
    cal_svc = GoogleCalendarService(db, DEFAULT_USER_ID)

    return SettingsOut(
        preferences=req,
        anki_available=anki_client.is_available(),
        calendar_authenticated=cal_svc.is_authenticated(),
        calendar_email=cal_svc.get_email(),
    )


@router.get("/preferences", response_model=AppPreferences)
def get_preferences(db: Session = Depends(get_db)):
    user = _get_user(db)
    return _parse_prefs(user)


@router.put("/preferences", response_model=AppPreferences)
def update_preferences(req: AppPreferences, db: Session = Depends(get_db)):
    user = _get_user(db)
    settings = user.settings or {}
    # Merge all preference fields (model_dump handles new fields automatically)
    settings.update(req.model_dump())
    user.settings = settings
    user.daily_goal = req.daily_goal
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(user, "settings")  # Force SQLAlchemy to detect JSON mutation
    db.commit()
    return req


def _parse_prefs(user: User) -> AppPreferences:
    s = user.settings or {}
    return AppPreferences(
        daily_goal=s.get("daily_goal", user.daily_goal or 80),
        morning_activation=s.get("morning_activation", False),
        study_window_start=s.get("study_window_start", "08:00"),
        study_window_end=s.get("study_window_end", "17:00"),
        anki_connect_url=s.get("anki_connect_url", "http://localhost:8765"),
        weekly_hours=s.get("weekly_hours", 30.0),
        study_days=s.get("study_days", {}),
    )
