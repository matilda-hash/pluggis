from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Card, CardState, Deck, User
from ..schemas import CardCreate, CardUpdate, CardOut
from ..services.fsrs import State

router = APIRouter(prefix="/cards", tags=["cards"])


@router.get("/", response_model=List[CardOut])
def list_cards(
    deck_id: int = Query(...),
    state: Optional[int] = None,
    suspended: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deck = db.query(Deck).filter(Deck.id == deck_id, Deck.user_id == current_user.id).first()
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    q = db.query(Card).filter(Card.deck_id == deck_id)
    if not suspended:
        q = q.filter(Card.is_suspended == False)
    if state is not None:
        q = q.join(CardState).filter(CardState.state == state)
    return q.all()


@router.post("/", response_model=CardOut)
def create_card(
    data: CardCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deck = db.query(Deck).filter(Deck.id == data.deck_id, Deck.user_id == current_user.id).first()
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    card = Card(**data.model_dump())
    db.add(card)
    db.flush()

    state = CardState(card_id=card.id, user_id=current_user.id, state=0)
    db.add(state)
    db.commit()
    db.refresh(card)
    return card


@router.post("/bulk", response_model=List[CardOut])
def create_cards_bulk(
    deck_id: int,
    cards_data: List[CardCreate],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deck = db.query(Deck).filter(Deck.id == deck_id, Deck.user_id == current_user.id).first()
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    created = []
    for data in cards_data:
        card = Card(**data.model_dump())
        db.add(card)
        db.flush()
        state = CardState(card_id=card.id, user_id=current_user.id, state=0)
        db.add(state)
        created.append(card)

    db.commit()
    for c in created:
        db.refresh(c)
    return created


@router.get("/{card_id}", response_model=CardOut)
def get_card(
    card_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    card = db.query(Card).join(Deck, Card.deck_id == Deck.id).filter(
        Card.id == card_id, Deck.user_id == current_user.id
    ).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


@router.put("/{card_id}", response_model=CardOut)
def update_card(
    card_id: int,
    data: CardUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    card = db.query(Card).join(Deck, Card.deck_id == Deck.id).filter(
        Card.id == card_id, Deck.user_id == current_user.id
    ).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(card, field, value)
    card.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(card)
    return card


@router.delete("/{card_id}")
def delete_card(
    card_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    card = db.query(Card).join(Deck, Card.deck_id == Deck.id).filter(
        Card.id == card_id, Deck.user_id == current_user.id
    ).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    db.delete(card)
    db.commit()
    return {"ok": True}
