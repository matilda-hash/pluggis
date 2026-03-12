from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Card, CardState, Deck, Review, StudySession, User
from ..schemas import ReviewSubmit, SessionStart, SessionOut
from ..services.fsrs import FSRS, FSRSCard, Rating, State

router = APIRouter(prefix="/study", tags=["study"])

fsrs = FSRS()


@router.get("/queue", response_model=List[dict])
def get_study_queue(
    deck_id: Optional[int] = Query(None),
    limit: int = Query(50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.utcnow()

    due_query = (
        db.query(Card)
        .join(CardState)
        .filter(
            Card.is_suspended == False,
            CardState.user_id == current_user.id,
            or_(
                CardState.due <= now,
                CardState.due == None,
                CardState.state == int(State.New),
            ),
        )
    )

    state_ids = db.query(CardState.card_id).filter(CardState.user_id == current_user.id)
    new_query = (
        db.query(Card)
        .join(Deck, Card.deck_id == Deck.id)
        .filter(
            Deck.user_id == current_user.id,
            Card.is_suspended == False,
            ~Card.id.in_(state_ids),
        )
    )

    if deck_id:
        due_query = due_query.filter(Card.deck_id == deck_id)
        new_query = new_query.filter(Card.deck_id == deck_id)

    due_cards = due_query.order_by(CardState.state.asc(), CardState.due.asc()).all()
    new_cards = new_query.limit(20).all()

    seen = set()
    combined = []
    for card in due_cards + new_cards:
        if card.id not in seen:
            seen.add(card.id)
            combined.append(card)
        if len(combined) >= limit:
            break

    result = []
    for card in combined:
        cs = card.state
        result.append(
            {
                "id": card.id,
                "deck_id": card.deck_id,
                "card_type": card.card_type,
                "front": card.front,
                "back": card.back,
                "cloze_text": card.cloze_text,
                "tags": card.tags or [],
                "state": {
                    "stability": cs.stability if cs else 0.0,
                    "difficulty": cs.difficulty if cs else 0.0,
                    "due": cs.due.isoformat() if cs and cs.due else None,
                    "reps": cs.reps if cs else 0,
                    "lapses": cs.lapses if cs else 0,
                    "state": cs.state if cs else 0,
                },
            }
        )

    return result


@router.post("/review")
def submit_review(
    data: ReviewSubmit,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    card = (
        db.query(Card)
        .join(Deck, Card.deck_id == Deck.id)
        .filter(Card.id == data.card_id, Deck.user_id == current_user.id)
        .first()
    )
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    if data.rating not in (1, 2, 3, 4):
        raise HTTPException(status_code=422, detail="Rating must be 1–4")

    card_state = db.query(CardState).filter(CardState.card_id == card.id).first()

    fsrs_card = FSRSCard(
        stability=card_state.stability if card_state else 0.0,
        difficulty=card_state.difficulty if card_state else 0.0,
        due=card_state.due if card_state else None,
        last_review=card_state.last_review if card_state else None,
        reps=card_state.reps if card_state else 0,
        lapses=card_state.lapses if card_state else 0,
        state=State(card_state.state) if card_state else State.New,
    )

    result = fsrs.schedule(fsrs_card, Rating(data.rating))

    if not card_state:
        card_state = CardState(card_id=card.id, user_id=current_user.id)
        db.add(card_state)

    card_state.stability = result.card.stability
    card_state.difficulty = result.card.difficulty
    card_state.due = result.card.due
    card_state.last_review = result.card.last_review
    card_state.reps = result.card.reps
    card_state.lapses = result.card.lapses
    card_state.state = int(result.card.state)

    review = Review(
        card_id=card.id,
        user_id=current_user.id,
        rating=data.rating,
        state_before=result.review_log["state_before"],
        stability_before=result.review_log["stability_before"],
        difficulty_before=result.review_log["difficulty_before"],
        stability_after=result.review_log["stability_after"],
        difficulty_after=result.review_log["difficulty_after"],
        scheduled_days=result.review_log["scheduled_days"],
        elapsed_days=result.review_log["elapsed_days"],
    )
    db.add(review)

    if data.session_id:
        session = db.query(StudySession).filter(
            StudySession.id == data.session_id,
            StudySession.user_id == current_user.id,
        ).first()
        if session:
            session.cards_studied += 1
            if data.rating == 1:
                session.again_count += 1
            elif data.rating == 2:
                session.hard_count += 1
            elif data.rating == 3:
                session.good_count += 1
            elif data.rating == 4:
                session.easy_count += 1

    db.commit()

    return {
        "ok": True,
        "next_due": result.card.due.isoformat(),
        "new_state": int(result.card.state),
        "stability": result.card.stability,
        "interval_days": result.review_log["scheduled_days"],
    }


@router.post("/session/start", response_model=SessionOut)
def start_session(
    data: SessionStart,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = StudySession(user_id=current_user.id, deck_id=data.deck_id)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.post("/session/end", response_model=SessionOut)
def end_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(StudySession).filter(
        StudySession.id == session_id,
        StudySession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.ended_at = datetime.utcnow()
    db.commit()
    db.refresh(session)
    return session
