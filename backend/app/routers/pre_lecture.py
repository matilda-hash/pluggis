"""
Pre-lecture block content router.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Lecture, StudyBlock, User
from ..schemas import MiniQuizRequest, PreLecturePayload
from ..services.anki_connect import AnkiConnectClient
from ..services.pre_lecture import PreLectureGenerator

router = APIRouter(prefix="/pre-lecture", tags=["pre-lecture"])


def _get_lecture_or_404(lecture_id: int, user_id: int, db: Session) -> Lecture:
    lecture = db.query(Lecture).filter(
        Lecture.id == lecture_id,
        Lecture.user_id == user_id,
    ).first()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    return lecture


@router.get("/{lecture_id}")
def get_pre_lecture_content(
    lecture_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lecture = _get_lecture_or_404(lecture_id, current_user.id, db)

    existing_block = (
        db.query(StudyBlock)
        .filter(
            StudyBlock.lecture_id == lecture_id,
            StudyBlock.block_type == "pre_lecture",
            StudyBlock.user_id == current_user.id,
        )
        .first()
    )

    if existing_block and existing_block.payload and existing_block.payload.get("mini_quiz") is not None:
        return existing_block.payload

    try:
        generator = PreLectureGenerator()
        anki_client = AnkiConnectClient()
        payload = generator.generate_payload(lecture, db, anki_client)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pre-lecture generation failed: {e}")

    if existing_block:
        existing_block.payload = payload
        db.commit()

    return payload


@router.post("/{lecture_id}/mini-quiz")
def generate_mini_quiz(
    lecture_id: int,
    req: MiniQuizRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lecture = _get_lecture_or_404(lecture_id, current_user.id, db)

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
def refresh_pre_lecture(
    lecture_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lecture = _get_lecture_or_404(lecture_id, current_user.id, db)

    try:
        generator = PreLectureGenerator()
        anki_client = AnkiConnectClient()
        payload = generator.generate_payload(lecture, db, anki_client)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pre-lecture generation failed: {e}")

    existing_block = (
        db.query(StudyBlock)
        .filter(
            StudyBlock.lecture_id == lecture_id,
            StudyBlock.block_type == "pre_lecture",
            StudyBlock.user_id == current_user.id,
        )
        .first()
    )
    if existing_block:
        existing_block.payload = payload
        db.commit()

    return payload
