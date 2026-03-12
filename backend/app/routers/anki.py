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

from ..auth import get_current_user
from ..database import get_db
from ..models import Card, CardState, Deck, User
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
def anki_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
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
        .filter(CS.user_id == current_user.id, CS.state > 0, CS.due <= now)
        .count()
    )
    new_count = (
        db.query(CS)
        .filter(CS.user_id == current_user.id, CS.state == 0)
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
def export_to_anki(
    req: AnkiExportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export internal cards to Anki via AnkiConnect."""
    client = _client()
    if not client.is_available():
        raise HTTPException(status_code=503, detail="Anki is not running or AnkiConnect is not installed")

    # Ensure deck exists
    client.create_deck(req.deck_name)

    cards = db.query(Card).filter(
        Card.id.in_(req.card_ids),
        Card.deck.has(user_id=current_user.id),
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
    deck_id: int = Form(None),
    new_deck_name: str = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Import an Anki .apkg file into the internal database.
    Either deck_id (existing deck) or new_deck_name (creates a new deck) must be provided.
    """
    if not file.filename.lower().endswith(".apkg"):
        raise HTTPException(status_code=422, detail="Only .apkg files are supported")

    if new_deck_name:
        deck = Deck(
            user_id=current_user.id,
            name=new_deck_name,
            source_type="anki_import",
        )
        db.add(deck)
        db.commit()
        db.refresh(deck)
    elif deck_id:
        deck = db.query(Deck).filter(Deck.id == deck_id, Deck.user_id == current_user.id).first()
        if not deck:
            raise HTTPException(status_code=404, detail="Deck not found")
    else:
        raise HTTPException(status_code=422, detail="Either deck_id or new_deck_name must be provided")

    content = await file.read()

    with tempfile.TemporaryDirectory() as tmpdir:
        apkg_path = os.path.join(tmpdir, "import.apkg")
        with open(apkg_path, "wb") as f:
            f.write(content)

        try:
            with zipfile.ZipFile(apkg_path, "r") as zf:
                names = zf.namelist()
                candidates = [n for n in ("collection.anki2", "collection.anki21", "collection.anki21b") if n in names]
                if not candidates:
                    raise HTTPException(status_code=422, detail="Invalid .apkg: no collection database found")
                for db_name in candidates:
                    zf.extract(db_name, tmpdir)
        except zipfile.BadZipFile:
            raise HTTPException(status_code=422, detail="Invalid .apkg file (bad zip)")

        # Pick the format that yields the most importable notes
        best_path = None
        best_count = -1
        for db_name in candidates:
            path = os.path.join(tmpdir, db_name)
            count = _count_real_notes(path)
            if count > best_count:
                best_count = count
                best_path = path

        imported, skipped = _import_from_collection(best_path, deck.id, current_user.id, db)

    return ImportApkgResult(imported=imported, skipped=skipped, deck_name=deck.name)



def _count_real_notes(collection_path: str) -> int:
    """Return how many non-compat notes are in the collection database."""
    try:
        conn = sqlite3.connect(collection_path)
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(notes)")
        col_names = {row[1] for row in cursor.fetchall()}
        if "flds" in col_names:
            cursor.execute("SELECT flds FROM notes")
        elif "fields" in col_names:
            cursor.execute("SELECT fields FROM notes")
        else:
            conn.close()
            return 0
        count = sum(1 for (flds,) in cursor.fetchall() if not _is_compat_note(flds.split("\x1f")))
        conn.close()
        return count
    except Exception:
        return 0


def _is_compat_note(fields: list[str]) -> bool:
    """Return True if this note is an Anki compatibility/system warning note."""
    combined = "\x1f".join(fields).lower()
    # Strip HTML tags for cleaner matching
    import re as _re
    text = _re.sub(r"<[^>]+>", " ", combined)

    if "ankiweb.net" in text:
        return True
    # Swedish warning phrases
    if "ankiversionen" in text:
        return True
    if "uppdatera" in text and "anki" in text:
        return True
    # English: any form of "update/upgrade anki"
    if ("update" in text or "upgrade" in text) and "anki" in text:
        return True
    # Catch "try again" phrasing used in some versions
    if "try again" in text and "anki" in text:
        return True
    return False


def _import_from_collection(collection_path: str, deck_id: int, user_id: int, db: Session) -> tuple[int, int]:
    """Parse Anki collection SQLite and create Card + CardState rows."""
    imported = 0
    skipped = 0

    conn = sqlite3.connect(collection_path)
    try:
        cursor = conn.cursor()
        # Check which columns exist — anki21b may use different names
        cursor.execute("PRAGMA table_info(notes)")
        col_names = {row[1] for row in cursor.fetchall()}
        if "flds" in col_names and "tags" in col_names:
            cursor.execute("SELECT flds, tags FROM notes")
        elif "fields" in col_names and "tags" in col_names:
            cursor.execute("SELECT fields, tags FROM notes")
        else:
            # Fallback: no recognisable column names — skip this collection
            conn.close()
            return 0, 0
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

        if _is_compat_note(fields):
            skipped += 1
            continue

        tags = [t.strip() for t in tags_str.strip().split() if t.strip()]

        if len(fields) == 1:
            card = Card(
                deck_id=deck_id,
                card_type="cloze",
                cloze_text=fields[0],
                tags=tags,
            )
        elif len(fields) >= 2:
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
        state = CardState(card_id=card.id, user_id=user_id, state=0)
        db.add(state)
        imported += 1

    db.commit()
    return imported, skipped
