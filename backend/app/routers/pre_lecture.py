"""
Pre-lecture block content router.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db, DEFAULT_USER_ID
from ..models import Lecture, StudyBlock
from ..schemas import MiniQuizRequest, PreLecturePayload
from ..services.anki_connect import AnkiConnectClient
from ..services.pre_lecture import PreLectureGenerator

router = APIRouter(prefix="/pre-lecture", tags=["pre-lecture"])


def _get_lecture_or_404(lecture_id: int, db: Session) -> Lecture:
    lecture = db.query(Lecture).filter(
        Lecture.id == lecture_id,
        Lecture.user_id == DEFAULT_USER_ID,
    ).first()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    return lecture


@router.get("/{lecture_id}")
def get_pre_lecture_content(lecture_id: int, db: Session = Depends(get_db)):
    """
    Return pre-lecture block payload.
    If a StudyBlock with type=pre_lecture exists for this lecture and has payload,
    return that. Otherwise generate fresh.
    """
    lecture = _get_lecture_or_404(lecture_id, db)

    # Check for existing block with cached payload
    existing_block = (
        db.query(StudyBlock)
        .filter(
            StudyBlock.lecture_id == lecture_id,
            StudyBlock.block_type == "pre_lecture",
            StudyBlock.user_id == DEFAULT_USER_ID,
        )
        .first()
    )

    if existing_block and existing_block.payload and existing_block.payload.get("mini_quiz") is not None:
        return existing_block.payload

    # Generate fresh
    try:
        generator = PreLectureGenerator()
        anki_client = AnkiConnectClient()
        payload = generator.generate_payload(lecture, db, anki_client)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pre-lecture generation failed: {e}")

    # Cache in existing block if available
    if existing_block:
        existing_block.payload = payload
        db.commit()

    return payload


@router.post("/{lecture_id}/mini-quiz")
def generate_mini_quiz(
    lecture_id: int,
    req: MiniQuizRequest,
    db: Session = Depends(get_db),
):
    """Generate a fresh mini-quiz for a lecture."""
    lecture = _get_lecture_or_404(lecture_id, db)

    try:
        generator = PreLectureGenerator()
        quiz = generator._generate_quiz(
            lecture.title,
            lecture.subject_tag or lecture.title,
            req.num_questions,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Quiz generation failed: {e}")

    return {"questions": quiz}


@router.post("/{lecture_id}/refresh")
def refresh_pre_lecture(lecture_id: int, db: Session = Depends(get_db)):
    """Regenerate pre-lecture content from scratch."""
    lecture = _get_lecture_or_404(lecture_id, db)

    try:
        generator = PreLectureGenerator()
        anki_client = AnkiConnectClient()
        payload = generator.generate_payload(lecture, db, anki_client)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pre-lecture generation failed: {e}")

    # Update block payload if exists
    existing_block = (
        db.query(StudyBlock)
        .filter(
            StudyBlock.lecture_id == lecture_id,
            StudyBlock.block_type == "pre_lecture",
            StudyBlock.user_id == DEFAULT_USER_ID,
        )
        .first()
    )
    if existing_block:
        existing_block.payload = payload
        db.commit()

    return payload
