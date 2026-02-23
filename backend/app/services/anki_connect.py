"""
AnkiConnect client — wraps the local AnkiConnect HTTP API (port 8765).
Every public method returns an AnkiResult so callers never need try/except.
If Anki is not running, all methods return AnkiResult(ok=False, ...).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, Generic, List, Optional, TypeVar

import requests

T = TypeVar("T")

ANKI_URL = "http://localhost:8765"
TIMEOUT = 2.0  # seconds — fast fail if Anki not running


@dataclass
class AnkiResult(Generic[T]):
    ok: bool
    data: Optional[T] = None
    error: Optional[str] = None


def _invoke(action: str, **params) -> AnkiResult[Any]:
    """Send a single AnkiConnect request and return a typed result."""
    payload = {"action": action, "version": 6, "params": params}
    try:
        r = requests.post(ANKI_URL, json=payload, timeout=TIMEOUT)
        r.raise_for_status()
        body = r.json()
        if body.get("error"):
            return AnkiResult(ok=False, error=body["error"])
        return AnkiResult(ok=True, data=body.get("result"))
    except requests.exceptions.ConnectionError:
        return AnkiResult(ok=False, error="Anki not reachable (connection refused)")
    except requests.exceptions.Timeout:
        return AnkiResult(ok=False, error="Anki not reachable (timeout)")
    except Exception as exc:
        return AnkiResult(ok=False, error=str(exc))


class AnkiConnectClient:
    """High-level wrapper around AnkiConnect's JSON API."""

    def is_available(self) -> bool:
        result = _invoke("version")
        return result.ok

    def get_version(self) -> AnkiResult[str]:
        result = _invoke("version")
        if result.ok:
            return AnkiResult(ok=True, data=str(result.data))
        return result

    # ── Card queries ──────────────────────────────────────────────────────────

    def find_cards(self, query: str) -> AnkiResult[List[int]]:
        return _invoke("findCards", query=query)

    def get_due_cards(self, tag: Optional[str] = None) -> AnkiResult[List[int]]:
        query = "is:due"
        if tag:
            query += f" tag:{tag}"
        return self.find_cards(query)

    def get_new_cards(self, tag: Optional[str] = None) -> AnkiResult[List[int]]:
        query = "is:new"
        if tag:
            query += f" tag:{tag}"
        return self.find_cards(query)

    def get_lapse_count_by_tag(self, tag: str) -> AnkiResult[int]:
        """Count cards that have lapsed (type=relearning) for a specific tag."""
        result = self.find_cards(f"tag:{tag} prop:lapses>0")
        if not result.ok:
            return result
        return AnkiResult(ok=True, data=len(result.data or []))

    def get_lapses_by_tags(self, tags: List[str]) -> AnkiResult[Dict[str, int]]:
        """Return lapse counts for multiple tags at once."""
        counts: Dict[str, int] = {}
        for tag in tags:
            r = self.get_lapse_count_by_tag(tag)
            counts[tag] = r.data if r.ok else 0
        return AnkiResult(ok=True, data=counts)

    def get_cards_info(self, card_ids: List[int]) -> AnkiResult[List[dict]]:
        if not card_ids:
            return AnkiResult(ok=True, data=[])
        return _invoke("cardsInfo", cards=card_ids)

    def estimate_review_time_minutes(self, card_ids: List[int]) -> AnkiResult[float]:
        """Heuristic: mature cards ~8s, young/new cards ~20s."""
        if not card_ids:
            return AnkiResult(ok=True, data=0.0)
        result = self.get_cards_info(card_ids)
        if not result.ok:
            # Fallback: assume 12s average
            return AnkiResult(ok=True, data=round(len(card_ids) * 12 / 60, 1))
        total_seconds = 0.0
        for card in (result.data or []):
            # interval > 21 days = mature → 8s; else → 20s
            interval = card.get("interval", 0)
            total_seconds += 8 if interval > 21 else 20
        return AnkiResult(ok=True, data=round(total_seconds / 60, 1))

    # ── Card creation ─────────────────────────────────────────────────────────

    def create_note(
        self,
        deck_name: str,
        front: str,
        back: str,
        tags: Optional[List[str]] = None,
        model_name: str = "Basic",
    ) -> AnkiResult[int]:
        """Add a single Basic note. Returns the new note ID."""
        note = {
            "deckName": deck_name,
            "modelName": model_name,
            "fields": {"Front": front, "Back": back},
            "tags": tags or [],
            "options": {"allowDuplicate": False},
        }
        return _invoke("addNote", note=note)

    def create_cloze_note(
        self,
        deck_name: str,
        cloze_text: str,
        tags: Optional[List[str]] = None,
    ) -> AnkiResult[int]:
        """Add a Cloze note. cloze_text must contain {{c1::...}} syntax."""
        # Convert our {{blank}} syntax to Anki's {{c1::blank}} format
        anki_text = _convert_to_anki_cloze(cloze_text)
        note = {
            "deckName": deck_name,
            "modelName": "Cloze",
            "fields": {"Text": anki_text, "Back Extra": ""},
            "tags": tags or [],
            "options": {"allowDuplicate": False},
        }
        return _invoke("addNote", note=note)

    def create_deck(self, deck_name: str) -> AnkiResult[int]:
        """Create a deck if it doesn't exist. Returns deck ID."""
        return _invoke("createDeck", deck=deck_name)

    def add_tags(self, note_ids: List[int], tags: List[str]) -> AnkiResult[bool]:
        tag_str = " ".join(tags)
        result = _invoke("addTags", notes=note_ids, tags=tag_str)
        if result.ok:
            return AnkiResult(ok=True, data=True)
        return result

    # ── Deck queries ──────────────────────────────────────────────────────────

    def get_deck_names(self) -> AnkiResult[List[str]]:
        return _invoke("deckNames")

    def get_deck_stats(self, deck_names: List[str]) -> AnkiResult[dict]:
        return _invoke("getDeckStats", decks=deck_names)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _convert_to_anki_cloze(text: str) -> str:
    """Convert {{term}} style cloze to Anki's {{c1::term}} format."""
    import re
    counter = [0]

    def replacer(m):
        counter[0] += 1
        return f"{{{{c{counter[0]}::{m.group(1)}}}}}"

    return re.sub(r"\{\{(.+?)\}\}", replacer, text)
