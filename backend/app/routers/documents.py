"""
Document management router.
Handles PDF upload → HTML conversion, highlight management, and card generation from highlights.
"""

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db, DEFAULT_USER_ID
from ..models import Card, CardState, Deck, Document, DocumentHighlight, GeneratedCardMeta
from ..schemas import (
    ConfirmDocumentCards, DocumentListItem, DocumentOut,
    GenerateFromHighlightsRequest, GeneratedCard,
    HighlightCreate, HighlightOut, UploadResult,
)
from ..services.pdf_converter import PDFConverter

router = APIRouter(prefix="/documents", tags=["documents"])

UPLOAD_DIR = Path(__file__).parent.parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


# ── Document CRUD ─────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    deck_id: int = Form(None),
    title: str = Form(None),
    db: Session = Depends(get_db),
):
    """Upload a PDF, convert to HTML, save Document row. Returns HTML for preview."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=422, detail="Only PDF files are supported")

    safe_name = f"{uuid.uuid4().hex}_{file.filename}"
    file_path = UPLOAD_DIR / safe_name
    content = await file.read()
    file_path.write_bytes(content)

    # Validate deck if provided
    if deck_id:
        deck = db.query(Deck).filter(Deck.id == deck_id, Deck.user_id == DEFAULT_USER_ID).first()
        if not deck:
            raise HTTPException(status_code=404, detail="Deck not found")

    doc_title = title or Path(file.filename).stem.replace("_", " ").title()

    try:
        converter = PDFConverter()
        html_content = converter.convert(str(file_path))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF conversion failed: {e}")

    doc = Document(
        user_id=DEFAULT_USER_ID,
        deck_id=deck_id,
        title=doc_title,
        original_filename=file.filename,
        html_content=html_content,
        source_pdf_path=str(file_path),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    return {
        "document_id": doc.id,
        "title": doc.title,
        "html_content": doc.html_content,
        "original_filename": doc.original_filename,
    }


@router.get("/", response_model=list[DocumentListItem])
def list_documents(db: Session = Depends(get_db)):
    docs = db.query(Document).filter(Document.user_id == DEFAULT_USER_ID).order_by(Document.created_at.desc()).all()
    result = []
    for doc in docs:
        highlight_count = db.query(DocumentHighlight).filter(DocumentHighlight.document_id == doc.id).count()
        result.append(DocumentListItem(
            id=doc.id,
            title=doc.title,
            original_filename=doc.original_filename,
            deck_id=doc.deck_id,
            highlight_count=highlight_count,
            created_at=doc.created_at,
        ))
    return result


@router.get("/{doc_id}", response_model=DocumentOut)
def get_document(doc_id: int, db: Session = Depends(get_db)):
    doc = _get_doc(doc_id, db)
    return doc


@router.delete("/{doc_id}")
def delete_document(doc_id: int, db: Session = Depends(get_db)):
    doc = _get_doc(doc_id, db)
    db.delete(doc)
    db.commit()
    return {"ok": True}


# ── Highlights ────────────────────────────────────────────────────────────────

@router.post("/{doc_id}/highlights", response_model=HighlightOut)
def add_highlight(doc_id: int, req: HighlightCreate, db: Session = Depends(get_db)):
    _get_doc(doc_id, db)  # 404 if not found

    valid_priorities = {"important", "difficult", "low"}
    if req.priority not in valid_priorities:
        raise HTTPException(status_code=422, detail=f"priority must be one of {valid_priorities}")

    highlight = DocumentHighlight(
        document_id=doc_id,
        user_id=DEFAULT_USER_ID,
        priority=req.priority,
        text_content=req.text_content,
        html_range_start=req.html_range_start,
        html_range_end=req.html_range_end,
    )
    db.add(highlight)
    db.commit()
    db.refresh(highlight)
    return highlight


@router.get("/{doc_id}/highlights", response_model=list[HighlightOut])
def list_highlights(doc_id: int, db: Session = Depends(get_db)):
    _get_doc(doc_id, db)
    highlights = (
        db.query(DocumentHighlight)
        .filter(DocumentHighlight.document_id == doc_id)
        .order_by(DocumentHighlight.created_at)
        .all()
    )
    return highlights


@router.delete("/{doc_id}/highlights/{highlight_id}")
def delete_highlight(doc_id: int, highlight_id: int, db: Session = Depends(get_db)):
    _get_doc(doc_id, db)
    h = db.query(DocumentHighlight).filter(
        DocumentHighlight.id == highlight_id,
        DocumentHighlight.document_id == doc_id,
    ).first()
    if not h:
        raise HTTPException(status_code=404, detail="Highlight not found")
    db.delete(h)
    db.commit()
    return {"ok": True}


# ── Card generation ───────────────────────────────────────────────────────────

@router.post("/{doc_id}/generate-cards")
def generate_cards_from_highlights(
    doc_id: int,
    req: GenerateFromHighlightsRequest,
    db: Session = Depends(get_db),
):
    """Generate flashcard previews from highlighted sections. Requires Claude API."""
    doc = _get_doc(doc_id, db)

    deck = db.query(Deck).filter(Deck.id == req.deck_id, Deck.user_id == DEFAULT_USER_ID).first()
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    # Load highlights
    if req.highlight_ids:
        highlights = (
            db.query(DocumentHighlight)
            .filter(
                DocumentHighlight.document_id == doc_id,
                DocumentHighlight.id.in_(req.highlight_ids),
            )
            .all()
        )
    else:
        highlights = db.query(DocumentHighlight).filter(DocumentHighlight.document_id == doc_id).all()

    if not highlights:
        raise HTTPException(status_code=400, detail="No highlights found for this document")

    try:
        from ..services.card_generator import ExpandedCardGenerator
        generator = ExpandedCardGenerator()
        raw_cards = generator.generate_from_highlights(highlights, doc, deck.name, req.num_cards)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Card generation failed: {e}")

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


@router.post("/{doc_id}/confirm-cards")
def confirm_document_cards(doc_id: int, data: ConfirmDocumentCards, db: Session = Depends(get_db)):
    """Save approved cards from document highlights to the database."""
    _get_doc(doc_id, db)

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

        state = CardState(card_id=card.id, user_id=DEFAULT_USER_ID, state=0)
        db.add(state)

        meta = GeneratedCardMeta(
            card_id=card.id,
            document_id=doc_id,
            generation_context="highlight",
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


# ── Helper ────────────────────────────────────────────────────────────────────

def _get_doc(doc_id: int, db: Session) -> Document:
    doc = db.query(Document).filter(
        Document.id == doc_id,
        Document.user_id == DEFAULT_USER_ID,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc
