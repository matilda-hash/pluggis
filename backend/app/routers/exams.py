"""
Exam management: CRUD + deck relevance scoring + AI study strategy.
"""

import json
import os
import re
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Deck, Exam, User
from ..schemas import ExamAnalyzeRequest, ExamAnalyzeResponse, ExamCreate, ExamOut, ExamUpdate

router = APIRouter(prefix="/exams", tags=["exams"])

_STOPWORDS = {
    "och", "i", "av", "på", "den", "det", "en", "ett", "till", "för", "med",
    "om", "är", "att", "tentamen", "tenta", "kurs", "prov", "examination",
    "the", "of", "in", "and", "to", "for", "exam", "course", "test",
}


def _tokenize(text: str) -> set[str]:
    words = set(re.findall(r"\w+", text.lower()))
    return {w for w in words if len(w) >= 3 and w not in _STOPWORDS}


def compute_relevance(exam_name: str, deck_name: str) -> float:
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
    today = date.today()
    days_remaining = (exam.exam_date.date() - today).days

    decks = db.query(Deck).filter(Deck.user_id == exam.user_id, Deck.is_active == True).all()
    relevant = [d.id for d in decks if compute_relevance(exam.name, d.name) > 0]

    out = ExamOut.model_validate(exam)
    out.days_remaining = days_remaining
    out.relevant_deck_ids = relevant
    return out


@router.get("/", response_model=List[ExamOut])
def list_exams(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exams = (
        db.query(Exam)
        .filter(Exam.user_id == current_user.id)
        .order_by(Exam.exam_date.asc())
        .all()
    )
    return [enrich_exam(e, db) for e in exams]


@router.post("/", response_model=ExamOut)
def create_exam(
    data: ExamCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exam = Exam(user_id=current_user.id, **data.model_dump())
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return enrich_exam(exam, db)


@router.put("/{exam_id}", response_model=ExamOut)
def update_exam(
    exam_id: int,
    data: ExamUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exam = db.query(Exam).filter(Exam.id == exam_id, Exam.user_id == current_user.id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Tentamen hittades inte")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(exam, field, value)
    db.commit()
    db.refresh(exam)
    return enrich_exam(exam, db)


_ANALYZE_SYSTEM = """Du är en studiestrategiassistent i Pluggis – en app för svenska studenter och läkarstudenter.

STEG 1 – IDENTIFIERA EXAMENSTYP OMEDELBART från användarens meddelande:
- "högskoleprovet", "HSP", "högskoleprov", "hogskoleprov" → exam_type = "hogskoleprovet"
- "anatomi", "histologi", "biokemi", "fysiologi", "läkarprogrammet", "termin", "medicinsk", "läkare", "tenta" → exam_type = "medical_school"
- Allt annat → exam_type = "general"

STEG 2 – STÄLL RIKTADE FÖLJDFRÅGOR (max 2 frågor totalt, 0 om du redan har tillräcklig info):
För högskoleprovet: Fråga vilka sektioner som är svårast (ORD, LÄS, MEK, NOG, DTK, ELF) och hur lång tid kvar.
För medicinsk tenta: Fråga vilket ämne/termin och om studenten har laddat upp föreläsningsmaterial i appen.
För general: Fråga om studenten har övningsprov tillgängliga och hur intensivt de vill studera.

STEG 3 – RETURNERA STRATEGI

Svara ALLTID på svenska. Returnera ALLTID giltig JSON i exakt ett av dessa format:

Om du behöver mer info:
{"done": false, "question": "Din fråga?", "options": ["Alt 1", "Alt 2", "Alt 3"]}

Om du är klar, returnera:
{"done": true, "strategy": { ... }}

STRATEGIFÄLT – inkludera ALLA dessa:
- exam_type: "hogskoleprovet" | "medical_school" | "general"
- study_type: "flashcards" | "practice_tests" | "mixed"
- no_flashcards: true/false
- practice_test_minutes: antal minuter per övningsprov
- daily_practice_tests: antal övningsprov per dag (0 om inte aktuellt)
- daily_hours_min: minsta antal studietimmar per dag (int)
- daily_hours_max: max antal studietimmar per dag (int)
- activities: array med aktivitetsmallar (se nedan)
- resources: array med specifika resurser (se nedan)
- weak_areas: array med svaga ämnen baserat på vad användaren nämnt
- summary: kort sammanfattning av strategin

AKTIVITETSMALLAR FÖR HÖGSKOLEPROVET (exam_type="hogskoleprovet"):
Sätt daily_hours_min=2, daily_hours_max=4, study_type="practice_tests", no_flashcards=true, practice_test_minutes=180.
Inkludera dessa activities (anpassa beskrivningar efter användarens svaga sektioner):
[
  {"block_type": "practice_test", "duration_minutes": 180, "label": "Fullständigt övningsprov", "description": "Gör ett komplett övningsprov (3 timmar) under tidsbegränsning – mobiltelefon av, inga avbrott, simulera verkliga tentaförhållanden. Anteckna vilka frågetyper du fastnar på."},
  {"block_type": "mistake_review", "duration_minutes": 45, "label": "Felgenomgång", "description": "Gå igenom varje fel från gårdagens övningsprov. Förstå exakt varför varje svar var fel – skriv ner det gemensamma mönstret för dina misstag."},
  {"block_type": "timed_drill", "duration_minutes": 25, "label": "Tidsbegränsad drill – NOG", "description": "Lös 15 NOG-frågor på 20 minuter utan att stanna upp. Rätta efteråt och notera vilka resonemang som gick snett."},
  {"block_type": "timed_drill", "duration_minutes": 30, "label": "Tidsbegränsad drill – LÄS", "description": "Gör 10 LÄS-frågor på 25 minuter. Markera svarstexten direkt i läspassagen – öva på att hitta svaret utan att tolka."},
  {"block_type": "active_recall", "duration_minutes": 20, "label": "Mönsteranalys", "description": "Ta fram dina anteckningar om vanliga fallgropar. Skriv ner 3 konkreta strategier du ska använda i nästa prov och läs dem högt."},
  {"block_type": "resource", "duration_minutes": 20, "label": "YouTube – kvantitativ del", "description": "Sök 'högskoleprovet NOG förklaring' på YouTube – välj ett video på 15-20 min. Titta passivt under lunchen, inga anteckningar behövs."}
]

AKTIVITETSMALLAR FÖR MEDICINSK TENTA (exam_type="medical_school"):
Sätt daily_hours_min=4, daily_hours_max=8, study_type="mixed", no_flashcards=false.
Aldrig passiv läsning som enda aktivitet. Inkludera dessa activities (anpassa ämne efter vad studenten anger):
[
  {"block_type": "active_recall", "duration_minutes": 60, "label": "Aktiv återkallning", "description": "Ta ett tomt papper. Skriv allt du kan om dagens ämne utan att titta i anteckningarna. Jämför sedan med dina anteckningar och markera luckor – gå igenom luckorna igen direkt."},
  {"block_type": "daily_repetition", "duration_minutes": 45, "label": "FSRS-repetition", "description": "Öppna appen och gå igenom dagens förfallna flashcards. Prioritera kort med betyget 'Igen' – förklara varje svar högt för dig själv innan du vänder kortet."},
  {"block_type": "case_study", "duration_minutes": 40, "label": "Fallstudie", "description": "En patient söker med symtom relaterade till dagens ämne. Vad är den underliggande mekanismen? Skriv ditt svar på ett papper, kontrollera sedan mot dina anteckningar och korrigera fel."},
  {"block_type": "timed_drill", "duration_minutes": 30, "label": "MCQ-drill", "description": "Sätt en timer på 20 minuter och lös 15 MCQ-frågor om dagens ämne utan hjälpmedel. Rätta efteråt och gå igenom varje fel individuellt."},
  {"block_type": "mistake_review", "duration_minutes": 30, "label": "Felkortsgranskning", "description": "Öppna appen och filtrera på kort med 'Igen'-betyg från senaste veckan. Gå igenom varje sådant kort och förklara rätt svar högt – om du inte kan förklara det, lägg det i en separat hög att repetera."},
  {"block_type": "resource", "duration_minutes": 25, "label": "Ninja Nerd – aktivt tittande", "description": "Sök 'Ninja Nerd [ämne]' på YouTube – välj första resultatet (vanligtvis 20-30 min). Pausa efter varje avsnitt och repetera nyckelbegreppen innan du fortsätter."}
]

AKTIVITETSMALLAR FÖR GENERAL (exam_type="general"):
Sätt daily_hours_min=2, daily_hours_max=4, study_type="mixed", no_flashcards=false.
[
  {"block_type": "active_recall", "duration_minutes": 45, "label": "Aktiv återkallning", "description": "Täck dina anteckningar och försök minnas allt om ämnet. Skriv ner, jämför sedan med originalet och gå igenom luckorna direkt."},
  {"block_type": "daily_repetition", "duration_minutes": 30, "label": "Flashcard-repetition", "description": "Gå igenom förfallna flashcards i appen. Fokusera extra på kort du svarat fel på tidigare."},
  {"block_type": "timed_drill", "duration_minutes": 30, "label": "Tidsbegränsad quiz", "description": "Sätt en timer på 20 minuter och lös övningsfrågor utan att titta i anteckningarna. Rätta efteråt och förstå varje fel."},
  {"block_type": "mistake_review", "duration_minutes": 25, "label": "Felgenomgång", "description": "Gå igenom alla fel från senaste övningspasset. Skriv ner varför varje svar var fel i dina egna ord."}
]

REGLER:
- Välj ALLTID rätt aktivitetsset baserat på exam_type – blanda INTE mallar
- Fyll i weak_areas med konkreta ämnen från vad användaren nämnt
- resources ska vara specifika: t.ex. "Sök 'Ninja Nerd renal physiology' på YouTube – 22 minuter, första resultatet"
- Returnera ENDAST JSON, inga förklaringar utanför JSON"""


@router.post("/{exam_id}/analyze", response_model=ExamAnalyzeResponse)
def analyze_exam_notes(
    exam_id: int,
    req: ExamAnalyzeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Use Claude to parse exam notes and build a study strategy via Q&A."""
    exam = db.query(Exam).filter(Exam.id == exam_id, Exam.user_id == current_user.id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Tentamen hittades inte")

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
        response = client.messages.create(
            model=os.getenv("CLAUDE_MODEL", "claude-opus-4-5"),
            max_tokens=2048,
            system=_ANALYZE_SYSTEM,
            messages=[{"role": m["role"], "content": m["content"]} for m in req.messages],
        )
        raw = response.content[0].text.strip()
        # Extract JSON from the response
        start = raw.find("{")
        end = raw.rfind("}") + 1
        parsed = json.loads(raw[start:end])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI-analys misslyckades: {e}")

    # Save strategy if done
    if parsed.get("done") and parsed.get("strategy"):
        exam.study_config = parsed["strategy"]
        # Also save the initial notes from the first user message
        if req.messages and req.messages[0]["role"] == "user":
            exam.notes = req.messages[0]["content"]
        db.commit()

    return ExamAnalyzeResponse(
        done=parsed.get("done", False),
        question=parsed.get("question"),
        options=parsed.get("options"),
        strategy=parsed.get("strategy"),
    )


@router.delete("/{exam_id}")
def delete_exam(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exam = db.query(Exam).filter(Exam.id == exam_id, Exam.user_id == current_user.id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Tentamen hittades inte")
    db.delete(exam)
    db.commit()
    return {"ok": True}
