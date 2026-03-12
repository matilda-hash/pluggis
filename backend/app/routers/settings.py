"""
User settings and preferences router.
"""

import os
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import User
from ..schemas import AppPreferences, SettingsOut
from ..services.anki_connect import AnkiConnectClient
from ..services.google_calendar import GoogleCalendarService

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/", response_model=SettingsOut)
def get_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    prefs = _parse_prefs(current_user)

    anki_client = AnkiConnectClient()
    cal_svc = GoogleCalendarService(db, current_user.id)

    backend_url = os.getenv("BACKEND_URL", "http://localhost:8000")
    redirect_uri = f"{backend_url}/api/calendar/auth/callback"

    return SettingsOut(
        preferences=prefs,
        anki_available=anki_client.is_available(),
        calendar_authenticated=cal_svc.is_authenticated(),
        calendar_email=cal_svc.get_email(),
        redirect_uri=redirect_uri,
    )


@router.put("/", response_model=SettingsOut)
def update_settings(
    req: AppPreferences,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy.orm.attributes import flag_modified
    from ..models import StudyBlock
    from datetime import date as _date  # noqa: PLC0415

    old_study_days = (current_user.settings or {}).get("study_days", {})

    settings = current_user.settings or {}
    settings.update({
        "daily_goal": req.daily_goal,
        "morning_activation": req.morning_activation,
        "study_window_start": req.study_window_start,
        "study_window_end": req.study_window_end,
        "anki_connect_url": req.anki_connect_url,
        "weekly_hours": req.weekly_hours,
        "study_days": req.study_days,
    })
    current_user.settings = settings
    current_user.daily_goal = req.daily_goal
    flag_modified(current_user, "settings")

    # Delete planned blocks for any days that were just disabled
    _WEEKDAY_INDEX = {
        "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
        "friday": 4, "saturday": 5, "sunday": 6,
    }
    new_study_days = req.study_days or {}
    for day_name, day_cfg in new_study_days.items():
        if not isinstance(day_cfg, dict):
            continue
        if day_cfg.get("enabled", True):
            continue  # still enabled — nothing to do
        old_cfg = old_study_days.get(day_name, {})
        if not old_cfg.get("enabled", True):
            continue  # was already disabled — nothing new to delete
        # Day was just disabled: remove all planned blocks on that weekday
        weekday_num = _WEEKDAY_INDEX.get(day_name)
        if weekday_num is None:
            continue
        # Find planned blocks for this weekday in the next 60 days
        today = datetime.combine(_date.today(), datetime.min.time())
        end_dt = today + timedelta(days=60)
        all_planned = (
            db.query(StudyBlock)
            .filter(
                StudyBlock.user_id == current_user.id,
                StudyBlock.scheduled_date >= today,
                StudyBlock.scheduled_date < end_dt,
                StudyBlock.status == "planned",
            )
            .all()
        )
        for b in all_planned:
            if b.scheduled_date.weekday() == weekday_num:
                db.delete(b)

    db.commit()

    anki_client = AnkiConnectClient()
    cal_svc = GoogleCalendarService(db, current_user.id)

    backend_url = os.getenv("BACKEND_URL", "http://localhost:8000")
    redirect_uri = f"{backend_url}/api/calendar/auth/callback"

    return SettingsOut(
        preferences=req,
        anki_available=anki_client.is_available(),
        calendar_authenticated=cal_svc.is_authenticated(),
        calendar_email=cal_svc.get_email(),
        redirect_uri=redirect_uri,
    )


@router.get("/preferences", response_model=AppPreferences)
def get_preferences(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _parse_prefs(current_user)


@router.put("/preferences", response_model=AppPreferences)
def update_preferences(
    req: AppPreferences,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    settings = current_user.settings or {}
    settings.update(req.model_dump())
    current_user.settings = settings
    current_user.daily_goal = req.daily_goal
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(current_user, "settings")
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
