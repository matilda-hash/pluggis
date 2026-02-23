"""
PDF → structured HTML converter using pdfplumber.
Each paragraph/heading gets a unique data-block-id attribute so the
frontend can identify highlight ranges stably.
"""

from __future__ import annotations

import html
import statistics
from typing import List, Optional

import pdfplumber


class PDFConverter:
    """Convert a PDF file to structured, highlightable HTML."""

    def convert(self, pdf_path: str) -> str:
        """
        Return an HTML fragment (no <html>/<body> wrapper).
        Each text block has data-block-id="N" for highlight anchoring.
        """
        html_parts: List[str] = []
        block_id = 0

        with pdfplumber.open(pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages, start=1):
                html_parts.append(f'<div class="pdf-page" data-page="{page_num}">')

                # Extract words with bounding boxes
                words = page.extract_words(
                    x_tolerance=3,
                    y_tolerance=3,
                    keep_blank_chars=False,
                    use_text_flow=True,
                )

                # Extract tables first so we can skip their words
                tables = page.extract_tables()
                table_html = _render_tables(tables)

                if not words and not tables:
                    html_parts.append(
                        f'<p class="pdf-empty-page" data-block-id="{block_id}">'
                        f"[Page {page_num} — no extractable text]</p>"
                    )
                    block_id += 1
                    html_parts.append("</div>")
                    continue

                # Compute median font height for heading detection
                heights = [w.get("height", 10) for w in words if w.get("height")]
                median_h = statistics.median(heights) if heights else 10

                # Group words into lines by y-position
                lines = _group_into_lines(words)

                for line_words in lines:
                    line_text = " ".join(w["text"] for w in line_words)
                    if not line_text.strip():
                        continue

                    avg_h = statistics.mean(
                        w.get("height", median_h) for w in line_words
                    )
                    heading_level = _detect_heading(avg_h, median_h)
                    escaped = html.escape(line_text)

                    if heading_level:
                        html_parts.append(
                            f'<h{heading_level} class="pdf-heading" '
                            f'data-block-id="{block_id}">{escaped}</h{heading_level}>'
                        )
                    else:
                        html_parts.append(
                            f'<p class="pdf-para" data-block-id="{block_id}">{escaped}</p>'
                        )
                    block_id += 1

                # Append table HTML if any
                for t_html in table_html:
                    html_parts.append(
                        f'<div class="pdf-table" data-block-id="{block_id}">{t_html}</div>'
                    )
                    block_id += 1

                html_parts.append("</div>")  # .pdf-page

        return "\n".join(html_parts)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _group_into_lines(words: list, y_tolerance: float = 4.0) -> List[List[dict]]:
    """Group word dicts into lines based on their top y-coordinate."""
    if not words:
        return []

    # Sort by vertical position then horizontal
    sorted_words = sorted(words, key=lambda w: (round(w.get("top", 0) / y_tolerance), w.get("x0", 0)))

    lines: List[List[dict]] = []
    current_line: List[dict] = [sorted_words[0]]
    current_y = sorted_words[0].get("top", 0)

    for word in sorted_words[1:]:
        word_y = word.get("top", 0)
        if abs(word_y - current_y) <= y_tolerance * 2:
            current_line.append(word)
        else:
            lines.append(current_line)
            current_line = [word]
            current_y = word_y

    if current_line:
        lines.append(current_line)

    return lines


def _detect_heading(line_height: float, median_height: float) -> Optional[int]:
    """
    Return heading level (1, 2, or 3) based on font size ratio.
    Returns None for regular paragraphs.
    """
    if median_height <= 0:
        return None
    ratio = line_height / median_height
    if ratio >= 2.0:
        return 1
    if ratio >= 1.5:
        return 2
    if ratio >= 1.25:
        return 3
    return None


def _render_tables(tables: list) -> List[str]:
    """Convert pdfplumber table data to HTML table strings."""
    result = []
    for table in tables:
        if not table:
            continue
        rows_html = []
        for row_idx, row in enumerate(table):
            cells = []
            tag = "th" if row_idx == 0 else "td"
            for cell in row:
                cell_text = html.escape(str(cell or ""))
                cells.append(f"<{tag}>{cell_text}</{tag}>")
            rows_html.append(f"<tr>{''.join(cells)}</tr>")
        result.append(f"<table class='pdf-table-inner'>{''.join(rows_html)}</table>")
    return result
