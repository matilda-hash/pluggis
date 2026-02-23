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
LUNCH_END = time(13, 0)

BREAK_PER_50_MIN = 10          # minutes
COMMUTE_BEFORE_LECTURE = 45    # minutes (in-person only)
COMMUTE_AFTER_FINAL = 40       # minutes (in-person only)
TRAINING_BUFFER = 30           # minutes before/after training block

# Seconds per card heuristics
SEC_PER_MATURE_CARD = 8
SEC_PER_NEW_CARD = 20

# Block durations (minutes)
ACTIVATION_DURATION = 20
MIN_REPETITION_DURATION = 15
PRE_LECTURE_DEFAULT = 105      # 1h45m
PRE_LECTURE_DIFFICULT = 180    # 3h
POST_LECTURE_DURATION = 60
READING_DURATION = 60


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

        # Step 2: Total available minutes
        total_available = sum(w.minutes for w in windows)

        # Step 3: Determine card counts (prefer Anki if available)
        due_cards = max(inp.anki_due, inp.internal_due)
        new_cards = max(inp.anki_new, inp.internal_new)

        # Step 4: Build block specs in priority order
        specs: List[BlockSpec] = []

        if inp.morning_activation:
            specs.append(BlockSpec("activation", ACTIVATION_DURATION))

        # Daily repetition — never skip, may be split
        rep_minutes = self._repetition_time(due_cards, new_cards)
        rep_minutes = max(rep_minutes, MIN_REPETITION_DURATION)
        specs.append(BlockSpec("daily_repetition", rep_minutes))

        # Pre-lecture blocks for tomorrow's lectures (placed today)
        for lecture in inp.lectures_tomorrow:
            dur = PRE_LECTURE_DIFFICULT if lecture.is_difficult else PRE_LECTURE_DEFAULT
            specs.append(BlockSpec("pre_lecture", dur, lecture_id=lecture.id))

        # Post-lecture blocks for today's lectures
        for lecture in inp.lectures_today:
            specs.append(BlockSpec("post_lecture", POST_LECTURE_DURATION, lecture_id=lecture.id))

        # Reading block (flexible, compressible)
        specs.append(BlockSpec("reading", READING_DURATION))

        # Step 5: Compression if needed
        total_needed = sum(s.duration_minutes for s in specs)
        if total_needed > total_available:
            specs = self._compress(specs, total_available)

        # Step 6: Assign times from free windows
        blocks = self._assign_times(specs, windows, target_dt)

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
        """
        day_start = _dt(target_date, self.work_start)
        day_end = _dt(target_date, self.work_end)
        lunch_s = _dt(target_date, LUNCH_START)
        lunch_e = _dt(target_date, LUNCH_END)

        # Blocked intervals: start with lunch
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
                # Work: 45-min commute before + block work + 40-min commute home (within study window)
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

        compressible_order = ["reading", "post_lecture", "pre_lecture"]

        for block_type in compressible_order:
            if deficit <= 0:
                break
            for spec in result:
                if spec.block_type == block_type and deficit > 0:
                    reduction = min(deficit, spec.duration_minutes // 2)
                    spec.duration_minutes -= reduction
                    spec.compression_level += 1
                    deficit -= reduction

        # If still over, remove reading entirely
        if deficit > 0:
            result = [s for s in result if s.block_type != "reading"]

        return result

    # ── Time assignment ────────────────────────────────────────────────────────

    def _assign_times(
        self,
        specs: List[BlockSpec],
        windows: List[FreeWindow],
        target_date: date,
    ) -> List[StudyBlock]:
        """Pack blocks into free windows, inserting 10-min breaks every 50 min."""
        blocks: List[StudyBlock] = []
        window_idx = 0
        cursor: Optional[datetime] = windows[0].start if windows else None
        minutes_in_window = 0  # track continuous study for break insertion

        for spec in specs:
            if spec.duration_minutes <= 0:
                continue

            remaining = spec.duration_minutes
            start_time: Optional[datetime] = None
            end_time: Optional[datetime] = None

            while remaining > 0 and window_idx < len(windows):
                window = windows[window_idx]
                if cursor is None or cursor < window.start:
                    cursor = window.start
                    minutes_in_window = 0

                if cursor >= window.end:
                    window_idx += 1
                    if window_idx < len(windows):
                        cursor = windows[window_idx].start
                        minutes_in_window = 0
                    continue

                # Insert break if needed
                if minutes_in_window >= 50:
                    cursor += timedelta(minutes=BREAK_PER_50_MIN)
                    minutes_in_window = 0
                    if cursor >= window.end:
                        window_idx += 1
                        if window_idx < len(windows):
                            cursor = windows[window_idx].start
                            minutes_in_window = 0
                        continue

                slot = int((window.end - cursor).total_seconds() / 60)
                if slot <= 0:
                    window_idx += 1
                    continue

                chunk = min(remaining, slot)
                if start_time is None:
                    start_time = cursor
                cursor += timedelta(minutes=chunk)
                end_time = cursor
                minutes_in_window += chunk
                remaining -= chunk

            block = StudyBlock(
                user_id=1,
                lecture_id=spec.lecture_id,
                block_type=spec.block_type,
                scheduled_date=datetime.combine(target_date, time(0, 0)),
                start_time=start_time,
                end_time=end_time,
                duration_minutes=spec.duration_minutes,
                status="planned",
                compression_level=spec.compression_level,
                payload=spec.payload,
            )
            blocks.append(block)

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
