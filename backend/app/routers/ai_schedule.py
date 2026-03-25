"""
AI Schedule router — handles daily AI-generated schedules, topics,
onboarding, mock exams, and weekly check-ins.
"""

from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import SessionLocal, get_db
from ..models import (
    AISchedule, AIStudyBlock, Exam, ExamTopic,
    MockExam, MockQuestion, StudentProfile, User, WeeklyCheckin,
)
from ..services.ai_scheduler import (
    compute_daily_allocation,
    compute_urgency,
    generate_daily_schedule,
    topic_fsrs_after_review,
)
from ..services.mock_exam_generator import generate_mock_exam, generate_weekly_checkin
from ..services.proactive_engine import run_proactive_checks

router = APIRouter(prefix="/ai-schedule", tags=["ai-schedule"])

_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _profile_to_dict(p: StudentProfile) -> dict:
    return {
        "wake_time": p.wake_time,
        "sleep_time": p.sleep_time,
        "peak_hours_start": p.peak_hours_start,
        "peak_hours_end": p.peak_hours_end,
        "max_daily_study_hours": p.max_daily_study_hours,
        "preferred_session_length_minutes": p.preferred_session_length_minutes,
        "preferred_break_length_minutes": p.preferred_break_length_minutes,
        "recurring_commitments": p.recurring_commitments or [],
        "commute_to_campus_minutes": p.commute_to_campus_minutes,
        "study_location_preference": p.study_location_preference,
        "gym_days": p.gym_days or [],
        "gym_time": p.gym_time,
        "gym_duration_minutes": p.gym_duration_minutes,
        "session_structure_preference": p.session_structure_preference,
        "difficulty_preference": p.difficulty_preference,
        "feedback_style": p.feedback_style,
        "prior_bio_exposure": p.prior_bio_exposure,
        "prior_chem_exposure": p.prior_chem_exposure,
        "self_efficacy_score": p.self_efficacy_score,
    }


def _exam_to_dict(e: Exam) -> dict:
    ed = e.exam_date
    if isinstance(ed, datetime):
        ed = ed.date()
    return {
        "id": e.id,
        "name": e.name,
        "subject": getattr(e, "subject", "") or (e.study_config or {}).get("exam_type", "general"),
        "exam_date": ed.isoformat() if ed else "",
        "weight": 1.0,
        "readiness_score": 0.0,
        "estimated_hours_remaining": 20.0,
    }


def _topic_to_dict(t: ExamTopic) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "subject": t.subject,
        "exam_id": t.exam_id,
        "fsrs_stability": t.fsrs_stability,
        "fsrs_difficulty": t.fsrs_difficulty,
        "fsrs_retrievability": t.fsrs_retrievability,
        "fsrs_last_review": t.fsrs_last_review,
        "fsrs_next_review": t.fsrs_next_review,
        "mastery_level": t.mastery_level,
        "mastery_score": t.mastery_score,
        "total_study_minutes": t.total_study_minutes,
        "total_review_sessions": t.total_review_sessions,
        "average_quiz_score": t.average_quiz_score,
        "last_quiz_score": t.last_quiz_score,
        "error_streak": t.error_streak,
        "estimated_hours_to_master": t.estimated_hours_to_master,
    }


def _build_slots(profile: dict, today: date) -> list:
    """Build available time slots for the day."""
    start_h = int(profile.get("wake_time", "07:00").split(":")[0]) + 1
    sleep_h = int(profile.get("sleep_time", "23:00").split(":")[0])
    gym_days = [d.lower() for d in (profile.get("gym_days") or [])]
    today_name = _WEEKDAYS[today.weekday()]
    has_gym = today_name in gym_days
    gym_time = profile.get("gym_time", "evening")

    slots = []
    # Morning slot
    gym_start = {"morning": start_h, "midday": 12, "evening": 18}.get(gym_time, 18)
    gym_end = gym_start + (profile.get("gym_duration_minutes", 60) // 60) + 1 if has_gym else None

    # Work around gym if present
    if has_gym and gym_time == "morning":
        slots.append({"start": f"{gym_end:02d}:00", "end": "12:00", "type": "study"})
    else:
        slots.append({"start": f"{start_h:02d}:00", "end": "12:00", "type": "study"})

    slots.append({"start": "12:00", "end": "13:00", "type": "lunch"})

    if has_gym and gym_time == "midday":
        slots.append({"start": f"{gym_end:02d}:00", "end": "18:00", "type": "study"})
    else:
        slots.append({"start": "13:00", "end": "18:00", "type": "study"})

    if has_gym and gym_time == "evening":
        slots.append({"start": "18:00", "end": f"{gym_start:02d}:00", "type": "study"})
        slots.append({"start": f"{gym_start:02d}:00", "end": f"{gym_end:02d}:00", "type": "gym"})
        slots.append({"start": f"{gym_end:02d}:00", "end": f"{sleep_h:02d}:00", "type": "study"})
    else:
        slots.append({"start": "18:00", "end": f"{sleep_h:02d}:00", "type": "study"})

    # Remove commitments
    for c in (profile.get("recurring_commitments") or []):
        if c.get("day", "").lower() == today_name:
            slots = [s for s in slots if not (
                s["start"] >= c["start"] and s["end"] <= c["end"]
            )]

    return slots


def _get_or_create_profile(user_id: int, db: Session) -> StudentProfile:
    p = db.query(StudentProfile).filter(StudentProfile.user_id == user_id).first()
    if not p:
        p = StudentProfile(user_id=user_id)
        db.add(p)
        db.commit()
        db.refresh(p)
    return p


# ─── Profile / Onboarding ─────────────────────────────────────────────────────

class OnboardingData(BaseModel):
    wake_time: Optional[str] = "07:00"
    sleep_time: Optional[str] = "23:00"
    peak_hours_start: Optional[str] = "09:00"
    peak_hours_end: Optional[str] = "13:00"
    max_daily_study_hours: Optional[float] = 7.0
    preferred_session_length_minutes: Optional[int] = 50
    preferred_break_length_minutes: Optional[int] = 10
    recurring_commitments: Optional[list] = []
    commute_to_campus_minutes: Optional[int] = 0
    study_location_preference: Optional[str] = "home"
    gym_days: Optional[list] = []
    gym_time: Optional[str] = "evening"
    gym_duration_minutes: Optional[int] = 60
    session_structure_preference: Optional[str] = "focus_50"
    difficulty_preference: Optional[str] = "adaptive"
    feedback_style: Optional[str] = "direct"
    prior_bio_exposure: Optional[bool] = False
    prior_chem_exposure: Optional[bool] = False
    self_efficacy_score: Optional[float] = 3.0


@router.get("/profile")
def get_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    p = _get_or_create_profile(current_user.id, db)
    d = _profile_to_dict(p)
    d["onboarding_completed"] = p.onboarding_completed
    d["id"] = p.id
    return d


@router.post("/profile")
def save_profile(
    data: OnboardingData,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    p = _get_or_create_profile(current_user.id, db)
    for field, val in data.model_dump(exclude_none=True).items():
        setattr(p, field, val)
    p.onboarding_completed = True
    p.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    d = _profile_to_dict(p)
    d["onboarding_completed"] = p.onboarding_completed
    return d


# ─── Topics ───────────────────────────────────────────────────────────────────

class TopicCreate(BaseModel):
    exam_id: int
    name: str
    subject: str
    parent_topic_id: Optional[int] = None
    estimated_hours_to_master: Optional[float] = 3.0
    initial_difficulty: Optional[float] = 5.0


class TopicRatingRequest(BaseModel):
    rating: int  # 1–4


@router.get("/topics")
def list_topics(
    exam_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(ExamTopic).filter(ExamTopic.user_id == current_user.id)
    if exam_id:
        q = q.filter(ExamTopic.exam_id == exam_id)
    topics = q.order_by(ExamTopic.mastery_score.asc()).all()
    return [_topic_to_dict(t) for t in topics]


@router.post("/topics")
def create_topic(
    data: TopicCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exam = db.query(Exam).filter(Exam.id == data.exam_id, Exam.user_id == current_user.id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Tentamen hittades inte")

    t = ExamTopic(
        exam_id=data.exam_id,
        user_id=current_user.id,
        name=data.name,
        subject=data.subject,
        parent_topic_id=data.parent_topic_id,
        fsrs_difficulty=data.initial_difficulty or 5.0,
        fsrs_stability=1.0 + (10 - (data.initial_difficulty or 5.0)) * 0.1,
        estimated_hours_to_master=data.estimated_hours_to_master or 3.0,
        fsrs_next_review=datetime.utcnow(),
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _topic_to_dict(t)


@router.post("/topics/bulk")
def bulk_create_topics(
    items: List[TopicCreate],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    created = []
    for data in items:
        exam = db.query(Exam).filter(Exam.id == data.exam_id, Exam.user_id == current_user.id).first()
        if not exam:
            continue
        t = ExamTopic(
            exam_id=data.exam_id,
            user_id=current_user.id,
            name=data.name,
            subject=data.subject,
            parent_topic_id=data.parent_topic_id,
            fsrs_difficulty=data.initial_difficulty or 5.0,
            fsrs_stability=1.0 + (10 - (data.initial_difficulty or 5.0)) * 0.1,
            estimated_hours_to_master=data.estimated_hours_to_master or 3.0,
            fsrs_next_review=datetime.utcnow(),
        )
        db.add(t)
        created.append(t)
    db.commit()
    for t in created:
        db.refresh(t)
    return [_topic_to_dict(t) for t in created]


@router.post("/topics/{topic_id}/review")
def review_topic(
    topic_id: int,
    req: TopicRatingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    t = db.query(ExamTopic).filter(
        ExamTopic.id == topic_id, ExamTopic.user_id == current_user.id
    ).first()
    if not t:
        raise HTTPException(status_code=404, detail="Topic hittades inte")

    result = topic_fsrs_after_review(
        t.fsrs_stability, t.fsrs_difficulty, t.fsrs_last_review, req.rating, date.today()
    )
    t.fsrs_stability = result["stability"]
    t.fsrs_difficulty = result["difficulty"]
    t.fsrs_retrievability = result["retrievability"]
    t.fsrs_last_review = datetime.utcnow()
    t.fsrs_next_review = datetime.combine(result["next_review"], datetime.min.time())
    t.total_review_sessions += 1

    # Update mastery based on rating
    if req.rating == 4:
        t.mastery_score = min(1.0, t.mastery_score + 0.15)
        t.error_streak = 0
    elif req.rating == 3:
        t.mastery_score = min(1.0, t.mastery_score + 0.08)
        t.error_streak = 0
    elif req.rating == 2:
        t.error_streak = 0
    else:  # Again
        t.mastery_score = max(0.0, t.mastery_score - 0.1)
        t.error_streak += 1

    if t.mastery_score >= 0.90:
        t.mastery_level = "mastered"
    elif t.mastery_score >= 0.70:
        t.mastery_level = "proficient"
    elif t.mastery_score >= 0.45:
        t.mastery_level = "familiar"
    elif t.mastery_score > 0.0:
        t.mastery_level = "learning"

    t.updated_at = datetime.utcnow()
    db.commit()
    return _topic_to_dict(t)


@router.delete("/topics/{topic_id}")
def delete_topic(
    topic_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    t = db.query(ExamTopic).filter(
        ExamTopic.id == topic_id, ExamTopic.user_id == current_user.id
    ).first()
    if not t:
        raise HTTPException(status_code=404, detail="Topic hittades inte")
    db.delete(t)
    db.commit()
    return {"ok": True}


# ─── Daily Schedule ───────────────────────────────────────────────────────────

class CompleteBlockRequest(BaseModel):
    completion_percentage: int = 100
    self_reported_difficulty: Optional[int] = None
    completion_notes: Optional[str] = None


class FeedbackRequest(BaseModel):
    feedback_type: str  # too_hard|too_easy|too_long|free_text|...
    feedback_text: Optional[str] = None


@router.get("/schedule/today")
async def get_today_schedule(
    regenerate: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = date.today()
    today_str = today.isoformat()

    # Return cached schedule if exists and not regenerating
    if not regenerate:
        existing = (
            db.query(AISchedule)
            .filter(AISchedule.user_id == current_user.id, AISchedule.schedule_date == today_str)
            .order_by(AISchedule.generated_at.desc())
            .first()
        )
        if existing:
            return _schedule_out(existing)

    return await _generate_and_save(current_user, db, today)


@router.post("/schedule/feedback")
async def submit_feedback(
    req: FeedbackRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today_str = date.today().isoformat()
    sched = (
        db.query(AISchedule)
        .filter(AISchedule.user_id == current_user.id, AISchedule.schedule_date == today_str)
        .order_by(AISchedule.generated_at.desc())
        .first()
    )
    if sched:
        sched.student_feedback = req.feedback_text or req.feedback_type

    # Regenerate with feedback
    new_sched = await _generate_and_save(
        current_user, db, date.today(), student_feedback=req.feedback_text or req.feedback_type
    )
    return new_sched


@router.post("/schedule/block/{block_id}/complete")
def complete_block(
    block_id: int,
    req: CompleteBlockRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_id = current_user.id
    block = db.query(AIStudyBlock).filter(
        AIStudyBlock.id == block_id, AIStudyBlock.user_id == user_id
    ).first()
    if not block:
        raise HTTPException(status_code=404, detail="Block hittades inte")

    block.completed = True
    block.completion_percentage = req.completion_percentage
    block.self_reported_difficulty = req.self_reported_difficulty
    block.completion_notes = req.completion_notes
    block.completed_at = datetime.utcnow()

    # Update topic total_study_minutes
    if block.topic_id and req.completion_percentage > 0:
        t = db.query(ExamTopic).filter(
            ExamTopic.id == block.topic_id, ExamTopic.user_id == user_id
        ).first()
        if t:
            t.total_study_minutes += int(block.duration_minutes * req.completion_percentage / 100)
            t.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(block)
    return _block_out(block)


@router.get("/schedule/week")
def get_week_schedule(
    week_start: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if week_start:
        start = date.fromisoformat(week_start)
    else:
        today = date.today()
        start = today - timedelta(days=today.weekday())

    dates = [start + timedelta(days=i) for i in range(7)]
    date_strs = [d.isoformat() for d in dates]

    schedules = (
        db.query(AISchedule)
        .filter(
            AISchedule.user_id == current_user.id,
            AISchedule.schedule_date.in_(date_strs),
        )
        .order_by(AISchedule.schedule_date, AISchedule.generated_at.desc())
        .all()
    )

    # Return one per date (latest)
    seen = set()
    result = []
    for s in schedules:
        if s.schedule_date not in seen:
            seen.add(s.schedule_date)
            result.append(_schedule_out(s))
    return result


# ─── Mock Exam ────────────────────────────────────────────────────────────────

class MockExamRequest(BaseModel):
    exam_id: Optional[int] = None
    subject: Optional[str] = None
    duration_minutes: Optional[int] = 60
    n_questions: Optional[int] = 20


class MockAnswerRequest(BaseModel):
    answers: List[dict]  # [{"question_id": int, "answer": str, "time_seconds": int}]
    time_taken_minutes: Optional[int] = None


@router.post("/mock-exam/generate")
def create_mock_exam(
    req: MockExamRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(ExamTopic).filter(ExamTopic.user_id == current_user.id)
    if req.exam_id:
        q = q.filter(ExamTopic.exam_id == req.exam_id)
    if req.subject:
        q = q.filter(ExamTopic.subject == req.subject)

    weak_topics = q.order_by(ExamTopic.mastery_score.asc()).limit(15).all()
    if not weak_topics:
        raise HTTPException(status_code=400, detail="Inga topics att generera tenta ifrån. Lägg till topics först.")

    exam_name = ""
    if req.exam_id:
        exam = db.query(Exam).filter(Exam.id == req.exam_id, Exam.user_id == current_user.id).first()
        if exam:
            exam_name = exam.name

    data = generate_mock_exam(
        [_topic_to_dict(t) for t in weak_topics],
        duration_minutes=req.duration_minutes or 60,
        n_questions=req.n_questions or 20,
        exam_name=exam_name,
    )

    me = MockExam(
        user_id=current_user.id,
        exam_id=req.exam_id,
        title=data.get("exam_title", "Mock-tenta"),
        duration_minutes=data.get("duration_minutes", 60),
        instructions=data.get("instructions"),
    )
    db.add(me)
    db.flush()

    q_num = 1
    for section in data.get("sections", []):
        for q_data in section.get("questions", []):
            mq = MockQuestion(
                mock_exam_id=me.id,
                question_number=q_num,
                question_type=q_data.get("type", "mcq"),
                difficulty=q_data.get("difficulty", "medium"),
                subject=section.get("subject"),
                topic=q_data.get("topic"),
                question_text=q_data.get("question", ""),
                options=q_data.get("options"),
                correct_answer=q_data.get("correct_answer", ""),
                explanation=q_data.get("explanation"),
            )
            # Link to topic if found
            matching = next(
                (t for t in weak_topics if t.name == q_data.get("topic")), None
            )
            if matching:
                mq.topic_id = matching.id
            db.add(mq)
            q_num += 1

    db.commit()
    db.refresh(me)
    return _mock_exam_out(me, db)


@router.get("/mock-exam/{exam_id}")
def get_mock_exam(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    me = db.query(MockExam).filter(MockExam.id == exam_id, MockExam.user_id == current_user.id).first()
    if not me:
        raise HTTPException(status_code=404, detail="Mock-tenta hittades inte")
    return _mock_exam_out(me, db)


@router.get("/mock-exam")
def list_mock_exams(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exams = (
        db.query(MockExam)
        .filter(MockExam.user_id == current_user.id)
        .order_by(MockExam.created_at.desc())
        .limit(20)
        .all()
    )
    return [_mock_exam_summary(me) for me in exams]


@router.post("/mock-exam/{exam_id}/submit")
def submit_mock_exam(
    exam_id: int,
    req: MockAnswerRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    me = db.query(MockExam).filter(MockExam.id == exam_id, MockExam.user_id == current_user.id).first()
    if not me:
        raise HTTPException(status_code=404, detail="Mock-tenta hittades inte")

    correct = 0
    total = 0
    for ans in req.answers:
        q = db.query(MockQuestion).filter(
            MockQuestion.id == ans["question_id"],
            MockQuestion.mock_exam_id == exam_id,
        ).first()
        if not q:
            continue
        q.student_answer = ans.get("answer", "")
        q.time_to_answer_seconds = ans.get("time_seconds")
        q.is_correct = q.student_answer.strip().lower() == q.correct_answer.strip().lower()
        if q.is_correct:
            correct += 1
            q.fsrs_rating = 3  # Good
        else:
            q.fsrs_rating = 1  # Again
        total += 1

        # Update topic after mock answer
        if q.topic_id:
            t = db.query(ExamTopic).filter(
                ExamTopic.id == q.topic_id, ExamTopic.user_id == current_user.id
            ).first()
            if t:
                rating = 3 if q.is_correct else 1
                result = topic_fsrs_after_review(
                    t.fsrs_stability, t.fsrs_difficulty, t.fsrs_last_review, rating, date.today()
                )
                t.fsrs_stability = result["stability"]
                t.fsrs_difficulty = result["difficulty"]
                t.fsrs_retrievability = result["retrievability"]
                t.fsrs_last_review = datetime.utcnow()
                t.fsrs_next_review = datetime.combine(result["next_review"], datetime.min.time())
                # Update quiz scores
                sessions = t.total_review_sessions + 1
                t.last_quiz_score = 1.0 if q.is_correct else 0.0
                t.average_quiz_score = (
                    (t.average_quiz_score * (sessions - 1) + t.last_quiz_score) / sessions
                )
                t.total_review_sessions = sessions
                t.updated_at = datetime.utcnow()

    me.submitted_at = datetime.utcnow()
    me.score_percent = (correct / total * 100) if total > 0 else 0.0
    me.time_taken_minutes = req.time_taken_minutes
    db.commit()

    return {
        "score_percent": me.score_percent,
        "correct": correct,
        "total": total,
        "time_taken_minutes": me.time_taken_minutes,
    }


# ─── Weekly Check-in ──────────────────────────────────────────────────────────

class CheckinData(BaseModel):
    overall_satisfaction: Optional[int] = None
    hardest_subject_this_week: Optional[str] = None
    biggest_challenge: Optional[str] = None
    free_feedback: Optional[str] = None


@router.get("/checkin/weekly")
def get_weekly_checkin(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    week_start_str = week_start.isoformat()

    existing = db.query(WeeklyCheckin).filter(
        WeeklyCheckin.user_id == current_user.id,
        WeeklyCheckin.week_start_date == week_start_str,
    ).first()
    if existing:
        return _checkin_out(existing)

    # Generate new check-in
    week_end = week_start + timedelta(days=6)
    week_schedules = (
        db.query(AISchedule)
        .filter(
            AISchedule.user_id == current_user.id,
            AISchedule.schedule_date >= week_start_str,
            AISchedule.schedule_date <= week_end.isoformat(),
        )
        .all()
    )

    actual_hours = 0.0
    sessions_completed = 0
    sessions_skipped = 0
    by_subject: dict = {}
    technique_dist: dict = {}

    for s in week_schedules:
        for b in s.blocks:
            if b.completed:
                mins = b.duration_minutes * b.completion_percentage / 100
                actual_hours += mins / 60
                sessions_completed += 1
                if b.subject:
                    if b.subject not in by_subject:
                        by_subject[b.subject] = {"minutes": 0, "blocks": 0}
                    by_subject[b.subject]["minutes"] += mins
                    by_subject[b.subject]["blocks"] += 1
                tech = b.block_type or "unknown"
                technique_dist[tech] = technique_dist.get(tech, 0) + 1
            else:
                sessions_skipped += 1

    profile = db.query(StudentProfile).filter(StudentProfile.user_id == current_user.id).first()
    target = (profile.max_daily_study_hours * 5) if profile else 35.0

    exams = db.query(Exam).filter(Exam.user_id == current_user.id).all()
    exam_dates = {e.name: str(e.exam_date)[:10] for e in exams}

    missed = db.query(ExamTopic).filter(
        ExamTopic.user_id == current_user.id,
        ExamTopic.fsrs_next_review < datetime.utcnow(),
        ExamTopic.fsrs_last_review < datetime(week_start.year, week_start.month, week_start.day),
    ).count()

    week_data = {
        "week_start": week_start_str,
        "week_end": week_end.isoformat(),
        "target_hours": target,
        "actual_hours": round(actual_hours, 1),
        "sessions_completed": sessions_completed,
        "sessions_scheduled": sessions_completed + sessions_skipped,
        "by_subject": by_subject,
        "missed_reviews": missed,
        "technique_distribution": technique_dist,
        "exam_dates": exam_dates,
    }

    ai_result = generate_weekly_checkin(week_data)

    ci = WeeklyCheckin(
        user_id=current_user.id,
        week_start_date=week_start_str,
        actual_study_hours=actual_hours,
        target_study_hours=target,
        sessions_completed=sessions_completed,
        sessions_skipped=sessions_skipped,
        ai_assessment=ai_result.get("honest_assessment"),
        ai_raw=ai_result,
    )
    db.add(ci)
    db.commit()
    db.refresh(ci)
    return _checkin_out(ci)


@router.post("/checkin/weekly")
def save_checkin_response(
    data: CheckinData,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = date.today()
    week_start_str = (today - timedelta(days=today.weekday())).isoformat()
    ci = db.query(WeeklyCheckin).filter(
        WeeklyCheckin.user_id == current_user.id,
        WeeklyCheckin.week_start_date == week_start_str,
    ).first()
    if not ci:
        ci = WeeklyCheckin(user_id=current_user.id, week_start_date=week_start_str)
        db.add(ci)
    for field, val in data.model_dump(exclude_none=True).items():
        setattr(ci, field, val)
    db.commit()
    return {"ok": True}


# ─── Readiness analytics ──────────────────────────────────────────────────────

@router.get("/analytics/readiness")
def get_readiness(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exams = db.query(Exam).filter(Exam.user_id == current_user.id).all()
    result = []
    today = date.today()
    for exam in exams:
        topics = db.query(ExamTopic).filter(
            ExamTopic.exam_id == exam.id, ExamTopic.user_id == current_user.id
        ).all()
        total = len(topics)
        if total == 0:
            readiness = 0.0
        else:
            readiness = sum(t.mastery_score for t in topics) / total

        ed = exam.exam_date
        if isinstance(ed, datetime):
            ed = ed.date()
        days_left = (ed - today).days if ed else 999

        result.append({
            "exam_id": exam.id,
            "exam_name": exam.name,
            "days_left": days_left,
            "readiness_score": round(readiness, 3),
            "readiness_percent": round(readiness * 100, 1),
            "total_topics": total,
            "mastered": sum(1 for t in topics if t.mastery_level == "mastered"),
            "proficient": sum(1 for t in topics if t.mastery_level == "proficient"),
            "learning": sum(1 for t in topics if t.mastery_level in ("learning", "familiar")),
            "not_started": sum(1 for t in topics if t.mastery_level == "not_started"),
            "topic_breakdown": [
                {"name": t.name, "mastery_level": t.mastery_level, "mastery_score": round(t.mastery_score, 2)}
                for t in topics
            ],
        })
    return result


# ─── Output helpers ───────────────────────────────────────────────────────────

def _schedule_out(s: AISchedule) -> dict:
    return {
        "id": s.id,
        "schedule_date": s.schedule_date,
        "generated_at": s.generated_at.isoformat() if s.generated_at else None,
        "total_study_minutes": s.total_study_minutes,
        "summary": s.summary,
        "tomorrow_preview": s.tomorrow_preview,
        "student_approved": s.student_approved,
        "student_feedback": s.student_feedback,
        "blocks": [_block_out(b) for b in sorted(s.blocks, key=lambda b: b.block_number)],
        "proactive_suggestions": (s.ai_raw or {}).get("proactive_suggestions", []),
        "exam_readiness_update": (s.ai_raw or {}).get("exam_readiness_update", {}),
    }


def _block_out(b: AIStudyBlock) -> dict:
    return {
        "id": b.id,
        "block_number": b.block_number,
        "start_time": b.start_time,
        "end_time": b.end_time,
        "duration_minutes": b.duration_minutes,
        "subject": b.subject,
        "topic": b.topic,
        "subtopic": b.subtopic,
        "block_type": b.block_type,
        "study_technique": b.study_technique,
        "activity_title": b.activity_title,
        "activity_description": b.activity_description,
        "resources": b.resources or [],
        "learning_objective": b.learning_objective,
        "is_spaced_repetition": b.is_spaced_repetition,
        "location": b.location,
        "requires_screen": b.requires_screen,
        "difficulty": b.difficulty,
        "break_after_minutes": b.break_after_minutes,
        "completed": b.completed,
        "completion_percentage": b.completion_percentage,
        "self_reported_difficulty": b.self_reported_difficulty,
        "topic_id": b.topic_id,
    }


def _mock_exam_out(me: MockExam, db: Session) -> dict:
    questions = (
        db.query(MockQuestion)
        .filter(MockQuestion.mock_exam_id == me.id)
        .order_by(MockQuestion.question_number)
        .all()
    )
    return {
        "id": me.id,
        "title": me.title,
        "duration_minutes": me.duration_minutes,
        "instructions": me.instructions,
        "submitted": me.submitted_at is not None,
        "score_percent": me.score_percent,
        "questions": [
            {
                "id": q.id,
                "question_number": q.question_number,
                "type": q.question_type,
                "difficulty": q.difficulty,
                "subject": q.subject,
                "topic": q.topic,
                "question": q.question_text,
                "options": q.options,
                "correct_answer": q.correct_answer if me.submitted_at else None,
                "explanation": q.explanation if me.submitted_at else None,
                "student_answer": q.student_answer,
                "is_correct": q.is_correct,
            }
            for q in questions
        ],
    }


def _mock_exam_summary(me: MockExam) -> dict:
    return {
        "id": me.id,
        "title": me.title,
        "duration_minutes": me.duration_minutes,
        "created_at": me.created_at.isoformat() if me.created_at else None,
        "submitted": me.submitted_at is not None,
        "score_percent": me.score_percent,
    }


def _checkin_out(ci: WeeklyCheckin) -> dict:
    return {
        "id": ci.id,
        "week_start_date": ci.week_start_date,
        "actual_study_hours": ci.actual_study_hours,
        "target_study_hours": ci.target_study_hours,
        "sessions_completed": ci.sessions_completed,
        "sessions_skipped": ci.sessions_skipped,
        "overall_satisfaction": ci.overall_satisfaction,
        "hardest_subject_this_week": ci.hardest_subject_this_week,
        "biggest_challenge": ci.biggest_challenge,
        "free_feedback": ci.free_feedback,
        "ai_assessment": ci.ai_assessment,
        "ai_raw": ci.ai_raw,
    }


# ─── Internal schedule generation ────────────────────────────────────────────

async def _generate_and_save(
    current_user: User,
    db: Session,
    today: date,
    student_feedback: Optional[str] = None,
) -> dict:
    # Extract user_id as a plain int immediately — ORM objects can become detached
    # after a flush/commit or a long async await (Anthropic API call).
    user_id = current_user.id

    profile_obj = _get_or_create_profile(user_id, db)
    profile = _profile_to_dict(profile_obj)

    exams = db.query(Exam).filter(Exam.user_id == user_id).all()
    exam_dicts = [_exam_to_dict(e) for e in exams]

    topics = db.query(ExamTopic).filter(ExamTopic.user_id == user_id).all()
    topic_dicts = [_topic_to_dict(t) for t in topics]

    # Add exam_date and exam_weight to topics for urgency calculation
    exam_map = {e.id: e for e in exams}
    for td in topic_dicts:
        exam = exam_map.get(td.get("exam_id"))
        if exam:
            ed = exam.exam_date
            if isinstance(ed, datetime):
                ed = ed.date()
            td["exam_date"] = ed.isoformat() if ed else ""
            td["exam_weight"] = 1.0

    available_slots = _build_slots(profile, today)
    daily_allocation = compute_daily_allocation(exam_dicts, int(profile["max_daily_study_hours"] * 60), today)

    # If no topics/exams, use a generic allocation
    if not daily_allocation and exam_dicts:
        daily_allocation = {e.get("subject", "general"): int(profile["max_daily_study_hours"] * 30) for e in exam_dicts[:2]}

    # Recent sessions for context (last 7 days)
    week_ago = (today - timedelta(days=7)).isoformat()
    recent_scheds = (
        db.query(AISchedule)
        .filter(AISchedule.user_id == user_id, AISchedule.schedule_date >= week_ago)
        .all()
    )
    recent_sessions = []
    for s in recent_scheds:
        completed = sum(1 for b in s.blocks if b.completed)
        total = len(s.blocks)
        actual_h = sum(b.duration_minutes * b.completion_percentage / 100 for b in s.blocks if b.completed) / 60
        recent_sessions.append({
            "date": s.schedule_date,
            "actual_hours": round(actual_h, 1),
            "target_hours": profile["max_daily_study_hours"],
            "sessions_completed": completed,
            "sessions_total": total,
            "completion_pct": int(completed / total * 100) if total else 0,
        })

    # Proactive checks
    proactive = run_proactive_checks(profile, exam_dicts, topic_dicts, recent_sessions, today)

    # ── Phase 2: Call AI (long async operation — original session may expire) ───
    result = await generate_daily_schedule(
        profile=profile,
        exams=exam_dicts,
        topics=topic_dicts,
        today=today,
        available_slots=available_slots,
        daily_allocation=daily_allocation,
        recent_sessions=recent_sessions,
        pending_anki_reviews=0,
        student_feedback=student_feedback,
    )

    sched_data = result.get("schedule", {})
    existing_suggestions = sched_data.get("proactive_suggestions", [])
    sched_data["proactive_suggestions"] = proactive + existing_suggestions

    # ── Phase 3: Persist using a fresh session (original may have been released) ─
    write_db = SessionLocal()
    try:
        ai_sched = AISchedule(
            user_id=user_id,
            schedule_date=today.isoformat(),
            total_study_minutes=sched_data.get("total_study_minutes", 0),
            summary=sched_data.get("summary"),
            tomorrow_preview=sched_data.get("tomorrow_preview"),
            ai_raw=sched_data,
            generation_attempts=result.get("attempts", 1),
        )
        write_db.add(ai_sched)
        write_db.flush()

        for b_data in sched_data.get("blocks", []):
            block = AIStudyBlock(
                schedule_id=ai_sched.id,
                user_id=user_id,
                block_number=b_data.get("block_number", 1),
                start_time=b_data.get("start_time"),
                end_time=b_data.get("end_time"),
                duration_minutes=b_data.get("duration_minutes", 50),
                subject=b_data.get("subject"),
                topic=b_data.get("topic"),
                subtopic=b_data.get("subtopic"),
                block_type=b_data.get("block_type", "active_recall"),
                study_technique=b_data.get("study_technique"),
                activity_title=b_data.get("activity_title"),
                activity_description=b_data.get("activity_description"),
                resources=b_data.get("resources", []),
                learning_objective=b_data.get("learning_objective"),
                is_spaced_repetition=b_data.get("is_spaced_repetition", False),
                location=b_data.get("location", "home"),
                requires_screen=b_data.get("requires_screen", True),
                difficulty=b_data.get("difficulty", 3),
                break_after_minutes=b_data.get("break_after_minutes", 10),
            )
            write_db.add(block)

        write_db.commit()
        write_db.refresh(ai_sched)
        return _schedule_out(ai_sched)
    finally:
        write_db.close()
