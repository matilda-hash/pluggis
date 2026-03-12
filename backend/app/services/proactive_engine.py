"""
Proactive Engine — runs at schedule generation time to detect issues
and inject warnings, auto-adjustments, and suggestions.
"""

from datetime import date, datetime, timedelta
from typing import Optional


def run_proactive_checks(
    profile: dict,
    exams: list,
    topics: list,
    recent_sessions: list,  # last 14 days
    today: date,
) -> list[dict]:
    """Returns sorted list of triggered proactive suggestions."""
    triggered = []

    # 1. Neglected topic: not reviewed in 9+ days and review is overdue
    for t in topics:
        last_rev = t.get("fsrs_last_review")
        next_rev = t.get("fsrs_next_review")
        if isinstance(last_rev, datetime):
            days_since = (datetime.utcnow() - last_rev).days
        elif isinstance(last_rev, date):
            days_since = (today - last_rev).days
        else:
            days_since = 999

        if isinstance(next_rev, datetime):
            next_rev_date = next_rev.date()
        elif isinstance(next_rev, date):
            next_rev_date = next_rev
        else:
            next_rev_date = None

        if (
            days_since > 9
            and t.get("mastery_level") not in ("mastered",)
            and next_rev_date
            and next_rev_date <= today + timedelta(days=2)
        ):
            triggered.append({
                "type": "warning",
                "priority": "high",
                "message": (
                    f"⚠️ '{t['name']}' har inte repeterats på {days_since} dagar "
                    f"och förfaller snart."
                ),
                "action": "add_to_schedule",
                "topic_id": t.get("id"),
            })

    # 2. Exam crunch zone: <21 days away, readiness < 60%
    for exam in exams:
        ed = exam.get("exam_date")
        if isinstance(ed, str):
            ed = date.fromisoformat(ed)
        elif isinstance(ed, datetime):
            ed = ed.date()
        if not ed:
            continue
        days_left = (ed - today).days
        readiness = exam.get("readiness_score", 0.0)
        if 0 < days_left <= 21 and readiness < 0.60:
            triggered.append({
                "type": "warning",
                "priority": "critical",
                "message": (
                    f"🚨 {exam.get('name')} är om {days_left} dagar och "
                    f"beredskapen är {round(readiness * 100)}%. Ökar daglig studietid."
                ),
                "action": "increase_daily_allocation",
                "exam_id": exam.get("id"),
            })

    # 3. Consistent struggle: avg quiz score < 65% after 3+ sessions
    for t in topics:
        if t.get("total_review_sessions", 0) >= 3 and t.get("average_quiz_score", 1.0) < 0.65:
            triggered.append({
                "type": "tip",
                "priority": "medium",
                "message": (
                    f"📊 Du kämpar med '{t['name']}'. "
                    f"Föreslår att byta studieteknik – prova teach-back istället för flashcards."
                ),
                "action": "suggest_technique_change",
                "topic_id": t.get("id"),
            })

    # 4. Commute opportunity
    commute = profile.get("commute_to_campus_minutes", 0)
    if commute >= 15:
        triggered.append({
            "type": "tip",
            "priority": "low",
            "message": f"🎧 Du har {commute} min pendling – ett audio-learning-block läggs till för pendlingen.",
            "action": "add_audio_block",
        })

    # 5. Burnout risk: studied >140% of target for 5 consecutive days
    if len(recent_sessions) >= 5:
        last5 = recent_sessions[-5:]
        targets = [s.get("target_hours", 7) for s in last5]
        actuals = [s.get("actual_hours", 0) for s in last5]
        avg_target = sum(targets) / len(targets)
        avg_actual = sum(actuals) / len(actuals)
        if avg_actual > avg_target * 1.4 and all(s.get("completion_pct", 0) > 90 for s in last5):
            triggered.append({
                "type": "tip",
                "priority": "medium",
                "message": "💪 Du har kört hårt 5 dagar i rad. Imorgon: lätt repetitionsdag med halverad workload.",
                "action": "suggest_light_day",
            })

    # 6. Multiple exams within 14 days
    near_exams = []
    for exam in exams:
        ed = exam.get("exam_date")
        if isinstance(ed, str):
            ed = date.fromisoformat(ed)
        elif isinstance(ed, datetime):
            ed = ed.date()
        if ed and 0 < (ed - today).days <= 14:
            near_exams.append(exam)
    if len(near_exams) >= 2:
        triggered.append({
            "type": "warning",
            "priority": "critical",
            "message": f"⚡ Du har {len(near_exams)} tentor inom 14 dagar. Rebalanserar schema automatiskt.",
            "action": "rebalance_allocation",
        })

    # 7. No mock exam in 21 days, but has proficient topics
    if recent_sessions:
        recent_types = [
            block.get("block_type")
            for s in recent_sessions
            for block in s.get("blocks", [])
        ]
        has_proficient = any(t.get("mastery_level") in ("proficient", "mastered") for t in topics)
        if "mock_exam_section" not in recent_types and has_proficient:
            triggered.append({
                "type": "tip",
                "priority": "medium",
                "message": "📝 Du har inte gjort en simulerad tenta på länge. Ska Pluggis lägga till en imorgon?",
                "action": "schedule_mock_exam",
            })

    # Sort by priority
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    triggered.sort(key=lambda x: order.get(x.get("priority", "low"), 3))
    return triggered
