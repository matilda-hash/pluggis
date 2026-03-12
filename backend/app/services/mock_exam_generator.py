"""
Mock Exam Generator — AI-generated practice exams targeting weak topics.
"""

import json
import os
from datetime import date

import anthropic

MOCK_EXAM_SYSTEM_PROMPT = """Du är en universitetsexaminator i medicin och naturvetenskap.
Generera en mock-tenta baserad på studentens svaga topics.

Frågorna ska vara:
- MCQ (5 alternativ, ett rätt) ELLER kort svar (1–3 meningar)
- Fokuserade på de angivna svaga topics – extra fokus på lågt mastery-score
- Kliniskt relevanta där möjligt
- Varierade i svårighet: lätt 30%, medel 50%, svår 20%
- På svenska

Returnera EXKLUSIVT ett JSON-objekt:
{
  "exam_title": "string",
  "duration_minutes": number,
  "instructions": "string",
  "sections": [
    {
      "subject": "string",
      "questions": [
        {
          "id": "Q1",
          "type": "mcq",
          "difficulty": "easy|medium|hard",
          "topic": "string",
          "question": "string",
          "options": ["A) ...", "B) ...", "C) ...", "D) ...", "E) ..."],
          "correct_answer": "string",
          "explanation": "string"
        }
      ]
    }
  ]
}

För short_answer: sätt options till null.
Förklaring på rätt svar är OBLIGATORISK – studenten ska lära sig av misstag."""


def generate_mock_exam(
    weak_topics: list,
    duration_minutes: int = 60,
    n_questions: int = 20,
    exam_name: str = "",
) -> dict:
    """
    Generate a mock exam targeting the weakest topics.
    weak_topics: list of topic dicts sorted by mastery_score ascending.
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

    topic_lines = "\n".join([
        f"- {t.get('name', '?')} ({t.get('subject', '?')}): "
        f"mastery {round(t.get('mastery_score', 0) * 100)}%, "
        f"genomsnittligt quizresultat {round(t.get('average_quiz_score', 0) * 100)}%"
        for t in weak_topics[:15]
    ])

    prompt = f"""Generera en {duration_minutes}-minuters mock-tenta med {n_questions} frågor.
{f'Tenta: {exam_name}' if exam_name else ''}

Studentens svagaste topics (fokusera extra på dessa):
{topic_lines}

Viktigt:
- Varje fråga ska ha topic-fältet satt till ett av de listade topic-namnen
- Förklaring på rätt svar är obligatorisk
- Minst 60% MCQ, resten short_answer
- Svara på svenska"""

    try:
        resp = client.messages.create(
            model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6"),
            max_tokens=5000,
            system=MOCK_EXAM_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip().rstrip("`").strip()
        start = raw.find("{")
        end = raw.rfind("}") + 1
        return json.loads(raw[start:end])
    except Exception as e:
        # Fallback: return minimal structure
        return {
            "exam_title": exam_name or "Mock-tenta",
            "duration_minutes": duration_minutes,
            "instructions": "Svara på alla frågor. Lyckligtvis!",
            "sections": [],
            "error": str(e),
        }


WEEKLY_CHECKIN_SYSTEM_PROMPT = """Du är Pluggis studiecoach. Analysera veckans studieprestationer ärligt och konstruktivt.
Var direkt men varm. Inga tomma komplimanger. Om det gick dåligt, säg det – och erbjud en konkret plan.
Svara på svenska.

Returnera EXKLUSIVT ett JSON-objekt:
{
  "week_summary": "string (2–3 meningar)",
  "hours_verdict": "string",
  "strongest_subject": {"subject": "string", "reason": "string"},
  "weakest_subject": {"subject": "string", "reason": "string"},
  "best_technique": "string",
  "exam_readiness": {
    "[subject]": {"score": 0-100, "trend": "up|down|stable", "comment": "string"}
  },
  "next_week_priority": "string",
  "honest_assessment": "string",
  "one_thing_to_change": "string"
}"""


def generate_weekly_checkin(week_data: dict) -> dict:
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

    context = f"""Vecka: {week_data.get('week_start')} – {week_data.get('week_end')}
Mål: {week_data.get('target_hours', 0)} timmar
Faktiska timmar: {week_data.get('actual_hours', 0)} timmar
Sessioner: {week_data.get('sessions_completed', 0)}/{week_data.get('sessions_scheduled', 0)}

Per ämne:
{json.dumps(week_data.get('by_subject', {}), indent=2, ensure_ascii=False)}

Topics som förföll utan review: {week_data.get('missed_reviews', 0)}
Använda tekniker: {json.dumps(week_data.get('technique_distribution', {}), ensure_ascii=False)}
Tentadatum: {json.dumps(week_data.get('exam_dates', {}), ensure_ascii=False)}"""

    try:
        resp = client.messages.create(
            model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6"),
            max_tokens=1500,
            system=WEEKLY_CHECKIN_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": context}],
        )
        raw = resp.content[0].text.strip()
        start = raw.find("{")
        end = raw.rfind("}") + 1
        return json.loads(raw[start:end])
    except Exception as e:
        return {
            "week_summary": "Analys tillfälligt otillgänglig.",
            "hours_verdict": "",
            "strongest_subject": {"subject": "", "reason": ""},
            "weakest_subject": {"subject": "", "reason": ""},
            "best_technique": "",
            "exam_readiness": {},
            "next_week_priority": "",
            "honest_assessment": "",
            "one_thing_to_change": "",
            "error": str(e),
        }
