"""
Anki integration router.
All endpoints are resilient — Anki not running → HTTP 200 with available=False.
"""

import zipfile
import sqlite3
import tempfile
import os
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db, DEFAULT_USER_ID
from ..models import Card, CardState, Deck
from ..schemas import (
    AnkiStatus, AnkiStats, AnkiExportRequest,
    ImportApkgResult, ExportAnkiResult,
)
from ..services.anki_connect import AnkiConnectClient

router = APIRouter(prefix="/anki", tags=["anki"])


def _client() -> AnkiConnectClient:
    return AnkiConnectClient()


@router.get("/status", response_model=AnkiStatus)
def anki_status():
    """Check if Anki + AnkiConnect are running."""
    client = _client()
    version_result = client.get_version()
    return AnkiStatus(
        available=version_result.ok,
        version=version_result.data if version_result.ok else None,
    )


@router.get("/stats", response_model=AnkiStats)
def anki_stats(db: Session = Depends(get_db)):
    """
    Return Anki due/new/lapse counts.
    Falls back to internal FSRS counts if Anki is unavailable.
    """
    client = _client()
    available = client.is_available()

    if available:
        due_result = client.get_due_cards()
        new_result = client.get_new_cards()
        due_ids = due_result.data or []
        new_ids = new_result.data or []
        time_result = client.estimate_review_time_minutes(due_ids + new_ids)
        lapses_result = client.get_lapses_by_tags([])
        return AnkiStats(
            available=True,
            due=len(due_ids),
            new_cards=len(new_ids),
            lapses_by_tag=lapses_result.data or {},
            est_review_minutes=int(time_result.data or 0),
        )

    # Fallback to internal FSRS stats
    from datetime import datetime
    from ..models import CardState as CS
    now = datetime.utcnow()
    due_count = (
        db.query(CS)
        .filter(CS.user_id == DEFAULT_USER_ID, CS.state > 0, CS.due <= now)
        .count()
    )
    new_count = (
        db.query(CS)
        .filter(CS.user_id == DEFAULT_USER_ID, CS.state == 0)
        .count()
    )
    return AnkiStats(
        available=False,
        due=due_count,
        new_cards=new_count,
        lapses_by_tag={},
        est_review_minutes=int((due_count * 12 + new_count * 20) / 60),
    )


@router.post("/export", response_model=ExportAnkiResult)
def export_to_anki(req: AnkiExportRequest, db: Session = Depends(get_db)):
    """Export internal cards to Anki via AnkiConnect."""
    client = _client()
    if not client.is_available():
        raise HTTPException(status_code=503, detail="Anki is not running or AnkiConnect is not installed")

    # Ensure deck exists
    client.create_deck(req.deck_name)

    cards = db.query(Card).filter(
        Card.id.in_(req.card_ids),
        Card.deck.has(user_id=DEFAULT_USER_ID),
    ).all()

    exported = 0
    errors = []

    for card in cards:
        try:
            tags = list(card.tags) if card.tags else []
            if card.card_type in ("cloze", "single_cloze", "multi_cloze") and card.cloze_text:
                result = client.create_cloze_note(req.deck_name, card.cloze_text, tags)
            else:
                front = card.front or ""
                back = card.back or ""
                result = client.create_note(req.deck_name, front, back, tags)

            if result.ok:
                exported += 1
            else:
                errors.append(f"Card {card.id}: {result.error}")
        except Exception as exc:
            errors.append(f"Card {card.id}: {exc}")

    return ExportAnkiResult(exported=exported, errors=errors)


@router.post("/import", response_model=ImportApkgResult)
async def import_apkg(
    file: UploadFile = File(...),
    deck_id: int = Form(...),
    db: Session = Depends(get_db),
):
    """
    Import an Anki .apkg file into the internal database.
    .apkg is a zip containing collection.anki2 (SQLite).
    """
    if not file.filename.lower().endswith(".apkg"):
        raise HTTPException(status_code=422, detail="Only .apkg files are supported")

    deck = db.query(Deck).filter(Deck.id == deck_id, Deck.user_id == DEFAULT_USER_ID).first()
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    content = await file.read()

    with tempfile.TemporaryDirectory() as tmpdir:
        apkg_path = os.path.join(tmpdir, "import.apkg")
        with open(apkg_path, "wb") as f:
            f.write(content)

        try:
            with zipfile.ZipFile(apkg_path, "r") as zf:
                names = zf.namelist()
                # Try collection.anki21 first (newer format), fall back to collection.anki2
                db_name = "collection.anki21" if "collection.anki21" in names else "collection.anki2"
                if db_name not in names:
                    raise HTTPException(status_code=422, detail="Invalid .apkg: no collection database found")
                zf.extract(db_name, tmpdir)
        except zipfile.BadZipFile:
            raise HTTPException(status_code=422, detail="Invalid .apkg file (bad zip)")

        collection_path = os.path.join(tmpdir, db_name)
        imported, skipped = _import_from_collection(collection_path, deck_id, db)

    return ImportApkgResult(imported=imported, skipped=skipped, deck_name=deck.name)


def _import_from_collection(collection_path: str, deck_id: int, db: Session) -> tuple[int, int]:
    """Parse Anki collection SQLite and create Card + CardState rows."""
    imported = 0
    skipped = 0

    conn = sqlite3.connect(collection_path)
    try:
        cursor = conn.cursor()
        # notes table: id, mid (model id), flds (fields separated by \x1f), tags
        cursor.execute("SELECT flds, tags FROM notes")
        rows = cursor.fetchall()
    except Exception:
        conn.close()
        return 0, 0
    finally:
        conn.close()

    for flds, tags_str in rows:
        fields = flds.split("\x1f")
        if len(fields) < 1:
            skipped += 1
            continue

        tags = [t.strip() for t in tags_str.strip().split() if t.strip()]

        if len(fields) == 1:
            # Likely a cloze card
            card = Card(
                deck_id=deck_id,
                card_type="cloze",
                cloze_text=fields[0],
                tags=tags,
            )
        elif len(fields) >= 2:
            # Basic card: first field = front, second = back
            front = fields[0].strip()
            back = fields[1].strip()
            if not front:
                skipped += 1
                continue
            card = Card(
                deck_id=deck_id,
                card_type="basic",
                front=front,
                back=back,
                tags=tags,
            )
        else:
            skipped += 1
            continue

        db.add(card)
        db.flush()
        state = CardState(card_id=card.id, user_id=DEFAULT_USER_ID, state=0)
        db.add(state)
        imported += 1

    db.commit()
    return imported, skipped
