from datetime import datetime, date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user, get_optional_user
from ..database import get_db
from ..models import Card, CardState, Deck, Review, User
from ..schemas import DeckCreate, DeckUpdate, DeckOut, DeckStats
from ..services.fsrs import State

router = APIRouter(prefix="/decks", tags=["decks"])


def compute_deck_stats(deck_id: int, db: Session, nearest_exam=None, user_id: int = 1) -> DeckStats:
    now = datetime.utcnow()

    total = db.query(Card).filter(Card.deck_id == deck_id, Card.is_suspended == False).count()

    subq = db.query(CardState.card_id)
    new_cards = (
        db.query(Card)
        .filter(Card.deck_id == deck_id, Card.is_suspended == False, ~Card.id.in_(subq))
        .count()
    )

    due_today = (
        db.query(CardState)
        .join(Card)
        .filter(Card.deck_id == deck_id, Card.is_suspended == False, CardState.due <= now)
        .count()
    )

    learning = (
        db.query(CardState).join(Card)
        .filter(Card.deck_id == deck_id, CardState.state == int(State.Learning)).count()
    )
    review_count = (
        db.query(CardState).join(Card)
        .filter(Card.deck_id == deck_id, CardState.state == int(State.Review)).count()
    )
    mastered = (
        db.query(CardState).join(Card)
        .filter(Card.deck_id == deck_id, CardState.state == int(State.Review), CardState.stability >= 21)
        .count()
    )

    mastery_rate = mastered / total if total > 0 else 0.0

    # ── Recent forget rate (last 7 days) ──────────────────────────────────────
    week_ago = now - timedelta(days=7)
    recent_reviews = (
        db.query(Review).join(Card)
        .filter(Card.deck_id == deck_id, Review.user_id == user_id, Review.reviewed_at >= week_ago)
        .all()
    )
    recent_forget_rate = 0.0
    if recent_reviews:
        recent_forget_rate = sum(1 for r in recent_reviews if r.rating == 1) / len(recent_reviews)

    # ── Exam relevance ────────────────────────────────────────────────────────
    exam_priority = 0.0
    if nearest_exam:
        from ..routers.exams import compute_relevance
        deck = db.query(Deck).filter(Deck.id == deck_id).first()
        if deck:
            exam_priority = compute_relevance(nearest_exam.name, deck.name)

    # ── Status label ─────────────────────────────────────────────────────────
    if mastery_rate >= 0.90:
        status = "mastered"
    elif mastery_rate >= 0.50 or (recent_reviews and recent_forget_rate < 0.20):
        status = "maintaining"
    elif review_count + learning > 0:
        status = "in_progress"
    else:
        status = "new"

    return DeckStats(
        total_cards=total,
        new_cards=new_cards,
        due_today=due_today + new_cards,
        learning=learning,
        review=review_count,
        mastery_rate=mastery_rate,
        status=status,
        recent_forget_rate=recent_forget_rate,
        exam_priority=exam_priority,
    )


@router.get("/public", response_model=List[DeckOut])
def list_public_decks(db: Session = Depends(get_db)):
    """List all public decks — no auth required."""
    decks = db.query(Deck).filter(Deck.is_public == True, Deck.is_active == True).all()
    result = []
    for deck in decks:
        out = DeckOut.model_validate(deck)
        out.stats = compute_deck_stats(deck.id, db, user_id=deck.user_id)
        result.append(out)
    return result


@router.post("/{deck_id}/copy", response_model=DeckOut)
def copy_deck(
    deck_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Copy a public deck (and its cards) to the current user's account."""
    source = db.query(Deck).filter(Deck.id == deck_id, Deck.is_public == True).first()
    if not source:
        raise HTTPException(status_code=404, detail="Public deck not found")

    new_deck = Deck(
        user_id=current_user.id,
        name=f"{source.name} (kopia)",
        description=source.description,
        color=source.color,
        source_type=source.source_type,
        source_filename=source.source_filename,
    )
    db.add(new_deck)
    db.flush()

    for card in source.cards:
        from ..models import CardState as CS
        new_card = Card(
            deck_id=new_deck.id,
            card_type=card.card_type,
            front=card.front,
            back=card.back,
            cloze_text=card.cloze_text,
            tags=card.tags or [],
        )
        db.add(new_card)
        db.flush()
        db.add(CS(card_id=new_card.id, user_id=current_user.id, state=0))

    db.commit()
    db.refresh(new_deck)
    out = DeckOut.model_validate(new_deck)
    out.stats = compute_deck_stats(new_deck.id, db, user_id=current_user.id)
    return out


@router.get("/", response_model=List[DeckOut])
def list_decks(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from ..routers.exams import get_nearest_exam
    nearest_exam = get_nearest_exam(db, current_user.id)
    decks = db.query(Deck).filter(Deck.user_id == current_user.id, Deck.is_active == True).all()
    result = []
    for deck in decks:
        out = DeckOut.model_validate(deck)
        out.stats = compute_deck_stats(deck.id, db, nearest_exam, user_id=current_user.id)
        result.append(out)
    result.sort(key=lambda d: (-(d.stats.exam_priority if d.stats else 0), -(d.stats.due_today if d.stats else 0)))
    return result


@router.post("/", response_model=DeckOut)
def create_deck(
    data: DeckCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deck = Deck(user_id=current_user.id, **data.model_dump())
    db.add(deck)
    db.commit()
    db.refresh(deck)
    out = DeckOut.model_validate(deck)
    out.stats = compute_deck_stats(deck.id, db, user_id=current_user.id)
    return out


@router.get("/{deck_id}", response_model=DeckOut)
def get_deck(
    deck_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deck = db.query(Deck).filter(Deck.id == deck_id, Deck.user_id == current_user.id).first()
    if not deck:
        raise HTTPException(status_code=404, detail="Kortlek hittades inte")
    from ..routers.exams import get_nearest_exam
    nearest_exam = get_nearest_exam(db, current_user.id)
    out = DeckOut.model_validate(deck)
    out.stats = compute_deck_stats(deck.id, db, nearest_exam, user_id=current_user.id)
    return out


@router.put("/{deck_id}", response_model=DeckOut)
def update_deck(
    deck_id: int,
    data: DeckUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deck = db.query(Deck).filter(Deck.id == deck_id, Deck.user_id == current_user.id).first()
    if not deck:
        raise HTTPException(status_code=404, detail="Kortlek hittades inte")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(deck, field, value)
    db.commit()
    db.refresh(deck)
    out = DeckOut.model_validate(deck)
    out.stats = compute_deck_stats(deck.id, db, user_id=current_user.id)
    return out


@router.delete("/{deck_id}")
def delete_deck(
    deck_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deck = db.query(Deck).filter(Deck.id == deck_id, Deck.user_id == current_user.id).first()
    if not deck:
        raise HTTPException(status_code=404, detail="Kortlek hittades inte")
    db.delete(deck)
    db.commit()
    return {"ok": True}
