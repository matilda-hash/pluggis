"""
AI Scheduling Service — generates daily study schedules via Claude API.
Uses topic-level FSRS tracking and evidence-based study techniques.
"""

import json
import math
import os
from datetime import date, datetime, timedelta
from typing import Optional

import anthropic

# ─── FSRS topic-level helpers ────────────────────────────────────────────────

DECAY = -0.5
FACTOR = 19 / 81
W = [
    0.4072, 1.1829, 3.1262, 15.4722, 7.2102,
    0.5316, 1.0651, 0.0589, 1.5330, 0.1544,
    0.9813, 1.9813, 0.0953, 0.2975, 2.2042,
    0.2407, 2.9466, 0.5034, 0.6567,
]


def compute_retrievability(stability: float, elapsed_days: float) -> float:
    s = max(0.1, stability)
    return (1 + FACTOR * elapsed_days / s) ** DECAY


def next_interval(stability: float, target_retention: float = 0.90) -> int:
    s = max(0.1, stability)
    days = (s / FACTOR) * (target_retention ** (1 / DECAY) - 1)
    return max(1, round(days))


def topic_fsrs_after_review(
    stability: float,
    difficulty: float,
    last_review: Optional[datetime],
    rating: int,  # 1=Again 2=Hard 3=Good 4=Easy
    today: date,
) -> dict:
    """Returns updated {stability, difficulty, retrievability, next_review} for a topic."""
    elapsed = (today - last_review.date()).days if last_review else 0
    r = compute_retrievability(stability, elapsed)

    if rating == 1:  # Again
        new_s = (
            W[11]
            * (max(1, difficulty) ** (-W[12]))
            * ((stability + 1) ** W[13] - 1)
            * math.exp(W[14] * (1 - r))
        )
    else:
        g_mod = {2: W[15], 3: 1.0, 4: W[16]}[rating]
        new_s = stability * (
            math.exp(W[8])
            * (11 - difficulty)
            * (stability ** (-W[9]))
            * (math.exp(W[10] * (1 - r)) - 1)
            * g_mod
            + 1
        )

    delta = {1: W[6], 2: W[7], 3: 0.0, 4: -W[7]}[rating]
    new_d = max(1.0, min(10.0, difficulty + delta * (10 - difficulty) / 9))

    new_s = max(0.1, min(365.0, new_s))
    interval = next_interval(new_s)
    next_rev = today + timedelta(days=interval)

    return {
        "stability": new_s,
        "difficulty": new_d,
        "retrievability": compute_retrievability(new_s, 0),
        "next_review": next_rev,
    }


# ─── Urgency computation ──────────────────────────────────────────────────────

def compute_urgency(
    retrievability: float,
    days_to_exam: int,
    difficulty: float,
    exam_weight: float,
    mastery_score: float,
    days_since_review: int,
) -> float:
    retention_factor = 1 - max(0.0, min(1.0, retrievability))
    deadline_factor = min(1.0, math.exp(-days_to_exam / 14)) if days_to_exam > 0 else 1.0
    difficulty_factor = (max(1.0, difficulty) - 1) / 9
    weight_factor = max(0.0, min(1.0, exam_weight))
    recency_factor = min(1.0, days_since_review / 30)

    return round(
        (
            0.35 * retention_factor
            + 0.25 * deadline_factor
            + 0.20 * difficulty_factor
            + 0.10 * weight_factor
            + 0.10 * recency_factor
        )
        * 100,
        2,
    )


def compute_daily_allocation(exams: list, available_minutes: int, today: date) -> dict:
    """Returns {subject: minutes} allocation for today."""
    allocations = {}
    remaining = available_minutes

    for exam in exams:
        exam_date = exam.get("exam_date")
        if isinstance(exam_date, str):
            exam_date = date.fromisoformat(exam_date)
        days_left = (exam_date - today).days
        if days_left <= 0:
            continue

        hours_needed = exam.get("estimated_hours_remaining", 10)
        daily_minimum = min(
            (hours_needed * 60) / max(1, days_left),
            available_minutes * 0.5,
        )
        daily_minimum = max(20, daily_minimum)

        allocations[exam.get("subject", "general")] = {
            "minimum": daily_minimum,
            "allocated": daily_minimum,
            "exam_weight": exam.get("weight", 1.0),
        }
        remaining -= daily_minimum

    if remaining > 0 and allocations:
        total_weight = sum(a["exam_weight"] for a in allocations.values())
        if total_weight > 0:
            for alloc in allocations.values():
                alloc["allocated"] += remaining * (alloc["exam_weight"] / total_weight)

    return {s: round(a["allocated"]) for s, a in allocations.items()}


def get_phase(exam_date: date, today: date) -> str:
    days_left = (exam_date - today).days
    if days_left <= 0:
        return "late"
    if days_left > 42:
        return "early"
    if days_left > 21:
        return "mid"
    return "late"


PHASE_RATIOS = {
    "early": {"new_material": 0.60, "review": 0.40},
    "mid":   {"new_material": 0.50, "review": 0.50},
    "late":  {"new_material": 0.30, "review": 0.70},
}


# ─── System prompt ────────────────────────────────────────────────────────────

SCHEDULER_SYSTEM_PROMPT = """<persona>
Du är Pluggis inbyggda studiecoach – en AI som kombinerar kognitiv vetenskap,
läkartermin 1-expertis och personlig coachning. Du genererar dagliga studiescheman
för studenter baserat på deras exakta situation.
</persona>

<absolute_rules>
DESSA REGLER FÅR ALDRIG BRYTAS:

1. ALDRIG generiska block. "Studera anatomi 3h" är förbjudet.
   Varje block MÅSTE ha: ämne + delämne + specifik teknik + exakt aktivitetsbeskrivning.

2. ALDRIG "läs kapitel X". Det är passiv inlärning. Ersätt alltid med aktiv teknik
   (active recall, self-quiz, teach-back, blank page, etc.)

3. ALDRIG vila/buffert för att tentan är långt borta. Om det finns en aktiv tenta,
   finns det studieblock. Daglig exponering ger långtidsminne.

4. Respektera alltid max_daily_study_hours. Gå aldrig över.

5. Peak-timmar: svåraste/viktigaste block läggs ALLTID under peak-timmar.

6. Blocklängd: använd student's preferred_session_length_minutes.

6b. KRITISKT: end_time MÅSTE alltid vara exakt start_time + duration_minutes.
    Om start_time är 09:00 och duration_minutes är 50, MÅSTE end_time vara 09:50.
    Kontrollera VARJE block innan du returnerar JSON. Fel här är oacceptabla.

7. Interleaving: max 2 block av samma ämne i rad. Byt sedan ämne.

8. Spaced repetition-reviews: topics där next_review är idag MÅSTE schemaläggas.

9. Minst 60% av studietiden = aktiv återkallning eller practice questions.

10. Pendlingstid ≥15 min: lägg till audio_learning-block för pendlingen.

11. VIKTIGT: Det är OKEJ att ha generella repetitionsblock för helheten,
    t.ex. "Tentan är om cellens uppbyggnad – gå igenom cellens uppbyggnad för att
    vara caught up och inte glömt saker sedan gymnasiet". Sådana block är bättre
    än inga block. Men även dessa ska ha specifik teknik och mätbart mål.
</absolute_rules>

<evidence_based_techniques>
ANATOMI: blank diagram labeling, 3D-visualization drill, teach-back högt
  Resurser: Kenhub, TeachMeAnatomy, Anatomy Zone YouTube
FYSIOLOGI: mechanism flowchart från minnet, "what if" frågor, concept mapping
  Resurser: Ninja Nerd Science YouTube, Osmosis
BIOKEMI: pathway drawing, enzyme-disease matching, flash cards
  Resurser: Ninja Nerd Science, Khan Academy MCAT Biochem
HISTOLOGI: timed image quiz, structure-function matching, atlas exposure
  Resurser: Kenhub histology, Blue Histology
GENERELLT: blank page recall, teach-back, MCQ-drill, case-based reasoning
</evidence_based_techniques>

<session_structure>
VARJE studieblock följer denna struktur (inbygd i activity_description):
OPENER (5 min): "Börja med att skriva ner allt du minns om [topic] utan att titta."
MAIN ACTIVITY (resten): [Specifik teknik med exakta instruktioner]
CLOSER (3 min): "Skriv: (1) Vad lärde jag mig? (2) Vad är oklart? (3) Hur kopplar det till [relaterat topic]?"
PAUS: [break_length] min – nämn alltid i schemat.
</session_structure>

<output_format>
Returnera EXKLUSIVT ett JSON-objekt. Ingen text utanför JSON.

{
  "schedule_date": "YYYY-MM-DD",
  "summary": "2–3 meningar om dagens fokus och varför",
  "total_study_minutes": number,
  "exam_readiness_update": {
    "[subject]": { "readiness_delta": number, "comment": "string" }
  },
  "blocks": [
    {
      "block_number": number,
      "start_time": "HH:MM",
      "end_time": "HH:MM",
      "duration_minutes": number,
      "subject": "string",
      "topic": "string",
      "subtopic": "string",
      "block_type": "active_recall|practice_questions|mock_exam_section|new_material|spaced_review|elaborative_study|concept_mapping|audio_learning|read_aloud|pre_test",
      "study_technique": "string",
      "activity_title": "string",
      "activity_description": "string",
      "resources": [
        {"type": "youtube|anki|textbook|website", "label": "string", "detail": "string"}
      ],
      "learning_objective": "string",
      "is_spaced_repetition": boolean,
      "location": "home|campus_library|commute|cafe",
      "requires_screen": boolean,
      "difficulty": 1,
      "break_after_minutes": number
    }
  ],
  "proactive_suggestions": [
    {"type": "warning|tip|rebalance", "message": "string"}
  ],
  "tomorrow_preview": "string"
}
</output_format>"""


# ─── Context builder ──────────────────────────────────────────────────────────

def build_context(
    profile: dict,
    exams: list,
    topics: list,
    today: date,
    available_slots: list,
    daily_allocation: dict,
    recent_sessions: list,
    pending_anki_reviews: int,
) -> str:
    topics_by_subject: dict = {}
    for t in topics:
        subj = t.get("subject", "general")
        if subj not in topics_by_subject:
            topics_by_subject[subj] = []
        last_rev = t.get("fsrs_last_review")
        days_since = (
            (datetime.utcnow() - last_rev).days
            if isinstance(last_rev, datetime)
            else (today - last_rev.date()).days
            if isinstance(last_rev, datetime)
            else 999
        )
        topics_by_subject[subj].append({
            "name": t.get("name"),
            "mastery": t.get("mastery_level", "not_started"),
            "retrievability": round(t.get("fsrs_retrievability", 0.0), 2),
            "next_review_due": str(t.get("fsrs_next_review", "")),
            "avg_quiz_score": round(t.get("average_quiz_score", 0.0), 2),
            "error_streak": t.get("error_streak", 0),
            "days_since_review": days_since,
            "urgency": compute_urgency(
                t.get("fsrs_retrievability", 0.0),
                (date.fromisoformat(str(t.get("exam_date", today + timedelta(days=30)))) - today).days
                if t.get("exam_date") else 30,
                t.get("fsrs_difficulty", 5.0),
                t.get("exam_weight", 1.0),
                t.get("mastery_score", 0.0),
                days_since,
            ),
        })

    exam_phases = []
    for exam in exams:
        ed = exam.get("exam_date")
        if isinstance(ed, str):
            ed = date.fromisoformat(ed)
        elif isinstance(ed, datetime):
            ed = ed.date()
        days_left = (ed - today).days if ed else 999
        exam_phases.append({
            "name": exam.get("name"),
            "subject": exam.get("subject", "general"),
            "days_left": days_left,
            "phase": get_phase(ed, today) if ed else "early",
            "readiness_score": exam.get("readiness_score", 0),
            "allocated_minutes_today": daily_allocation.get(exam.get("subject", "general"), 0),
            "estimated_hours_remaining": exam.get("estimated_hours_remaining", 10),
        })

    gym_today = profile.get("gym_time", "") if today.strftime("%A").lower() in [
        d.lower() for d in (profile.get("gym_days") or [])
    ] else ""

    return f"""<student_profile>
Max studietid idag: {profile.get('max_daily_study_hours', 7)} timmar
Föredragen blocklängd: {profile.get('preferred_session_length_minutes', 50)} minuter
Paus: {profile.get('preferred_break_length_minutes', 10)} minuter
Peak-timmar: {profile.get('peak_hours_start', '09:00')}–{profile.get('peak_hours_end', '13:00')}
Träning idag: {gym_today or 'nej'}
Pendlingstid: {profile.get('commute_to_campus_minutes', 0)} minuter enkel resa
Feedbackstil: {profile.get('feedback_style', 'direct')}
Studiepreferens: {profile.get('session_structure_preference', 'focus_50')}
</student_profile>

<todays_constraints>
Datum: {today.strftime('%A %Y-%m-%d')}
Tillgängliga tidsluckor: {json.dumps(available_slots, ensure_ascii=False)}
Anki-repetitioner förfallna idag: {pending_anki_reviews} kort
</todays_constraints>

<active_exams>
{json.dumps(exam_phases, indent=2, ensure_ascii=False)}
</active_exams>

<topics_by_subject>
{json.dumps(topics_by_subject, indent=2, ensure_ascii=False)}
</topics_by_subject>

<daily_allocation>
{json.dumps(daily_allocation, indent=2, ensure_ascii=False)}
</daily_allocation>

<recent_study_history_7d>
{json.dumps(recent_sessions, indent=2, ensure_ascii=False)}
</recent_study_history_7d>"""


# ─── Self-review prompt ───────────────────────────────────────────────────────

SELF_REVIEW_PROMPT = """Du är en kvalitetsgranskar av studiescheman. Granska detta schema och returnera en korrigerad version.

KONTROLLERA OBLIGATORISKT:
1. end_time = start_time + duration_minutes för VARJE block (räkna manuellt)
2. Inga block överlappar i tid
3. Totala studietimmar överstiger inte max_daily_study_hours
4. Inga block är orimligt korta (<10 min för studieblock) eller långa (>120 min utan paus)
5. Om ett block beskriver "3 timmar" men duration_minutes=5, fixa det
6. Balansen: inte 5h på ett ämne och 5 min på ett annat utan bra anledning
7. Pausblock läggs in efter långa studiepass (>90 min sammanhängande)
8. activity_description är konsistent med duration_minutes (ett 50-min block ska inte beskrivas som "3 timmars prov")

Returnera EXKLUSIVT ett korrigerat JSON-objekt med exakt samma struktur. Inga kommentarer, ingen text utanför JSON."""


async def _self_review_schedule(client, schedule: dict, profile: dict, context: str) -> dict:
    """Ask Claude to review and fix the generated schedule for consistency and balance."""
    max_min = profile.get("max_daily_study_hours", 7) * 60
    total_min = sum(b.get("duration_minutes", 0) for b in schedule.get("blocks", []))

    review_prompt = f"""Granska och korrigera detta studieSchema:

<student_constraints>
Max studietid: {max_min} minuter
Föredragen blocklängd: {profile.get('preferred_session_length_minutes', 50)} minuter
</student_constraints>

<schedule_to_review>
{json.dumps(schedule, indent=2, ensure_ascii=False)}
</schedule_to_review>

<detected_stats>
Antal block: {len(schedule.get('blocks', []))}
Total schemalagd tid: {total_min} minuter
</detected_stats>

Returnera det korrigerade schemat som ett JSON-objekt."""

    try:
        resp = await client.messages.create(
            model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6"),
            max_tokens=4000,
            system=SELF_REVIEW_PROMPT,
            messages=[{"role": "user", "content": review_prompt}],
        )
        reviewed = _extract_json(resp.content[0].text)
        # Only accept if it has blocks and roughly same count
        orig_count = len(schedule.get("blocks", []))
        new_count = len(reviewed.get("blocks", []))
        if new_count >= max(1, orig_count - 2):
            return reviewed
    except Exception:
        pass
    return schedule  # fallback: return original if review fails


# ─── Main generation function ─────────────────────────────────────────────────

def _extract_json(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip().rstrip("`").strip()
    start = raw.find("{")
    end = raw.rfind("}") + 1
    return json.loads(raw[start:end])


def _time_to_minutes(t: str) -> int:
    """'HH:MM' → total minutes since midnight."""
    try:
        h, m = t.split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return 0


def _minutes_to_time(m: int) -> str:
    """Total minutes since midnight → 'HH:MM'."""
    m = max(0, min(m, 23 * 60 + 59))
    return f"{m // 60:02d}:{m % 60:02d}"


def _fix_block_times(schedule: dict) -> dict:
    """
    Auto-correct each block so that end_time = start_time + duration_minutes.
    If the discrepancy is large (>5 min), trust duration_minutes and rewrite end_time.
    Also rebuild block_number sequentially.
    """
    blocks = sorted(schedule.get("blocks", []), key=lambda b: b.get("start_time", "00:00"))
    for i, block in enumerate(blocks):
        block["block_number"] = i + 1
        start = _time_to_minutes(block.get("start_time", "09:00"))
        end   = _time_to_minutes(block.get("end_time",   "09:00"))
        dur   = block.get("duration_minutes", 0)

        actual_dur = end - start
        if abs(actual_dur - dur) > 5 and dur > 0:
            # Trust duration_minutes, fix end_time
            block["end_time"] = _minutes_to_time(start + dur)
        elif actual_dur > 0 and dur == 0:
            # Trust time span, fix duration_minutes
            block["duration_minutes"] = actual_dur

        # Clamp duration to sane range (5–180 min)
        block["duration_minutes"] = max(5, min(180, block.get("duration_minutes", 30)))

    schedule["blocks"] = blocks
    return schedule


def _validate_schedule(schedule: dict, profile: dict) -> list[str]:
    errors = []
    max_min = profile.get("max_daily_study_hours", 7) * 60
    total = sum(b.get("duration_minutes", 0) for b in schedule.get("blocks", []))
    if total > max_min * 1.1:
        errors.append(f"Total {total} min överstiger max {max_min} min")

    blocks = sorted(schedule.get("blocks", []), key=lambda b: b.get("start_time", "00:00"))
    for i in range(len(blocks) - 1):
        if blocks[i].get("end_time", "") > blocks[i + 1].get("start_time", "99:99"):
            errors.append(f"Block {i + 1} och {i + 2} överlappar i tid")

    # Check duration vs time span
    for b in blocks:
        start = _time_to_minutes(b.get("start_time", "09:00"))
        end   = _time_to_minutes(b.get("end_time", "09:00"))
        dur   = b.get("duration_minutes", 0)
        if end - start > 0 and abs((end - start) - dur) > 5:
            errors.append(
                f"Block '{b.get('activity_title', '?')}': duration_minutes={dur} "
                f"stämmer inte med {b.get('start_time')}–{b.get('end_time')} ({end-start} min)"
            )

    consec = 1
    for i in range(1, len(blocks)):
        if blocks[i].get("subject") == blocks[i - 1].get("subject"):
            consec += 1
            if consec > 2:
                errors.append(f"3+ block av {blocks[i]['subject']} i rad")
        else:
            consec = 1

    return errors


async def generate_daily_schedule(
    profile: dict,
    exams: list,
    topics: list,
    today: date,
    available_slots: list,
    daily_allocation: dict,
    recent_sessions: list,
    pending_anki_reviews: int = 0,
    student_feedback: Optional[str] = None,
    max_retries: int = 3,
) -> dict:
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
    context = build_context(
        profile, exams, topics, today, available_slots,
        daily_allocation, recent_sessions, pending_anki_reviews,
    )

    base_task = f"""
{context}

<task>
Generera ett komplett studieSchema för idag ({today.strftime('%A %d %B %Y')}).
Följ ALLA regler i system prompten strikt.
{f'Studentens feedback på senaste schemat: "{student_feedback}" – anpassa schemat utefter detta.' if student_feedback else ''}
Returnera EXKLUSIVT ett JSON-objekt, inget annat.
</task>"""

    last_schedule = None
    last_errors: list = []

    for attempt in range(max_retries):
        user_msg = base_task if attempt == 0 else f"""{context}

<task>
Föregående schemaförsök hade dessa valideringsfel:
{json.dumps(last_errors, ensure_ascii=False)}

Generera ett nytt, korrigerat schema som fixar exakt dessa problem.
Returnera EXKLUSIVT ett JSON-objekt.
</task>"""

        try:
            resp = await client.messages.create(
                model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6"),
                max_tokens=4000,
                system=SCHEDULER_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_msg}],
            )
            raw = resp.content[0].text
            schedule = _extract_json(raw)
            schedule = _fix_block_times(schedule)  # auto-correct timing inconsistencies
            last_schedule = schedule
            errors = _validate_schedule(schedule, profile)
            if not errors:
                # Run self-review pass before returning
                schedule = await _self_review_schedule(client, schedule, profile, context)
                schedule = _fix_block_times(schedule)  # fix any new issues from review
                return {"success": True, "schedule": schedule, "attempts": attempt + 1}
            last_errors = errors
        except Exception as e:
            last_errors = [str(e)]

    # Fallback: return last attempt with warning flag
    if last_schedule:
        return {"success": False, "schedule": last_schedule, "errors": last_errors, "attempts": max_retries}

    # Ultimate fallback: rule-based minimal schedule
    return {
        "success": False,
        "schedule": _fallback_schedule(today, exams, profile, daily_allocation),
        "errors": last_errors,
        "attempts": max_retries,
    }


def _fallback_schedule(today: date, exams: list, profile: dict, daily_allocation: dict) -> dict:
    """Minimal rule-based schedule when AI fails."""
    start_h = int(profile.get("peak_hours_start", "09:00").split(":")[0])
    block_len = profile.get("preferred_session_length_minutes", 50)
    break_len = profile.get("preferred_break_length_minutes", 10)
    blocks = []
    current_h = start_h
    current_m = 0

    for i, (subject, minutes) in enumerate(daily_allocation.items(), 1):
        s = f"{current_h:02d}:{current_m:02d}"
        total_advance = block_len + break_len
        end_h = current_h + (current_m + block_len) // 60
        end_m = (current_m + block_len) % 60
        e = f"{end_h:02d}:{end_m:02d}"
        current_m += total_advance
        current_h += current_m // 60
        current_m %= 60

        blocks.append({
            "block_number": i,
            "start_time": s,
            "end_time": e,
            "duration_minutes": block_len,
            "subject": subject,
            "topic": "Repetition",
            "subtopic": "",
            "block_type": "active_recall",
            "study_technique": "Blank page recall",
            "activity_title": f"Repetition: {subject}",
            "activity_description": (
                f"OPENER (5 min): Skriv allt du minns om {subject} utan att titta på anteckningar.\n"
                f"MAIN: Gå igenom dina anteckningar och fyll i luckor aktivt.\n"
                f"CLOSER (3 min): Skriv vad som var oklart och vad som ska repeteras imorgon.\n"
                f"PAUS: {break_len} min."
            ),
            "resources": [],
            "learning_objective": f"Befästa grundläggande begrepp inom {subject}",
            "is_spaced_repetition": False,
            "location": "home",
            "requires_screen": False,
            "difficulty": 3,
            "break_after_minutes": break_len,
        })

    return {
        "schedule_date": today.isoformat(),
        "summary": "Förenklat schema (AI tillfälligt otillgänglig). Grundläggande repetitionsblock genererade.",
        "total_study_minutes": sum(b["duration_minutes"] for b in blocks),
        "exam_readiness_update": {},
        "blocks": blocks,
        "proactive_suggestions": [{"type": "warning", "message": "AI tillfälligt otillgänglig – förenklat schema visas."}],
        "tomorrow_preview": "Fullständigt AI-schema genereras imorgon.",
    }
