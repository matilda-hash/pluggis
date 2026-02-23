# Doktorn – Medical Study App

Flashcard system with FSRS spaced repetition, PDF→card generation via Claude AI.

## Quick Start

### 1. Add your Anthropic API key

Edit `backend/.env` and replace `your-api-key-here` with your key from console.anthropic.com.

### 2. Start the backend

Double-click **start-backend.bat**
→ API running at http://localhost:8000
→ API docs at http://localhost:8000/docs

### 3. Start the frontend

Double-click **start-frontend.bat**
→ App running at http://localhost:5173

---

## Project structure

```
doktorn/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app entry point
│   │   ├── models.py        # Database models (User, Deck, Card, Review...)
│   │   ├── schemas.py       # Pydantic request/response schemas
│   │   ├── routers/         # API endpoints
│   │   │   ├── decks.py     # Deck CRUD
│   │   │   ├── cards.py     # Card CRUD
│   │   │   ├── reviews.py   # Study queue + review submission
│   │   │   ├── upload.py    # PDF upload + Claude flashcard generation
│   │   │   └── stats.py     # Dashboard statistics
│   │   └── services/
│   │       ├── fsrs.py      # FSRS-4.5 spaced repetition algorithm
│   │       └── claude.py    # Anthropic API integration
│   └── doktorn.db           # SQLite database (auto-created)
│
└── frontend/
    └── src/
        ├── pages/
        │   ├── Dashboard.tsx  # Main dashboard
        │   ├── Study.tsx      # Study session
        │   ├── Upload.tsx     # PDF upload & card preview
        │   └── Cards.tsx      # Card management
        └── components/
```

## Card types supported

- **Basic** – Question front / Answer back
- **Cloze** – Text with `{{blank}}` for fill-in-the-blank

## FSRS algorithm

Each card has a **stability** (days until 90% recall chance) and **difficulty** (1–10).
After each review you choose: **Again / Hard / Good / Easy**.
The algorithm adjusts the next review date based on your answer.

States: New → Learning → Review ↔ Relearning
