from datetime import date, datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Card, CardState, Deck, Review, StudySession, User
from ..schemas import DashboardStats, DailyCount, TodayStats
from ..services.fsrs import State

router = APIRouter(prefix="/stats", tags=["stats"])


def compute_streak(db: Session, user_id: int) -> int:
    today = date.today()
    streak = 0
    check_date = today
    MAX_STREAK = 3650  # cap at 10 years to avoid runaway queries
    while streak < MAX_STREAK:
        day_start = datetime.combine(check_date, datetime.min.time())
        day_end = day_start + timedelta(days=1)
        if not db.query(Review).filter(
            Review.user_id == user_id,
            Review.reviewed_at >= day_start,
            Review.reviewed_at < day_end,
        ).count():
            break
        streak += 1
        check_date -= timedelta(days=1)
    return streak


def compute_smart_daily_goal(db: Session, base_goal: int, user_id: int) -> dict:
    today = date.today()
    now = datetime.utcnow()
    today_dt = datetime.combine(today, datetime.min.time())

    from ..models import Exam
    nearest_exam = (
        db.query(Exam)
        .filter(Exam.user_id == user_id, Exam.exam_date >= today_dt)
        .order_by(Exam.exam_date.asc())
        .first()
    )

    days_to_exam = None
    nearest_exam_name = None
    if nearest_exam:
        days_to_exam = max(0, (nearest_exam.exam_date.date() - today).days)
        nearest_exam_name = nearest_exam.name

    state_ids_subq = db.query(CardState.card_id).filter(CardState.user_id == user_id)
    no_state = (
        db.query(Card)
        .join(Deck, Card.deck_id == Deck.id)
        .filter(Deck.user_id == user_id, ~Card.id.in_(state_ids_subq), Card.is_suspended == False)
        .count()
    )
    due_count = (
        db.query(CardState).filter(
            CardState.user_id == user_id,
            or_(CardState.due <= now, CardState.due == None, CardState.state == int(State.New)),
        ).count()
    ) + no_state

    week_ago = now - timedelta(days=7)
    recent = db.query(Review).filter(
        Review.user_id == user_id, Review.reviewed_at >= week_ago
    ).all()
    forget_rate = (sum(1 for r in recent if r.rating == 1) / len(recent)) if recent else 0.0

    smart_goal = base_goal

    if days_to_exam is not None:
        if days_to_exam == 0:
            smart_goal = max(base_goal, due_count)
        elif due_count > 0:
            daily_needed = int(due_count / max(1, days_to_exam) * 1.4)
            smart_goal = max(base_goal, daily_needed)

        if days_to_exam <= 3:
            smart_goal = int(smart_goal * 2.5)
        elif days_to_exam <= 7:
            smart_goal = int(smart_goal * 2.0)
        elif days_to_exam <= 14:
            smart_goal = int(smart_goal * 1.5)
        elif days_to_exam <= 30:
            smart_goal = int(smart_goal * 1.2)

    if forget_rate > 0.45:
        smart_goal = int(smart_goal * 0.80)

    return {
        "smart_goal": max(20, min(300, smart_goal)),
        "days_to_exam": days_to_exam,
        "nearest_exam_name": nearest_exam_name,
    }


@router.get("/dashboard", response_model=DashboardStats)
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.utcnow()
    today_start = datetime.combine(date.today(), datetime.min.time())
    today_end = today_start + timedelta(days=1)

    today_reviews = db.query(Review).filter(
        Review.user_id == current_user.id,
        Review.reviewed_at >= today_start,
        Review.reviewed_at < today_end,
    ).all()

    again = sum(1 for r in today_reviews if r.rating == 1)
    hard  = sum(1 for r in today_reviews if r.rating == 2)
    good  = sum(1 for r in today_reviews if r.rating == 3)
    easy  = sum(1 for r in today_reviews if r.rating == 4)
    total_reviewed = len(today_reviews)

    skipped = sum(
        s.skipped_count for s in db.query(StudySession).filter(
            StudySession.user_id == current_user.id,
            StudySession.started_at >= today_start,
            StudySession.ended_at.isnot(None),
        )
    )

    sessions_today = db.query(StudySession).filter(
        StudySession.user_id == current_user.id, StudySession.started_at >= today_start
    ).all()
    time_minutes = 0
    for s in sessions_today:
        end = s.ended_at or now
        time_minutes += int((end - s.started_at).total_seconds() / 60)

    avg_sec = max(5.0, min(120.0, (time_minutes * 60 / total_reviewed) if total_reviewed > 0 else 15.0))

    daily_goal = current_user.daily_goal or 80

    goal_info = compute_smart_daily_goal(db, daily_goal, current_user.id)
    smart_goal = goal_info["smart_goal"]
    est_time_goal_minutes = max(1, int(smart_goal * avg_sec / 60))

    state_ids_subq = db.query(CardState.card_id).filter(CardState.user_id == current_user.id)
    no_state = (
        db.query(Card)
        .join(Deck, Card.deck_id == Deck.id)
        .filter(Deck.user_id == current_user.id, ~Card.id.in_(state_ids_subq), Card.is_suspended == False)
        .count()
    )
    total_due = db.query(CardState).filter(
        CardState.user_id == current_user.id, CardState.due <= now
    ).count() + no_state

    streak = compute_streak(db, current_user.id)

    weekly = []
    for i in range(6, -1, -1):
        d = date.today() - timedelta(days=i)
        ds = datetime.combine(d, datetime.min.time())
        cnt = db.query(Review).filter(
            Review.user_id == current_user.id, Review.reviewed_at >= ds, Review.reviewed_at < ds + timedelta(days=1)
        ).count()
        weekly.append(DailyCount(date=d.isoformat(), count=cnt))

    history = []
    for i in range(111, -1, -1):
        d = date.today() - timedelta(days=i)
        ds = datetime.combine(d, datetime.min.time())
        cnt = db.query(Review).filter(
            Review.user_id == current_user.id, Review.reviewed_at >= ds, Review.reviewed_at < ds + timedelta(days=1)
        ).count()
        history.append(DailyCount(date=d.isoformat(), count=cnt))

    new_cards_history = []
    for i in range(55, -1, -1):
        d = date.today() - timedelta(days=i)
        ds = datetime.combine(d, datetime.min.time())
        cnt = (
            db.query(Card)
            .join(Deck, Card.deck_id == Deck.id)
            .filter(
                Deck.user_id == current_user.id,
                Card.created_at >= ds,
                Card.created_at < ds + timedelta(days=1),
            )
            .count()
        )
        new_cards_history.append(DailyCount(date=d.isoformat(), count=cnt))

    return DashboardStats(
        today=TodayStats(
            cards_studied=total_reviewed,
            time_studied_minutes=time_minutes,
            est_time_goal_minutes=est_time_goal_minutes,
            again=again, hard=hard, good=good, easy=easy,
            skipped=skipped, streak=streak,
            daily_goal=daily_goal, smart_daily_goal=smart_goal,
            total_due=total_due,
            nearest_exam_name=goal_info["nearest_exam_name"],
            nearest_exam_days=goal_info["days_to_exam"],
        ),
        weekly=weekly, history=history, new_cards_history=new_cards_history,
    )


@router.get("/deck/{deck_id}")
def get_deck_stats(
    deck_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from ..routers.decks import compute_deck_stats
    return compute_deck_stats(deck_id, db, user_id=current_user.id)
