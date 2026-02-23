import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db, DEFAULT_USER_ID
from ..models import Card, CardState, Deck, GeneratedCardMeta
from ..schemas import CardsBulkCreate, UploadResult
from ..services.card_generator import ExpandedCardGenerator

router = APIRouter(prefix="/upload", tags=["upload"])

UPLOAD_DIR = Path(__file__).parent.parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


@router.post("/pdf", response_model=UploadResult)
async def upload_pdf(
    file: UploadFile = File(...),
    deck_id: int = Form(None),
    deck_name: str = Form(None),
    num_cards: int = Form(40),
    db: Session = Depends(get_db),
):
    """Upload a PDF, generate flashcards via Claude, return them for preview."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=422, detail="Only PDF files are supported")

    # Save the uploaded file
    safe_name = f"{uuid.uuid4().hex}_{file.filename}"
    file_path = UPLOAD_DIR / safe_name
    content = await file.read()
    file_path.write_bytes(content)

    # Resolve or create deck
    if deck_id:
        deck = db.query(Deck).filter(Deck.id == deck_id, Deck.user_id == DEFAULT_USER_ID).first()
        if not deck:
            raise HTTPException(status_code=404, detail="Deck not found")
    else:
        name = deck_name or Path(file.filename).stem
        deck = Deck(
            user_id=DEFAULT_USER_ID,
            name=name,
            source_type="pdf",
            source_filename=file.filename,
        )
        db.add(deck)
        db.commit()
        db.refresh(deck)

    # Generate flashcards with expanded 11-type generator
    try:
        generator = ExpandedCardGenerator()
        raw_cards = generator.generate_from_pdf(str(file_path), deck.name, num_cards)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Card generation failed: {e}")

    # Return as preview (not saved yet – frontend will confirm)
    from ..schemas import GeneratedCard

    preview = [
        GeneratedCard(
            card_type=c["card_type"],
            front=c.get("front"),
            back=c.get("back"),
            cloze_text=c.get("cloze_text"),
            tags=c.get("tags", []),
            subject_tag=c.get("subject_tag"),
            concept_tag=c.get("concept_tag"),
            type_tag=c.get("type_tag"),
            context_tag=c.get("context_tag"),
            source_metadata=c.get("source_metadata", {}),
        )
        for c in raw_cards
    ]

    return UploadResult(
        deck_id=deck.id,
        deck_name=deck.name,
        cards_generated=len(preview),
        cards=preview,
    )


@router.post("/confirm")
def confirm_cards(data: CardsBulkCreate, db: Session = Depends(get_db)):
    """Save the approved (possibly edited) cards to the database."""
    deck = db.query(Deck).filter(Deck.id == data.deck_id, Deck.user_id == DEFAULT_USER_ID).first()
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    created = 0
    for c in data.cards:
        card = Card(
            deck_id=deck.id,
            card_type=c.card_type,
            front=c.front,
            back=c.back,
            cloze_text=c.cloze_text,
            tags=c.tags or [],
        )
        db.add(card)
        db.flush()
        # state=0 (New), due=None → picked up by queue's or_(due<=now, due==None) filter
        state = CardState(card_id=card.id, user_id=DEFAULT_USER_ID, state=0)
        db.add(state)
        # Save generation metadata if tags are present
        if c.subject_tag or c.concept_tag or c.type_tag:
            meta = GeneratedCardMeta(
                card_id=card.id,
                generation_context="pdf_upload",
                subject_tag=c.subject_tag,
                concept_tag=c.concept_tag,
                type_tag=c.type_tag,
                context_tag=c.context_tag,
                source_metadata=c.source_metadata or {},
            )
            db.add(meta)
        created += 1

    db.commit()
    return {"ok": True, "cards_saved": created, "deck_id": deck.id}
