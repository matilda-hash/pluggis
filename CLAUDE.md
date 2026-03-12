# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Doktorn is a medical study app for Swedish medical students. It combines FSRS-4.5 spaced repetition flashcards with AI-powered card generation from PDFs, Google Calendar integration for lecture scheduling, and pre-lecture preparation tools.

## Development commands

### Backend (FastAPI + Python 3.12)
```bash
# From the backend/ directory:
cd backend
py -3.12 -m uvicorn app.main:app --reload --port 8000
```
API runs at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

### Frontend (React + Vite)
```bash
# From the frontend/ directory:
cd frontend
npm run dev      # dev server at http://localhost:5173
npm run build    # type-check + production build
```

Vite proxies all `/api/*` requests to `http://localhost:8000`, so frontend talks to backend without CORS issues in dev.

### Environment setup
Copy `backend/.env.example` to `backend/.env` and fill in:
- `ANTHROPIC_API_KEY` — required for PDF-to-card generation and pre-lecture AI features
- `DATABASE_URL` — defaults to SQLite (`sqlite:///./doktorn.db`); set to a `postgresql://` URL for Postgres
- `CLAUDE_MODEL` — defaults to `claude-opus-4-5`
- `SECRET_KEY` — JWT signing key (defaults to a dev value; set in production)

Install Python dependencies: `pip install -r backend/requirements.txt`

## Architecture

### Backend (`backend/app/`)

**Entry point:** `main.py` — registers all routers under `/api` prefix, applies CORS middleware, and runs safe ADD COLUMN migrations on startup (needed because SQLite doesn't support full ALTER TABLE).

**Database:** SQLAlchemy ORM with `database.py` providing `get_db()` as a FastAPI dependency. Defaults to SQLite; supports PostgreSQL via `DATABASE_URL`.

**Auth:** `auth.py` — JWT-based auth (HS256, 7-day tokens). `get_current_user` dependency enforces auth on protected routes; `get_optional_user` is for public endpoints. Passwords hashed with bcrypt via passlib.

**Models (`models.py`)** — key relationships:
- `User` owns `Deck`s; each `Deck` has `Card`s
- `CardState` holds the FSRS scheduling state (stability, difficulty, due date, state integer 0–3) — one row per card, updated on every review
- `Review` is an append-only log of every rating submitted
- `StudySession` tracks a session's aggregated counts (again/hard/good/easy)
- `Exam` drives the smart daily goal: nearest exam boosts how many cards to review
- `Lecture` + `StudyBlock` + `CalendarEvent` power the schedule planner
- `Document` + `DocumentHighlight` support PDF-to-readable-HTML with user highlights
- `GeneratedCardMeta` stores rich provenance metadata for AI-generated cards
- `TagDictionary` + `WeaknessMetrics` support tag-based weakness analysis

**Routers (`routers/`):**
| File | Prefix | Purpose |
|---|---|---|
| `auth.py` | `/auth` | Register, login, get current user |
| `decks.py` | `/decks` | Deck CRUD |
| `cards.py` | `/cards` | Card CRUD |
| `reviews.py` | `/study` | Study queue, review submission, session start/end |
| `upload.py` | `/upload` | PDF → flashcard generation via Claude |
| `stats.py` | `/stats` | Dashboard and per-deck statistics |
| `exams.py` | `/exams` | Exam CRUD (used by smart goal) |
| `documents.py` | `/documents` | PDF → readable HTML, highlights, card generation from highlights |
| `schedule.py` | `/schedule` | Study block generation and lecture management |
| `calendar.py` | `/calendar` | Google Calendar OAuth + sync |
| `pre_lecture.py` | `/pre-lecture` | AI-generated pre-lecture prep for a lecture |
| `anki.py` | `/anki` | AnkiConnect integration (export/import .apkg) |
| `tags.py` | `/tags` | Tag dictionary + weakness metrics |
| `settings.py` | `/settings` | User preferences |

**Services (`services/`):**
- `fsrs.py` — Pure Python FSRS-4.5 implementation. Core class is `FSRS`; call `fsrs.schedule(card, rating)` to get the next `CardState`. States: New(0) → Learning(1) → Review(2) ↔ Relearning(3). Ratings: Again(1) Hard(2) Good(3) Easy(4).
- `claude.py` — `ClaudeService.generate_flashcards(pdf_path, deck_name)` sends the PDF as base64 to the Anthropic API and returns normalized card dicts.
- `card_generator.py` — Extended card generation with tag metadata (`subject_tag`, `concept_tag`, `type_tag`, `context_tag`).
- `scheduler.py` — Logic for generating `StudyBlock` plans around lectures.
- `google_calendar.py` — Google OAuth flow and Calendar API calls.
- `pdf_converter.py` — PDF → structured HTML (for the Documents reader).
- `pre_lecture.py` — AI-generated prep content (quiz questions, what to listen for, YouTube suggestions).
- `anki_connect.py` / `anki_sync.py` — AnkiConnect HTTP API wrapper and .apkg import logic.

**Schemas (`schemas.py`):** Pydantic v2 models for all request/response types. `*Create`/`*Update` = input; `*Out` = serialized response.

### Frontend (`frontend/src/`)

Single-page React 18 app with React Router v6. All navigation is client-side under a shared `Layout` component.

**Pages:** Dashboard, Study (with optional `/:deckId`), Upload (PDF→cards), Cards (card management per deck), Schedule, Documents + DocumentViewer, PreLecture, Settings.

**API layer:** `services/api.ts` exports typed API modules (`decksApi`, `cardsApi`, `studyApi`, `uploadApi`, `statsApi`, `examsApi`, `ankiApi`, `calendarApi`, `scheduleApi`, `documentsApi`, `settingsApi`, `tagsApi`, `preLectureApi`) — all using an axios instance with `baseURL: '/api'`. Auth token is expected to be passed via Authorization header (check hooks for token management).

**Types:** `src/types/index.ts` — TypeScript interfaces mirroring backend schemas.

**Styling:** Tailwind CSS v3 with PostCSS.

## Deployment

**Backend → Railway:** `backend/railway.toml` + `backend/Procfile` configure the build. Set env vars: `DATABASE_URL` (Railway PostgreSQL), `SECRET_KEY`, `ANTHROPIC_API_KEY`, `FRONTEND_URL`, `BACKEND_URL`.

**Frontend → Vercel:** `frontend/vercel.json` rewrites all routes to `index.html` for SPA routing. Set `VITE_API_URL` to the Railway backend URL. The axios base URL in `api.ts` picks this up automatically; in dev it falls back to Vite's `/api` proxy.

**Google OAuth:** After deployment, update the redirect URI in Google Cloud Console to `https://your-backend.railway.app/api/calendar/auth/callback`. The backend reads `BACKEND_URL` to construct this URI dynamically.

## Key conventions

- All API routes are prefixed with `/api`. Frontend uses Vite proxy in dev; in production set `FRONTEND_URL` in backend env.
- The FSRS `CardState.state` column stores integers (0–3); cast with `State(int_value)` when constructing `FSRSCard`.
- New columns added to models must also be handled with a safe `ALTER TABLE ... ADD COLUMN` migration in `main.py`'s lifespan function, because SQLite doesn't support transactional schema changes.
- `is_keyword` flag on `Card` marks short keyword-definition cards (Swedish: *nyckelordskort*).
- Card tags are stored as JSON arrays in the `cards.tags` column; `GeneratedCardMeta` stores structured tags separately for AI-generated cards.
- The `ClaudeService` model is configurable via `CLAUDE_MODEL` env var; default is `claude-opus-4-5`.
