"""
Exam management: CRUD + deck relevance scoring.

Relevance between an exam name and a deck name is computed via word-overlap
so that e.g. "Neurologi tentamen" automatically surfaces decks called
"Neurologi", "Neuro – kap 4", "Nervsystemet" etc.
"""

import re
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db, DEFAULT_USER_ID
from ..models import Deck, Exam
from ..schemas import ExamCreate, ExamOut, ExamUpdate

router = APIRouter(prefix="/exams", tags=["exams"])

# Swedish stop-words to ignore in matching
_STOPWORDS = {
    "och", "i", "av", "på", "den", "det", "en", "ett", "till", "för", "med",
    "om", "är", "att", "tentamen", "tenta", "kurs", "prov", "examination",
    "the", "of", "in", "and", "to", "for", "exam", "course", "test",
}


def _tokenize(text: str) -> set[str]:
    words = set(re.findall(r"\w+", text.lower()))
    return {w for w in words if len(w) >= 3 and w not in _STOPWORDS}


def compute_relevance(exam_name: str, deck_name: str) -> float:
    """
    Return a 0–1 relevance score.
    A score > 0 means the deck is probably relevant to the exam.
    """
    exam_words = _tokenize(exam_name)
    deck_words = _tokenize(deck_name)
    if not exam_words:
        return 0.0

    score = 0.0
    for ew in exam_words:
        for dw in deck_words:
            if ew == dw or ew in dw or dw in ew:
                score += 1.0
                break

    return min(1.0, score / len(exam_words))


def get_nearest_exam(db: Session, user_id: int) -> Optional[Exam]:
    today_dt = datetime.combine(date.today(), datetime.min.time())
    return (
        db.query(Exam)
        .filter(Exam.user_id == user_id, Exam.exam_date >= today_dt)
        .order_by(Exam.exam_date.asc())
        .first()
    )


def enrich_exam(exam: Exam, db: Session) -> ExamOut:
    """Add computed fields: days_remaining, relevant_deck_ids."""
    today = date.today()
    days_remaining = (exam.exam_date.date() - today).days

    decks = db.query(Deck).filter(Deck.user_id == exam.user_id, Deck.is_active == True).all()
    relevant = [d.id for d in decks if compute_relevance(exam.name, d.name) > 0]

    out = ExamOut.model_validate(exam)
    out.days_remaining = days_remaining
    out.relevant_deck_ids = relevant
    return out


@router.get("/", response_model=List[ExamOut])
def list_exams(db: Session = Depends(get_db)):
    exams = (
        db.query(Exam)
        .filter(Exam.user_id == DEFAULT_USER_ID)
        .order_by(Exam.exam_date.asc())
        .all()
    )
    return [enrich_exam(e, db) for e in exams]


@router.post("/", response_model=ExamOut)
def create_exam(data: ExamCreate, db: Session = Depends(get_db)):
    exam = Exam(user_id=DEFAULT_USER_ID, **data.model_dump())
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return enrich_exam(exam, db)


@router.put("/{exam_id}", response_model=ExamOut)
def update_exam(exam_id: int, data: ExamUpdate, db: Session = Depends(get_db)):
    exam = db.query(Exam).filter(Exam.id == exam_id, Exam.user_id == DEFAULT_USER_ID).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Tentamen hittades inte")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(exam, field, value)
    db.commit()
    db.refresh(exam)
    return enrich_exam(exam, db)


@router.delete("/{exam_id}")
def delete_exam(exam_id: int, db: Session = Depends(get_db)):
    exam = db.query(Exam).filter(Exam.id == exam_id, Exam.user_id == DEFAULT_USER_ID).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Tentamen hittades inte")
    db.delete(exam)
    db.commit()
    return {"ok": True}
