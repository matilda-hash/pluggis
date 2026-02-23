"""
Anki sync utilities: weakness metrics computation.
Import/export logic lives in the anki router.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

if TYPE_CHECKING:
    from .anki_connect import AnkiConnectClient


def sync_weakness_metrics(db: Session, user_id: int, anki_client: "AnkiConnectClient"):
    """
    Compute WeaknessMetrics for each known tag based on FSRS review history.
    Also incorporates Anki lapse data if Anki is available.
    Falls back to internal-only data gracefully.
    """
    from ..models import Card, CardState, Review, TagDictionary, WeaknessMetrics

    cutoff = datetime.utcnow() - timedelta(days=30)

    # Get all unique tags from cards belonging to user's decks
    all_tags: set[str] = set()
    cards = (
        db.query(Card)
        .join(Card.deck)
        .filter(Card.deck.has(user_id=user_id))
        .all()
    )
    for card in cards:
        for tag in (card.tags or []):
            if isinstance(tag, str) and tag.startswith("#"):
                all_tags.add(tag)

    # Compute metrics per tag from internal reviews
    anki_lapses = {}
    if anki_client and anki_client.is_available():
        result = anki_client.get_lapses_by_tags(list(all_tags))
        if result.ok:
            anki_lapses = result.data or {}

    for tag in all_tags:
        # Find cards with this tag
        tagged_card_ids = [c.id for c in cards if tag in (c.tags or [])]
        if not tagged_card_ids:
            continue

        # Reviews in last 30 days for these cards
        recent_reviews = (
            db.query(Review)
            .filter(
                Review.user_id == user_id,
                Review.card_id.in_(tagged_card_ids),
                Review.reviewed_at >= cutoff,
            )
            .all()
        )

        total = len(recent_reviews)
        lapses = sum(1 for r in recent_reviews if r.rating == 1)  # Again = lapse
        lapse_rate = lapses / total if total > 0 else 0.0

        # Avg stability of tagged cards
        states = (
            db.query(CardState)
            .filter(
                CardState.user_id == user_id,
                CardState.card_id.in_(tagged_card_ids),
            )
            .all()
        )
        avg_stability = sum(s.stability for s in states) / len(states) if states else 0.0

        # Add Anki lapses if available
        anki_lapse_count = anki_lapses.get(tag, 0)
        total_lapses = lapses + anki_lapse_count

        # Upsert WeaknessMetrics
        existing = (
            db.query(WeaknessMetrics)
            .filter(WeaknessMetrics.user_id == user_id, WeaknessMetrics.tag == tag)
            .first()
        )
        if existing:
            existing.lapse_count_30d = total_lapses
            existing.total_reviews_30d = total
            existing.lapse_rate = lapse_rate
            existing.avg_stability = avg_stability
            existing.computed_at = datetime.utcnow()
        else:
            metric = WeaknessMetrics(
                user_id=user_id,
                tag=tag,
                lapse_count_30d=total_lapses,
                total_reviews_30d=total,
                lapse_rate=lapse_rate,
                avg_stability=avg_stability,
            )
            db.add(metric)

    db.commit()
