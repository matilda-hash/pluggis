"""
FSRS-4.5 Spaced Repetition Algorithm
Based on: https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm

Key concepts:
- Stability (S): Days until 90% chance of recall
- Difficulty (D): How hard the card is [1-10]
- Retrievability (R): Current probability of recall
- State: New → Learning → Review ↔ Relearning
"""

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import IntEnum
from typing import Optional

# Power forgetting curve constants
DECAY = -0.5
FACTOR = 19 / 81  # R(t=S) ≈ 0.9 with these values

# Default FSRS-4.5 parameters (trained on large dataset)
DEFAULT_W = [
    0.4072, 1.1829, 3.1262, 15.4722,  # w0-w3: Initial stability per rating (Again/Hard/Good/Easy)
    7.2102,  # w4:  Initial difficulty base
    0.5316,  # w5:  Initial difficulty rating factor
    1.0651,  # w6:  Difficulty change per rating
    0.0589,  # w7:  Mean reversion weight
    1.4783,  # w8:  Recall stability base exponent
    0.1174,  # w9:  Recall stability decay
    1.0187,  # w10: Recall stability retrievability factor
    1.9813,  # w11: Forget stability base
    0.0953,  # w12: Forget stability difficulty factor
    0.2975,  # w13: Forget stability stability factor
    2.2042,  # w14: Forget stability retrievability factor
    0.2407,  # w15: Hard penalty multiplier
    2.9466,  # w16: Easy bonus multiplier
    0.5034,  # w17: (reserved)
    0.6567,  # w18: (reserved)
]


class Rating(IntEnum):
    Again = 1
    Hard = 2
    Good = 3
    Easy = 4


class State(IntEnum):
    New = 0
    Learning = 1
    Review = 2
    Relearning = 3


@dataclass
class FSRSCard:
    stability: float = 0.0
    difficulty: float = 0.0
    due: Optional[datetime] = None
    last_review: Optional[datetime] = None
    reps: int = 0
    lapses: int = 0
    state: State = State.New


@dataclass
class SchedulingResult:
    card: FSRSCard
    review_log: dict = field(default_factory=dict)


class FSRS:
    def __init__(self, w: list = None, requested_retention: float = 0.9):
        self.w = w or DEFAULT_W
        self.requested_retention = requested_retention

    # ── Core formula implementations ──────────────────────────────────────────

    def _init_stability(self, rating: Rating) -> float:
        """Initial stability after the very first review."""
        return self.w[rating - 1]

    def _init_difficulty(self, rating: Rating) -> float:
        """Initial difficulty after the very first review."""
        d = self.w[4] - math.exp(self.w[5] * (rating - 1)) + 1
        return min(10.0, max(1.0, d))

    def _next_difficulty(self, difficulty: float, rating: Rating) -> float:
        """Difficulty update with mean reversion toward the initial value."""
        next_d = difficulty - self.w[6] * (rating - 3)
        reverted = self.w[7] * self.w[4] + (1 - self.w[7]) * next_d
        return min(10.0, max(1.0, reverted))

    def _retrievability(self, elapsed_days: int, stability: float) -> float:
        """Probability of successful recall after elapsed_days."""
        if stability <= 0:
            return 0.0
        return math.pow(1 + FACTOR * elapsed_days / stability, DECAY)

    def _next_interval(self, stability: float) -> int:
        """Optimal interval (days) for the requested retention target."""
        interval = stability / FACTOR * (math.pow(self.requested_retention, 1 / DECAY) - 1)
        return max(1, round(interval))

    def _next_recall_stability(
        self, difficulty: float, stability: float, retrievability: float, rating: Rating
    ) -> float:
        """Stability after a successful recall."""
        hard_penalty = self.w[15] if rating == Rating.Hard else 1.0
        easy_bonus = self.w[16] if rating == Rating.Easy else 1.0
        return stability * (
            math.exp(self.w[8])
            * (11 - difficulty)
            * math.pow(stability, -self.w[9])
            * (math.exp(self.w[10] * (1 - retrievability)) - 1)
            * hard_penalty
            * easy_bonus
            + 1
        )

    def _next_forget_stability(
        self, difficulty: float, stability: float, retrievability: float
    ) -> float:
        """Stability after forgetting (Again rating on a Review card)."""
        return (
            self.w[11]
            * math.pow(difficulty, -self.w[12])
            * (math.pow(stability + 1, self.w[13]) - 1)
            * math.exp(self.w[14] * (1 - retrievability))
        )

    # ── Main scheduling entry point ───────────────────────────────────────────

    def schedule(
        self, card: FSRSCard, rating: Rating, now: Optional[datetime] = None
    ) -> SchedulingResult:
        """Apply a review rating and return the updated card + log entry."""
        if now is None:
            now = datetime.utcnow()

        elapsed_days = 0
        scheduled_days = 0

        if card.last_review and card.state != State.New:
            elapsed_days = max(0, (now - card.last_review).days)
        if card.last_review and card.due:
            scheduled_days = max(0, (card.due - card.last_review).days)

        retrievability = 0.0
        if card.stability > 0 and elapsed_days > 0:
            retrievability = self._retrievability(elapsed_days, card.stability)

        # Carry over values by default; state machine updates them
        new_stability = card.stability
        new_difficulty = card.difficulty
        new_state = card.state
        new_lapses = card.lapses
        new_due = now

        if card.state == State.New:
            new_stability = self._init_stability(rating)
            new_difficulty = self._init_difficulty(rating)

            if rating == Rating.Again:
                new_state = State.Learning
                new_due = now + timedelta(minutes=1)
            elif rating == Rating.Hard:
                new_state = State.Learning
                new_due = now + timedelta(minutes=5)
            elif rating == Rating.Good:
                new_state = State.Review
                new_due = now + timedelta(days=self._next_interval(new_stability))
            elif rating == Rating.Easy:
                # Apply easy bonus immediately
                new_stability = self._next_recall_stability(
                    new_difficulty, new_stability, 1.0, rating
                )
                new_state = State.Review
                new_due = now + timedelta(days=self._next_interval(new_stability))

        elif card.state == State.Learning:
            if rating == Rating.Again:
                new_due = now + timedelta(minutes=5)
            elif rating == Rating.Hard:
                new_due = now + timedelta(minutes=10)
            elif rating == Rating.Good:
                new_stability = self._init_stability(Rating.Good)
                new_difficulty = self._init_difficulty(Rating.Good)
                new_state = State.Review
                new_due = now + timedelta(days=self._next_interval(new_stability))
            elif rating == Rating.Easy:
                new_stability = self._init_stability(Rating.Easy)
                new_difficulty = self._init_difficulty(Rating.Easy)
                new_state = State.Review
                new_due = now + timedelta(days=self._next_interval(new_stability))

        elif card.state == State.Review:
            if rating == Rating.Again:
                new_lapses += 1
                new_stability = self._next_forget_stability(
                    card.difficulty, card.stability, retrievability
                )
                new_difficulty = self._next_difficulty(card.difficulty, rating)
                new_state = State.Relearning
                new_due = now + timedelta(minutes=10)
            else:
                new_stability = self._next_recall_stability(
                    card.difficulty, card.stability, retrievability, rating
                )
                new_difficulty = self._next_difficulty(card.difficulty, rating)
                new_state = State.Review
                new_due = now + timedelta(days=self._next_interval(new_stability))

        elif card.state == State.Relearning:
            if rating == Rating.Again:
                new_due = now + timedelta(minutes=5)
            elif rating == Rating.Hard:
                new_due = now + timedelta(minutes=10)
            else:
                new_stability = self._next_recall_stability(
                    card.difficulty, card.stability, retrievability, rating
                )
                new_difficulty = self._next_difficulty(card.difficulty, rating)
                new_state = State.Review
                new_due = now + timedelta(days=max(1, self._next_interval(new_stability)))

        new_card = FSRSCard(
            stability=new_stability,
            difficulty=new_difficulty,
            due=new_due,
            last_review=now,
            reps=card.reps + 1,
            lapses=new_lapses,
            state=new_state,
        )

        review_log = {
            "state_before": int(card.state),
            "stability_before": card.stability,
            "difficulty_before": card.difficulty,
            "stability_after": new_stability,
            "difficulty_after": new_difficulty,
            "scheduled_days": scheduled_days,
            "elapsed_days": elapsed_days,
        }

        return SchedulingResult(card=new_card, review_log=review_log)
