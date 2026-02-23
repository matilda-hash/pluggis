"""
Claude API integration for PDF → flashcard generation.
Uses Claude's native PDF understanding to extract and structure flashcard content.
"""

import base64
import json
import os
from pathlib import Path
from typing import List

import anthropic
from dotenv import load_dotenv

load_dotenv()


class ClaudeService:
    def __init__(self):
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY not set in environment")
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = os.getenv("CLAUDE_MODEL", "claude-opus-4-5")

    def generate_flashcards(self, pdf_path: str, deck_name: str, num_cards: int = 40) -> List[dict]:
        """
        Read a PDF and generate flashcards using Claude's native PDF support.
        Returns a list of card dicts with keys: type, front, back, cloze_text.
        """
        pdf_bytes = Path(pdf_path).read_bytes()
        pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("utf-8")

        prompt = f"""You are a medical education expert creating study flashcards for the subject: "{deck_name}".

Analyze the provided PDF document carefully and generate high-quality flashcards covering all key concepts.

Generate approximately {num_cards} flashcards split between:
1. **Basic Q&A cards** – a clear question on the front, concise answer on the back
2. **Cloze deletion cards** – a sentence with the key term replaced by {{{{blank}}}}

Guidelines:
- Cover definitions, mechanisms, clinical features, treatments, and mnemonics
- Make each card atomic (one concept per card)
- Front/question should be specific and unambiguous
- Back/answer should be concise but complete
- For cloze, use {{{{term}}}} for the blank (double curly braces)
- Prioritize clinically important and exam-relevant content

Return ONLY a valid JSON object with no extra text, in this exact format:
{{
  "cards": [
    {{
      "type": "basic",
      "front": "What is the primary mechanism of beta-lactam antibiotics?",
      "back": "Inhibition of bacterial cell wall synthesis by binding to penicillin-binding proteins (PBPs), preventing peptidoglycan cross-linking"
    }},
    {{
      "type": "cloze",
      "text": "The {{{{aortic valve}}}} separates the left ventricle from the aorta"
    }}
  ]
}}"""

        message = self.client.messages.create(
            model=self.model,
            max_tokens=8192,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "document",
                            "source": {
                                "type": "base64",
                                "media_type": "application/pdf",
                                "data": pdf_b64,
                            },
                        },
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
        )

        response_text = message.content[0].text

        # Extract JSON robustly – Claude sometimes wraps it in markdown
        start = response_text.find("{")
        end = response_text.rfind("}") + 1
        if start == -1 or end <= start:
            return []

        try:
            data = json.loads(response_text[start:end])
            raw_cards = data.get("cards", [])
        except json.JSONDecodeError:
            return []

        # Normalise and validate cards
        cards = []
        for c in raw_cards:
            card_type = c.get("type", "basic")
            if card_type == "cloze":
                text = c.get("text", "").strip()
                if "{{" in text and "}}" in text:
                    cards.append({"card_type": "cloze", "cloze_text": text})
            else:
                front = c.get("front", "").strip()
                back = c.get("back", "").strip()
                if front and back:
                    cards.append({"card_type": "basic", "front": front, "back": back})

        return cards
