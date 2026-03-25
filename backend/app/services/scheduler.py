"""
Daily scheduling engine.
Generates study blocks for a given day respecting calendar constraints,
Anki/FSRS card counts, lecture dates, and time windows.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from ..models import CalendarEvent, CardState, Lecture, StudyBlock

# ── Constants ─────────────────────────────────────────────────────────────────

WORK_START = time(8, 0)
WORK_END = time(17, 0)
LUNCH_START = time(12, 0)
LUNCH_END = time(13, 30)           # 90-min lunch
LUNCH_DURATION = 90

BREAK_PER_50_MIN = 10              # minutes
MAX_REP_MINUTES = 120              # cap daily repetition at 2 hours
MIN_STUDY_POMODORO = 270           # apply 50/10 method when study > 4.5 hours
MIN_BLOCK_DURATION = 20            # never place a block in a slot shorter than this
MIN_PRACTICE_TEST_SLOT = 45        # practice_test requires at least 45 min of free time
COMMUTE_BEFORE_LECTURE = 45        # minutes (in-person only)
COMMUTE_AFTER_FINAL = 40           # minutes (in-person only)
TRAINING_BUFFER = 30               # minutes before/after training block

# Seconds per card heuristics
SEC_PER_MATURE_CARD = 8
SEC_PER_NEW_CARD = 20

# Block durations (minutes)
ACTIVATION_DURATION = 20
MIN_REPETITION_DURATION = 15
PRE_LECTURE_DEFAULT = 105          # 1h45m
PRE_LECTURE_DIFFICULT = 180        # 3h
POST_LECTURE_DURATION = 60
READING_DURATION = 60

# Block types that are NOT study time (excluded from total_minutes / hour caps)
NON_STUDY_TYPES = {"lunch", "gym", "break"}

# All known activity block types (including AI-generated ones)
ACTIVITY_BLOCK_TYPES = {
    "timed_drill", "mistake_review", "active_recall", "case_study", "resource",
    "reading", "practice_test",
}


@dataclass
class FreeWindow:
    start: datetime
    end: datetime

    @property
    def minutes(self) -> int:
        return int((self.end - self.start).total_seconds() / 60)


@dataclass
class ScheduleInput:
    target_date: date
    calendar_events: List[CalendarEvent]
    lectures_today: List[Lecture]          # lectures ON target_date
    lectures_tomorrow: List[Lecture]       # lectures on target_date+1 (for pre-lecture)
    anki_due: int = 0
    anki_new: int = 0
    internal_due: int = 0
    internal_new: int = 0
    morning_activation: bool = False
    post_work_minutes: int = 0             # minutes to study after work + commute home
    exam_study_config: Optional[dict] = None  # AI-generated study strategy for nearest exam


@dataclass
class BlockSpec:
    block_type: str
    duration_minutes: int
    lecture_id: Optional[int] = None
    payload: dict = field(default_factory=dict)
    compression_level: int = 0


class DailyScheduler:
    def __init__(self, work_start: time = WORK_START, work_end: time = WORK_END):
        self.work_start = work_start
        self.work_end = work_end

    def generate(self, inp: ScheduleInput) -> List[StudyBlock]:
        """Generate and return a list of StudyBlock objects (not yet saved to DB)."""
        target_dt = inp.target_date

        # Step 1: Compute free windows
        windows = self._free_windows(target_dt, inp.calendar_events)

        # Add post-work study window if requested
        if inp.post_work_minutes > 0:
            work_events = sorted(
                [e for e in inp.calendar_events
                 if e.event_type == "work" and e.start_dt.date() == target_dt],
                key=lambda e: e.end_dt,
            )
            if work_events:
                last_work = work_events[-1]
                pw_start = last_work.end_dt + timedelta(minutes=COMMUTE_AFTER_FINAL)
                pw_end = pw_start + timedelta(minutes=inp.post_work_minutes)
                windows.append(FreeWindow(pw_start, pw_end))
                windows.sort(key=lambda w: w.start)

        # Step 2: Total available minutes (study time only, excluding lunch)
        total_available = sum(w.minutes for w in windows)

        # Step 3: Determine card counts (prefer Anki if available)
        due_cards = max(inp.anki_due, inp.internal_due)
        new_cards = max(inp.anki_new, inp.internal_new)

        cfg = inp.exam_study_config or {}
        study_type = cfg.get("study_type", "flashcards")
        no_flashcards = cfg.get("no_flashcards", False)
        practice_test_minutes = int(cfg.get("practice_test_minutes", 90))
        daily_practice_tests = int(cfg.get("daily_practice_tests", 1))
        activities = cfg.get("activities", [])
        daily_hours_min = float(cfg.get("daily_hours_min", 0))
        min_study_minutes = int(daily_hours_min * 60)

        # Step 4: Build block specs in priority order
        specs: List[BlockSpec] = []

        if inp.morning_activation:
            specs.append(BlockSpec("activation", ACTIVATION_DURATION))

        # Daily repetition — capped at MAX_REP_MINUTES, skip if no flashcards or
        # if the exam's activity list already includes a daily_repetition block
        # (to avoid duplicates when using AI-generated study configs).
        activities_have_repetition = any(
            a.get("block_type") == "daily_repetition" for a in activities
        )
        if not no_flashcards and not activities_have_repetition:
            has_cards = due_cards > 0 or new_cards > 0
            rep_minutes = self._repetition_time(due_cards, new_cards)
            rep_minutes = min(rep_minutes, MAX_REP_MINUTES)
            rep_minutes = max(rep_minutes, 20 if not has_cards else MIN_REPETITION_DURATION)
            if has_cards:
                rep_desc = (
                    "Gå igenom dagens förfallna flashcards i appen. "
                    "Prioritera kort med betyget 'Igen' – förklara varje svar högt för dig själv "
                    "innan du vänder kortet."
                )
            else:
                rep_desc = (
                    "Gå igenom dina studieanteckningar och repetera nyckelbegreppen aktivt. "
                    "Täck texten, försök minnas allt du kan, och kontrollera sedan. "
                    "Skapa gärna flashcards i appen för ännu effektivare repetition nästa gång."
                )
            specs.append(BlockSpec(
                "daily_repetition", rep_minutes,
                payload={"description": rep_desc},
            ))

        # Practice test blocks if exam config says practice_tests
        if study_type in ("practice_tests", "mixed") and daily_practice_tests > 0:
            for _ in range(daily_practice_tests):
                specs.append(BlockSpec("practice_test", practice_test_minutes, payload={
                    "description": "Gör ett fullständigt övningsprov under tidsbegränsning. Mobiltelefon av, inga avbrott – simulera verkliga tentaförhållanden.",
                }))

        # Pre-lecture blocks for tomorrow's lectures (placed today)
        for lecture in inp.lectures_tomorrow:
            dur = PRE_LECTURE_DIFFICULT if lecture.is_difficult else PRE_LECTURE_DEFAULT
            specs.append(BlockSpec("pre_lecture", dur, lecture_id=lecture.id))

        # Post-lecture blocks for today's lectures
        for lecture in inp.lectures_today:
            specs.append(BlockSpec("post_lecture", POST_LECTURE_DURATION, lecture_id=lecture.id))

        # Activity blocks: rotate through AI-generated activities if available,
        # otherwise fall back to a generic reading block.
        # Use the ordinal of target_date to get a stable rotation index.
        if activities:
            day_idx = inp.target_date.toordinal()
            activity_count = len(activities)
            slots_used = 0

            # Always add at least one activity block (replaces "reading")
            first = activities[day_idx % activity_count]
            specs.append(BlockSpec(
                first["block_type"],
                first.get("duration_minutes", READING_DURATION),
                payload={
                    "description": first.get("description", ""),
                    "label": first.get("label", ""),
                },
            ))
            slots_used += 1

            # Keep adding more activities until we reach the daily minimum,
            # rotating so no two consecutive blocks are the same type.
            # Guard: never add more than all distinct activities to avoid infinite repetition.
            while slots_used < activity_count and min_study_minutes > 0:
                current_study = sum(s.duration_minutes for s in specs)
                if current_study >= min_study_minutes:
                    break
                nxt = activities[(day_idx + slots_used) % activity_count]
                # Don't repeat practice_test blocks already added via daily_practice_tests
                if nxt["block_type"] == "practice_test" and daily_practice_tests > 0:
                    slots_used += 1
                    continue
                specs.append(BlockSpec(
                    nxt["block_type"],
                    nxt.get("duration_minutes", READING_DURATION),
                    payload={
                        "description": nxt.get("description", ""),
                        "label": nxt.get("label", ""),
                    },
                ))
                slots_used += 1
        elif study_type not in ("practice_tests",):
            # Fallback: plain reading block when no AI activities defined
            specs.append(BlockSpec("reading", READING_DURATION))

        # Step 5: Compression if needed
        total_needed = sum(s.duration_minutes for s in specs)
        if total_needed > total_available:
            specs = self._compress(specs, total_available)

        # Step 6: Determine if 50/10 pomodoro method applies (>4.5 hours of study)
        total_study = sum(s.duration_minutes for s in specs)
        apply_pomodoro = total_study > MIN_STUDY_POMODORO

        # Step 7: Assign times from free windows
        blocks = self._assign_times(specs, windows, target_dt, apply_pomodoro)

        # Step 8: Add explicit lunch block (always shown)
        day_start = datetime.combine(target_dt, time(0, 0))
        blocks.append(StudyBlock(
            user_id=1,
            lecture_id=None,
            block_type="lunch",
            scheduled_date=day_start,
            start_time=_dt(target_dt, LUNCH_START),
            end_time=_dt(target_dt, LUNCH_END),
            duration_minutes=LUNCH_DURATION,
            status="planned",
            compression_level=0,
            payload={},
        ))

        # Step 9: Add explicit gym blocks from training calendar events
        for evt in inp.calendar_events:
            if evt.event_type == "training" and evt.start_dt.date() == target_dt:
                dur = int((evt.end_dt - evt.start_dt).total_seconds() / 60)
                blocks.append(StudyBlock(
                    user_id=1,
                    lecture_id=None,
                    block_type="gym",
                    scheduled_date=day_start,
                    start_time=evt.start_dt,
                    end_time=evt.end_dt,
                    duration_minutes=dur,
                    status="planned",
                    compression_level=0,
                    payload={},
                ))

        # Sort by start time
        blocks.sort(key=lambda b: b.start_time or datetime.min)

        return blocks

    # ── Free window computation ────────────────────────────────────────────────

    def _free_windows(
        self,
        target_date: date,
        events: List[CalendarEvent],
    ) -> List[FreeWindow]:
        """
        Return sorted free time windows within the work day,
        subtracting calendar events + required buffers.
        Lunch (90 min) is always blocked.
        """
        day_start = _dt(target_date, self.work_start)
        day_end = _dt(target_date, self.work_end)
        lunch_s = _dt(target_date, LUNCH_START)
        lunch_e = _dt(target_date, LUNCH_END)

        # Blocked intervals: start with lunch (90 min)
        blocked: List[Tuple[datetime, datetime]] = [(lunch_s, lunch_e)]

        for evt in events:
            # Only events on target_date
            if evt.start_dt.date() != target_date:
                continue

            es = max(evt.start_dt, day_start)
            ee = min(evt.end_dt, day_end)
            if ee <= es:
                continue

            if evt.event_type == "training":
                es = max(day_start, evt.start_dt - timedelta(minutes=TRAINING_BUFFER))
                ee = min(day_end, evt.end_dt + timedelta(minutes=TRAINING_BUFFER))
                blocked.append((es, ee))

            elif evt.event_type == "lecture" and evt.is_in_person:
                # Commute before first in-person lecture
                commute_start = max(day_start, evt.start_dt - timedelta(minutes=COMMUTE_BEFORE_LECTURE))
                blocked.append((commute_start, evt.start_dt))
                # Block the lecture itself
                blocked.append((evt.start_dt, evt.end_dt))

            elif evt.event_type == "work":
                # Work: 45-min commute before + block work + 40-min commute home
                commute_start = max(day_start, evt.start_dt - timedelta(minutes=COMMUTE_BEFORE_LECTURE))
                commute_end = min(day_end, evt.end_dt + timedelta(minutes=COMMUTE_AFTER_FINAL))
                blocked.append((commute_start, commute_end))

            else:
                # Block the event itself (vfu, other, lecture online)
                blocked.append((es, ee))

        # Check if last lecture of day is in-person → add post-commute
        in_person_lectures = sorted(
            [e for e in events if e.event_type == "lecture" and e.is_in_person and e.start_dt.date() == target_date],
            key=lambda e: e.end_dt,
        )
        if in_person_lectures:
            last = in_person_lectures[-1]
            commute_end = min(day_end, last.end_dt + timedelta(minutes=COMMUTE_AFTER_FINAL))
            blocked.append((last.end_dt, commute_end))

        # Merge and invert blocked intervals to get free windows
        return _invert_intervals(day_start, day_end, blocked)

    # ── Compression ────────────────────────────────────────────────────────────

    def _compress(self, specs: List[BlockSpec], available: int) -> List[BlockSpec]:
        """
        Compress blocks to fit within available minutes.
        Order: reading → post_lecture → pre_lecture. Never compress daily_repetition.
        """
        result = [s for s in specs]
        needed = sum(s.duration_minutes for s in result)
        deficit = needed - available

        compressible_order = [
            "reading", "resource", "active_recall", "mistake_review",
            "timed_drill", "case_study", "post_lecture", "pre_lecture", "practice_test",
        ]

        _min_dur = {"practice_test": MIN_PRACTICE_TEST_SLOT}

        for block_type in compressible_order:
            if deficit <= 0:
                break
            for spec in result:
                if spec.block_type == block_type and deficit > 0:
                    floor = _min_dur.get(spec.block_type, MIN_BLOCK_DURATION)
                    max_reduction = spec.duration_minutes - floor
                    if max_reduction <= 0:
                        continue
                    reduction = min(deficit, max_reduction)
                    spec.duration_minutes -= reduction
                    spec.compression_level += 1
                    deficit -= reduction

        # If still over, remove the most flexible activity blocks
        if deficit > 0:
            result = [s for s in result if s.block_type not in ACTIVITY_BLOCK_TYPES]

        return result

    # ── Time assignment ────────────────────────────────────────────────────────

    def _assign_times(
        self,
        specs: List[BlockSpec],
        windows: List[FreeWindow],
        target_date: date,
        apply_pomodoro: bool = False,
    ) -> List[StudyBlock]:
        """
        Pack blocks into free windows.
        Creates a separate StudyBlock for each window segment (blocks never span lunch).
        In pomodoro mode (apply_pomodoro=True), inserts explicit 10-min break blocks
        after every 50 continuous minutes of study.
        """
        blocks: List[StudyBlock] = []
        if not windows:
            return blocks

        day_start = datetime.combine(target_date, time(0, 0))
        window_idx = 0
        cursor = windows[0].start
        minutes_since_break = 0

        def advance():
            nonlocal window_idx, cursor, minutes_since_break
            window_idx += 1
            if window_idx < len(windows):
                cursor = windows[window_idx].start
                minutes_since_break = 0

        for spec in specs:
            remaining = spec.duration_minutes
            if remaining <= 0:
                continue

            while remaining > 0 and window_idx < len(windows):
                window = windows[window_idx]

                if cursor < window.start:
                    cursor = window.start
                    minutes_since_break = 0

                if cursor >= window.end:
                    advance()
                    continue

                # Insert explicit break if in pomodoro mode and 50 min studied
                if apply_pomodoro and minutes_since_break >= 50:
                    break_end = cursor + timedelta(minutes=BREAK_PER_50_MIN)
                    if break_end <= window.end:
                        blocks.append(StudyBlock(
                            user_id=1,
                            lecture_id=None,
                            block_type="break",
                            scheduled_date=day_start,
                            start_time=cursor,
                            end_time=break_end,
                            duration_minutes=BREAK_PER_50_MIN,
                            status="planned",
                            compression_level=0,
                            payload={},
                        ))
                        cursor = break_end
                        minutes_since_break = 0
                        if cursor >= window.end:
                            advance()
                    else:
                        # Break would overflow → move to next window
                        advance()
                    continue

                slot = int((window.end - cursor).total_seconds() / 60)
                if slot <= 0:
                    advance()
                    continue

                # Skip this window if it's too small to start this block type
                min_slot = MIN_PRACTICE_TEST_SLOT if spec.block_type == "practice_test" else MIN_BLOCK_DURATION
                if slot < min_slot:
                    advance()
                    continue

                # In pomodoro mode, cap chunk so we hit break at exactly 50 min
                if apply_pomodoro:
                    until_break = 50 - minutes_since_break
                    chunk = min(remaining, slot, until_break)
                else:
                    chunk = min(remaining, slot)

                if chunk <= 0:
                    advance()
                    continue

                start_time = cursor
                cursor += timedelta(minutes=chunk)
                minutes_since_break += chunk
                remaining -= chunk

                blocks.append(StudyBlock(
                    user_id=1,
                    lecture_id=spec.lecture_id,
                    block_type=spec.block_type,
                    scheduled_date=day_start,
                    start_time=start_time,
                    end_time=cursor,
                    duration_minutes=chunk,
                    status="planned",
                    compression_level=spec.compression_level,
                    payload=spec.payload,
                ))

                if cursor >= window.end and remaining > 0:
                    advance()

        return blocks

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _repetition_time(self, due: int, new: int) -> int:
        """Estimate review session length in minutes."""
        seconds = due * SEC_PER_MATURE_CARD + new * SEC_PER_NEW_CARD
        return max(15, round(seconds / 60))


# ── Module-level helpers ───────────────────────────────────────────────────────

def _dt(d: date, t: time) -> datetime:
    return datetime.combine(d, t)


def _invert_intervals(
    day_start: datetime,
    day_end: datetime,
    blocked: List[Tuple[datetime, datetime]],
) -> List[FreeWindow]:
    """Return free windows by inverting blocked intervals within [day_start, day_end]."""
    if not blocked:
        return [FreeWindow(day_start, day_end)]

    # Merge overlapping blocked intervals
    sorted_blocked = sorted(blocked, key=lambda x: x[0])
    merged: List[Tuple[datetime, datetime]] = []
    for start, end in sorted_blocked:
        start = max(start, day_start)
        end = min(end, day_end)
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))

    # Invert
    free: List[FreeWindow] = []
    cursor = day_start
    for bs, be in merged:
        if cursor < bs:
            free.append(FreeWindow(cursor, bs))
        cursor = max(cursor, be)
    if cursor < day_end:
        free.append(FreeWindow(cursor, day_end))

    return [w for w in free if w.minutes >= 5]  # filter out tiny slivers
