"""
AI Tutor service — builds rich context from the user's course materials,
flashcards, exam schedule, FSRS performance, and previous concerns, then
streams a response using Claude.
"""

import os
from datetime import datetime, date
from typing import AsyncIterator
from sqlalchemy.orm import Session

import anthropic

from ..database import SessionLocal
from ..models import (
    User, Deck, Card, CardState, Exam, ExamTopic,
    Document, ChatMessage, StudentProfile, AIStudyBlock,
)


TUTOR_SYSTEM_PROMPT = """Du är Pluggis AI-handledare — en kunnig, varm och ärlig privathandledare för medicinska universitetsstudenter.

Du har tillgång till studentens exakt kursinnehåll, alla deras studiekort, tentor, ämnesläge och FSRS-prestationsdata. Du känner till deras schema, svagheter och oro.

Dina uppgifter:
1. Svara på frågor om kursmaterial med djup, pedagogisk precision — förklara mekanismer, klinisk relevans och kontext
2. Koppla ihop ämnen när de hänger ihop (t.ex. farmakologi ↔ fysiologi ↔ patologi)
3. Lyssna aktivt på oro och stressprat — bekräfta, normalisera och ge konkreta strategier
4. Flagga ämnen och oro som bör prioriteras i schemat
5. Ställ klargörande frågor för att förstå var eleven fastnar

Ton: professionell men varm, inte alltför formell. Svara alltid på svenska om inte eleven skriver på engelska. Var konkret — undvik fluff.

STUDENTENS KONTEXT:
{context}

Aktuella orosflaggor (påverkar schemaläggning):
{concerns}
"""


def _build_context(user: User, db: Session) -> tuple[str, str]:
    """Returns (context_str, concerns_str) with student's full study picture."""
    lines = []

    # Exams
    exams = db.query(Exam).filter(Exam.user_id == user.id).order_by(Exam.exam_date).all()
    if exams:
        lines.append("=== TENTOR ===")
        today = date.today()
        for ex in exams:
            try:
                exam_date = datetime.strptime(ex.exam_date, "%Y-%m-%d").date()
                days_left = (exam_date - today).days
                days_str = f"({days_left} dagar kvar)" if days_left >= 0 else "(passerat)"
            except Exception:
                days_str = ""
            lines.append(f"• {ex.name} — {ex.exam_date} {days_str}")
            if ex.notes:
                lines.append(f"  Anteckningar: {ex.notes}")

    # Exam topics with mastery
    topics = db.query(ExamTopic).filter(ExamTopic.user_id == user.id).order_by(ExamTopic.mastery_score).all()
    if topics:
        lines.append("\n=== KURSÄMNEN & MASTRINGSNIVÅ ===")
        for t in topics:
            mastery_pct = round(t.mastery_score * 100) if t.mastery_score else 0
            lines.append(f"• [{t.subject}] {t.name} — {mastery_pct}% mastrat ({t.mastery_level})")

    # Decks with card counts
    decks = db.query(Deck).filter(Deck.user_id == user.id, Deck.is_active == True).all()
    if decks:
        lines.append("\n=== STUDIEKORTLEKAR ===")
        for deck in decks:
            card_count = db.query(Card).filter(Card.deck_id == deck.id).count()
            lines.append(f"• {deck.name}: {card_count} kort")

    # FSRS performance — due cards and struggling cards
    due_count = (
        db.query(CardState)
        .filter(
            CardState.user_id == user.id,
            CardState.due <= datetime.utcnow(),
        )
        .count()
    )
    if due_count > 0:
        lines.append(f"\n=== REPETITION ===\n• {due_count} kort förfallna för repetition just nu")

    # Documents
    docs = db.query(Document).filter(Document.user_id == user.id).all()
    if docs:
        lines.append("\n=== KURSDOKUMENT ===")
        for doc in docs:
            lines.append(f"• {doc.filename}")

    # Recent completed AI blocks (last 7 days)
    recent_blocks = (
        db.query(AIStudyBlock)
        .filter(
            AIStudyBlock.user_id == user.id,
            AIStudyBlock.completed == True,
            AIStudyBlock.completed_at >= datetime(datetime.utcnow().year, datetime.utcnow().month, datetime.utcnow().day),
        )
        .order_by(AIStudyBlock.completed_at.desc())
        .limit(10)
        .all()
    )
    if recent_blocks:
        lines.append("\n=== SENASTE STUDIEBLOCK (slutförda idag) ===")
        for b in recent_blocks:
            lines.append(f"• {b.topic or b.subject}: {b.block_type} ({b.duration_minutes} min)")

    context_str = "\n".join(lines) if lines else "Ingen studieinformation tillgänglig ännu."

    # Concerns from student profile
    profile = db.query(StudentProfile).filter(StudentProfile.user_id == user.id).first()
    concerns_str = ""
    if profile and getattr(profile, "tutor_concerns", None):
        concerns_str = profile.tutor_concerns
    else:
        concerns_str = "Inga aktiva orosflaggor."

    return context_str, concerns_str


def _build_messages(history: list[ChatMessage], new_message: str) -> list[dict]:
    """Build Anthropic messages list from history + new user message."""
    messages = []
    for msg in history:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": new_message})
    return messages


async def stream_tutor_response(
    user_id: int,
    user_message: str,
    history: list[dict],
    context_str: str,
    concerns_str: str,
) -> AsyncIterator[str]:
    """Yield text chunks from the tutor response. Accepts pre-built context (no DB needed)."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        yield "Fel: ANTHROPIC_API_KEY saknas."
        return

    system_prompt = TUTOR_SYSTEM_PROMPT.format(
        context=context_str,
        concerns=concerns_str,
    )

    messages = []
    for msg in history:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_message})

    client = anthropic.AsyncAnthropic(api_key=api_key)
    model = os.getenv("CLAUDE_MODEL", "claude-opus-4-5")

    async with client.messages.stream(
        model=model,
        max_tokens=1500,
        system=system_prompt,
        messages=messages,
    ) as stream:
        async for chunk in stream.text_stream:
            yield chunk


async def extract_and_save_concerns(
    user_id: int,
    assistant_response: str,
) -> None:
    """
    Ask Claude to extract any study concerns from the conversation and
    update the student profile's tutor_concerns field.
    Uses its own DB session since it runs as a background task.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return

    extract_prompt = f"""Analysera detta svar från en AI-handledare och extrahera eventuella studieoro, svaga ämnen eller stressmoment som nämndes.

Svar:
{assistant_response}

Returnera en kort punktlista (max 5 punkter) på svenska med konkreta orosflaggor, eller "Inga" om inga identifierades. Var specifik — nämn ämnen och problemtyper."""

    client = anthropic.AsyncAnthropic(api_key=api_key)
    model = os.getenv("CLAUDE_MODEL", "claude-opus-4-5")

    try:
        response = await client.messages.create(
            model=model,
            max_tokens=300,
            messages=[{"role": "user", "content": extract_prompt}],
        )
        concerns_text = response.content[0].text.strip()
        if concerns_text.lower() != "inga":
            db = SessionLocal()
            try:
                profile = db.query(StudentProfile).filter(StudentProfile.user_id == user_id).first()
                if profile:
                    existing = getattr(profile, "tutor_concerns", "") or ""
                    combined = f"{existing}\n{concerns_text}".strip()[-500:]
                    profile.tutor_concerns = combined
                    db.commit()
            finally:
                db.close()
    except Exception:
        pass  # Don't let concern extraction crash the tutor
