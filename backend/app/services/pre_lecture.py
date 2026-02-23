"""
Pre-lecture content generator.
Generates the payload for a pre-lecture StudyBlock:
- Targeted card IDs
- Mini-quiz (Claude-generated)
- "What to listen for" bullets (Claude-generated)
- Reading task
- YouTube search suggestions (Claude-generated)
"""

from __future__ import annotations

import json
import os
from typing import List, Optional

import anthropic
from dotenv import load_dotenv
from sqlalchemy.orm import Session

load_dotenv()


class PreLectureGenerator:
    def __init__(self):
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY not set")
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

    def generate_payload(
        self,
        lecture,
        db: Session,
        anki_client=None,
        num_quiz_questions: int = 10,
        include_quiz: bool = True,
    ) -> dict:
        """
        Generate the full pre-lecture block payload.
        Returns a dict suitable for StudyBlock.payload.
        """
        title = lecture.title
        subject = lecture.subject_tag or title
        is_difficult = getattr(lecture, "is_difficult", False)

        # Duration
        if is_difficult:
            block_duration = 180  # 3h
            card_review_minutes = 35
        else:
            block_duration = 105  # 1h45m
            card_review_minutes = 20

        # Targeted card IDs
        targeted_ids = self._get_targeted_cards(lecture, db, anki_client)

        # Claude-generated content
        bullets = self._generate_bullets(title, subject)
        quiz = self._generate_quiz(title, subject, num_quiz_questions) if include_quiz else []
        youtube = self._generate_youtube_suggestions(title, subject)

        return {
            "lecture_title": title,
            "block_duration_minutes": block_duration,
            "card_review_minutes": card_review_minutes,
            "targeted_card_ids": targeted_ids,
            "mini_quiz": quiz,
            "what_to_listen_for": bullets,
            "reading_task": None,
            "youtube_suggestions": youtube,
        }

    # ── Private ───────────────────────────────────────────────────────────────

    def _get_targeted_cards(
        self,
        lecture,
        db: Session,
        anki_client=None,
    ) -> List[int]:
        """
        Get card IDs relevant to this lecture.
        Tries Anki first (by subject_tag), falls back to internal FSRS cards.
        Returns a list of internal card IDs.
        """
        from ..models import Card, CardState

        subject_tag = getattr(lecture, "subject_tag", None)

        # Try Anki
        if anki_client and anki_client.is_available() and subject_tag:
            result = anki_client.get_due_cards(tag=subject_tag)
            if result.ok and result.data:
                return result.data[:50]  # cap at 50 for display

        # Fallback: internal FSRS — find due/new cards in decks matching subject
        from datetime import datetime
        from ..database import DEFAULT_USER_ID

        query = db.query(CardState).filter(CardState.user_id == DEFAULT_USER_ID)
        if subject_tag:
            # Filter cards whose tags contain the subject_tag
            from ..models import Card as CardModel
            tagged_card_ids = [
                c.id for c in db.query(CardModel).all()
                if subject_tag in (c.tags or [])
            ]
            if tagged_card_ids:
                query = query.filter(CardState.card_id.in_(tagged_card_ids))

        now = datetime.utcnow()
        due_states = query.filter(
            (CardState.state > 0) & (CardState.due <= now)
        ).limit(30).all()

        new_states = query.filter(CardState.state == 0).limit(20).all()

        return [s.card_id for s in due_states + new_states]

    def _generate_bullets(self, lecture_title: str, subject: str) -> List[str]:
        """Generate 4-5 'what to listen for' bullets using Claude."""
        prompt = f"""You are helping a medical student prepare for a lecture.

Lecture title: "{lecture_title}"
Subject area: "{subject}"

Generate 4-5 concise bullet points of things the student should actively listen for during this lecture.
Focus on: key mechanisms, clinical relevance, common exam topics, and potential misconceptions.

Return ONLY a JSON array of strings (no markdown):
["Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4"]"""

        try:
            msg = self.client.messages.create(
                model=self.model,
                max_tokens=512,
                messages=[{"role": "user", "content": prompt}],
            )
            text = msg.content[0].text
            # Extract JSON array
            start = text.find("[")
            end = text.rfind("]") + 1
            if start >= 0 and end > start:
                return json.loads(text[start:end])
        except Exception:
            pass

        return [
            f"Key mechanisms related to {subject}",
            "Clinical significance and patient implications",
            "Diagnostic criteria and differential diagnoses",
            "Treatment approaches and evidence base",
        ]

    def _generate_quiz(
        self,
        lecture_title: str,
        subject: str,
        num_questions: int,
    ) -> List[dict]:
        """Generate a mini-quiz using Claude."""
        prompt = f"""You are creating a pre-lecture mini-quiz for a medical student.

Lecture: "{lecture_title}"
Subject: "{subject}"
Number of questions: {num_questions}

Generate {num_questions} quiz questions that test prerequisite knowledge for this lecture.
Mix question types: definition recall, mechanism questions, and true/false.

Return ONLY valid JSON (no markdown):
{{
  "questions": [
    {{"question": "...", "answer": "...", "card_type": "basic"}},
    {{"question": "True or False: ...", "answer": "True/False — explanation", "card_type": "true_false"}}
  ]
}}"""

        try:
            msg = self.client.messages.create(
                model=self.model,
                max_tokens=2000,
                messages=[{"role": "user", "content": prompt}],
            )
            text = msg.content[0].text
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                data = json.loads(text[start:end])
                return data.get("questions", [])
        except Exception:
            pass

        return []

    def _generate_youtube_suggestions(
        self,
        lecture_title: str,
        subject: str,
    ) -> List[dict]:
        """Generate 2-3 YouTube search suggestions using Claude."""
        prompt = f"""Suggest 2-3 YouTube video searches for a medical student preparing for a lecture on "{lecture_title}" ({subject}).

Include one basic/overview video and one more advanced/clinical video.

Return ONLY valid JSON (no markdown):
[
  {{"title": "Descriptive title for the video to look for", "search_query": "exact youtube search string"}},
  {{"title": "...", "search_query": "..."}}
]"""

        try:
            msg = self.client.messages.create(
                model=self.model,
                max_tokens=400,
                messages=[{"role": "user", "content": prompt}],
            )
            text = msg.content[0].text
            start = text.find("[")
            end = text.rfind("]") + 1
            if start >= 0 and end > start:
                return json.loads(text[start:end])
        except Exception:
            pass

        return [
            {"title": f"{subject} overview (beginner)", "search_query": f"{subject} medical overview"},
            {"title": f"{subject} clinical lecture", "search_query": f"{subject} clinical medicine lecture"},
        ]
