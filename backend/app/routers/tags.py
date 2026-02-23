"""
Tags and weakness metrics router.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db, DEFAULT_USER_ID
from ..models import TagDictionary, WeaknessMetrics
from ..schemas import TagOut, WeaknessMetricOut
from ..services.anki_connect import AnkiConnectClient

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("/", response_model=list[TagOut])
def list_tags(db: Session = Depends(get_db)):
    return (
        db.query(TagDictionary)
        .filter(TagDictionary.user_id == DEFAULT_USER_ID)
        .order_by(TagDictionary.usage_count.desc())
        .all()
    )


@router.post("/")
def add_tag(tag: str, tag_type: str = "concept", db: Session = Depends(get_db)):
    existing = (
        db.query(TagDictionary)
        .filter(TagDictionary.user_id == DEFAULT_USER_ID, TagDictionary.tag == tag)
        .first()
    )
    if existing:
        existing.usage_count += 1
        db.commit()
        return existing
    new_tag = TagDictionary(user_id=DEFAULT_USER_ID, tag=tag, tag_type=tag_type)
    db.add(new_tag)
    db.commit()
    db.refresh(new_tag)
    return new_tag


@router.get("/weakness", response_model=list[WeaknessMetricOut])
def get_weakness_metrics(db: Session = Depends(get_db)):
    return (
        db.query(WeaknessMetrics)
        .filter(WeaknessMetrics.user_id == DEFAULT_USER_ID)
        .order_by(WeaknessMetrics.lapse_rate.desc())
        .all()
    )


@router.post("/sync-weakness")
def sync_weakness(db: Session = Depends(get_db)):
    """Recompute weakness metrics from review history + Anki data."""
    from ..services.anki_sync import sync_weakness_metrics
    client = AnkiConnectClient()
    sync_weakness_metrics(db, DEFAULT_USER_ID, client)
    return {"ok": True, "message": "Weakness metrics updated"}
