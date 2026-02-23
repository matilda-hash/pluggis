"""
Expanded flashcard generator supporting 11 card types.
Uses Claude API for generation. Each card gets rich tag metadata.

Card types:
  1.  definition_to_term      — given definition, recall term
  2.  term_to_definition      — given term, recall definition
  3.  single_cloze            — one blank per card
  4.  multi_cloze             — multiple blanks
  5.  true_false              — statement + T/F answer with explanation
  6.  cause_effect            — given cause, state effect
  7.  effect_cause            — given effect, state cause
  8.  light_scenario          — short clinical/scenario question
  9.  process_sequence        — recall steps of a process in order
  10. contrast_comparison     — compare two related concepts
  11. numerical_recall        — recall a number/statistic
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import List, Optional

import anthropic
from dotenv import load_dotenv

load_dotenv()

# Mapping from highlight priority to allowed types + card count multiplier
_PRIORITY_CONFIG = {
    "important": {
        "types": [
            "definition_to_term", "term_to_definition", "single_cloze", "multi_cloze",
            "true_false", "cause_effect", "effect_cause", "light_scenario",
            "process_sequence", "contrast_comparison", "numerical_recall",
        ],
        "multiplier": 1.5,
        "depth": "deep",
    },
    "difficult": {
        "types": [
            "light_scenario", "process_sequence", "contrast_comparison",
            "cause_effect", "effect_cause", "true_false", "multi_cloze",
        ],
        "multiplier": 1.2,
        "depth": "deep",
    },
    "low": {
        "types": ["definition_to_term", "term_to_definition", "single_cloze"],
        "multiplier": 0.6,
        "depth": "surface",
    },
}

_CARD_TYPE_DESCRIPTIONS = {
    "definition_to_term": "Given a definition or description, the student must recall the correct medical/scientific term",
    "term_to_definition": "Given a medical/scientific term, the student must explain or define it",
    "single_cloze": "A sentence with one key term replaced by {{blank}} that the student fills in",
    "multi_cloze": "A sentence with multiple key terms replaced by {{blank1}}, {{blank2}}, etc.",
    "true_false": "A statement that is either True or False, with an explanation on the back",
    "cause_effect": "Given a cause or mechanism, the student states the resulting effect or outcome",
    "effect_cause": "Given an observed effect or symptom, the student identifies the underlying cause",
    "light_scenario": "A short clinical scenario (1-2 sentences) followed by a focused question",
    "process_sequence": "A process or mechanism that must be recalled as numbered steps in correct order",
    "contrast_comparison": "A comparison between two related concepts, conditions, drugs, or mechanisms",
    "numerical_recall": "A specific number, statistic, threshold, or dose that must be recalled exactly",
}


class ExpandedCardGenerator:
    """Generate flashcards using Claude with full 11-type support and rich tagging."""

    def __init__(self):
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY not set in environment")
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

    # ── Public interface ───────────────────────────────────────────────────────

    def generate_from_highlights(
        self,
        highlights: list,
        document,
        deck_name: str,
        num_cards: int = 30,
    ) -> List[dict]:
        """
        Generate cards from document highlights.
        Priority drives card count, type selection, and conceptual depth.
        """
        if not highlights:
            return []

        # Group by priority
        by_priority: dict[str, list] = {"important": [], "difficult": [], "low": []}
        for h in highlights:
            p = h.priority if hasattr(h, "priority") else h.get("priority", "important")
            by_priority.setdefault(p, []).append(h)

        # Allocate cards proportionally
        total_weight = sum(
            len(hs) * _PRIORITY_CONFIG.get(p, _PRIORITY_CONFIG["important"])["multiplier"]
            for p, hs in by_priority.items() if hs
        )

        all_cards: List[dict] = []
        for priority, hs in by_priority.items():
            if not hs:
                continue
            cfg = _PRIORITY_CONFIG.get(priority, _PRIORITY_CONFIG["important"])
            weight = len(hs) * cfg["multiplier"]
            allocated = max(1, round(num_cards * weight / total_weight)) if total_weight > 0 else 0
            if allocated == 0:
                continue

            texts = [h.text_content if hasattr(h, "text_content") else h.get("text_content", "") for h in hs]
            combined_text = "\n\n".join(texts)

            cards = self._generate_cards_for_text(
                text=combined_text,
                deck_name=deck_name,
                num_cards=allocated,
                allowed_types=cfg["types"],
                depth=cfg["depth"],
                context_tag="#lecture",
                source_metadata={"document_title": document.title if hasattr(document, "title") else ""},
            )
            all_cards.extend(cards)

        return all_cards

    def generate_from_pdf(
        self,
        pdf_path: str,
        deck_name: str,
        num_cards: int = 40,
        context_tag: str = "#foundation",
    ) -> List[dict]:
        """Generate cards directly from a PDF file (all 11 types, balanced)."""
        pdf_bytes = Path(pdf_path).read_bytes()
        pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("utf-8")

        prompt = self._build_pdf_prompt(deck_name, num_cards)

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

        raw = _extract_json(message.content[0].text)
        if not raw:
            return []

        return [
            self._normalize_card(c, context_tag, {"source": "pdf", "filename": Path(pdf_path).name})
            for c in raw.get("cards", [])
            if self._is_valid_card(c)
        ]

    # ── Private helpers ────────────────────────────────────────────────────────

    def _generate_cards_for_text(
        self,
        text: str,
        deck_name: str,
        num_cards: int,
        allowed_types: List[str],
        depth: str,
        context_tag: str,
        source_metadata: dict,
    ) -> List[dict]:
        prompt = self._build_text_prompt(deck_name, text, num_cards, allowed_types, depth)

        message = self.client.messages.create(
            model=self.model,
            max_tokens=6000,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = _extract_json(message.content[0].text)
        if not raw:
            return []

        return [
            self._normalize_card(c, context_tag, source_metadata)
            for c in raw.get("cards", [])
            if self._is_valid_card(c)
        ]

    def _build_pdf_prompt(self, deck_name: str, num_cards: int) -> str:
        type_list = "\n".join(
            f"  - {t}: {desc}" for t, desc in _CARD_TYPE_DESCRIPTIONS.items()
        )
        return f"""You are a medical education expert creating study flashcards for: "{deck_name}".

Analyze the PDF and generate {num_cards} high-quality flashcards using a MIX of these 11 types:
{type_list}

Aim for roughly equal distribution across types where the content permits.

For each card, also assign:
- subject_tag: the main medical subject (e.g. "immunologi", "farmakologi", "anatomi")
- concept_tag: the specific concept (e.g. "t-celler", "beta-blockerare", "hjärtat")
- type_tag: the card type name from the list above
- context_tag: "#foundation" for basic science, "#lecture" for lecture-specific content
- tags: 2-7 total tags (Swedish preferred, e.g. "#immunologi", "#t-celler", "#foundation")

Return ONLY valid JSON (no markdown):
{{
  "cards": [
    {{
      "card_type": "term_to_definition",
      "front": "Vad är en T-hjälparcell?",
      "back": "En CD4+ T-cell som aktiverar B-celler och makrofager via cytokinsekretion",
      "subject_tag": "immunologi",
      "concept_tag": "t-celler",
      "type_tag": "term_to_definition",
      "context_tag": "#foundation",
      "tags": ["#immunologi", "#t-celler", "#lymfocyter", "#foundation", "#term_to_definition"]
    }},
    {{
      "card_type": "single_cloze",
      "cloze_text": "T-hjälparceller uttrycker ytmarkören {{{{CD4}}}} och aktiveras av MHC klass II",
      "subject_tag": "immunologi",
      "concept_tag": "t-celler",
      "type_tag": "single_cloze",
      "context_tag": "#foundation",
      "tags": ["#immunologi", "#t-celler", "#MHC", "#foundation", "#cloze"]
    }},
    {{
      "card_type": "true_false",
      "front": "Påstående: B-celler producerar antikroppar utan hjälp av T-celler.",
      "back": "FALSKT. De flesta B-celler kräver T-hjälparcellers signaler (CD40L + cytokiner) för full aktivering och klassomkoppling.",
      "subject_tag": "immunologi",
      "concept_tag": "b-celler",
      "type_tag": "true_false",
      "context_tag": "#foundation",
      "tags": ["#immunologi", "#b-celler", "#antikroppar", "#true_false", "#foundation"]
    }},
    {{
      "card_type": "light_scenario",
      "front": "En patient med HIV har CD4-tal <200/µL. Vilket opportunistiskt infektionsskydd saknar patienten primärt?",
      "back": "Cellmedierat immunförsvar (T-hjälparceller) — patienten är mottaglig för PCP, toxoplasmos, CMV m.fl.",
      "subject_tag": "immunologi",
      "concept_tag": "hiv-immunbrist",
      "type_tag": "light_scenario",
      "context_tag": "#lecture",
      "tags": ["#immunologi", "#hiv", "#cd4", "#opportunistiska-infektioner", "#light_scenario", "#lecture"]
    }}
  ]
}}"""

    def _build_text_prompt(
        self,
        deck_name: str,
        text: str,
        num_cards: int,
        allowed_types: List[str],
        depth: str,
    ) -> str:
        type_descriptions = "\n".join(
            f"  - {t}: {_CARD_TYPE_DESCRIPTIONS[t]}"
            for t in allowed_types
            if t in _CARD_TYPE_DESCRIPTIONS
        )
        depth_instruction = (
            "Go deep — include mechanisms, clinical implications, and nuanced distinctions."
            if depth == "deep"
            else "Keep it concise and focused on core facts."
        )

        return f"""You are a medical education expert creating flashcards for: "{deck_name}".

Generate {num_cards} flashcards from the following highlighted study text.
{depth_instruction}

Use ONLY these card types:
{type_descriptions}

Assign rich tags (Swedish preferred):
- subject_tag: main subject area
- concept_tag: specific concept
- type_tag: one of the allowed types above
- context_tag: "#foundation" or "#lecture"
- tags: list of 2-7 hashtag strings

Source text:
---
{text[:6000]}
---

Return ONLY valid JSON:
{{
  "cards": [
    {{
      "card_type": "<type>",
      "front": "<question or prompt>",
      "back": "<answer>",
      "cloze_text": "<only for cloze types, use {{{{term}}}} syntax>",
      "subject_tag": "...",
      "concept_tag": "...",
      "type_tag": "...",
      "context_tag": "...",
      "tags": ["#...", "#..."]
    }}
  ]
}}"""

    def _normalize_card(self, raw: dict, context_tag: str, source_metadata: dict) -> dict:
        """Normalize a raw card dict from Claude into our standard format."""
        card_type = raw.get("card_type", "basic")

        # Map legacy types
        if card_type == "basic":
            card_type = "term_to_definition"
        elif card_type == "cloze":
            card_type = "single_cloze"

        tags = raw.get("tags", [])
        if not isinstance(tags, list):
            tags = []

        return {
            "card_type": card_type,
            "front": raw.get("front", "").strip() or None,
            "back": raw.get("back", "").strip() or None,
            "cloze_text": raw.get("cloze_text", "").strip() or None,
            "subject_tag": raw.get("subject_tag"),
            "concept_tag": raw.get("concept_tag"),
            "type_tag": raw.get("type_tag", card_type),
            "context_tag": raw.get("context_tag", context_tag),
            "tags": tags[:7],  # cap at 7
            "source_metadata": {**source_metadata, **raw.get("source_metadata", {})},
        }

    def _is_valid_card(self, raw: dict) -> bool:
        card_type = raw.get("card_type", "")
        cloze_types = {"single_cloze", "multi_cloze", "cloze"}
        if card_type in cloze_types:
            return bool(raw.get("cloze_text", "").strip())
        return bool(raw.get("front", "").strip() and raw.get("back", "").strip())


# ── Helpers ────────────────────────────────────────────────────────────────────

def _extract_json(text: str) -> Optional[dict]:
    """Robustly extract JSON from Claude's response (handles markdown wrapping)."""
    start = text.find("{")
    end = text.rfind("}") + 1
    if start == -1 or end <= start:
        return None
    try:
        return json.loads(text[start:end])
    except json.JSONDecodeError:
        return None
