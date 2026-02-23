from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from sqlalchemy import text

from .database import Base, engine, SessionLocal
from .models import User
from .routers import cards, decks, exams, reviews, stats, upload
from .routers import anki, calendar, schedule, documents, pre_lecture, tags, settings as settings_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create all tables on startup
    Base.metadata.create_all(bind=engine)

    # Safe migrations for new columns (SQLite ADD COLUMN is idempotent)
    with engine.connect() as conn:
        for stmt in [
            "ALTER TABLE cards ADD COLUMN is_keyword BOOLEAN NOT NULL DEFAULT 0",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # Column already exists

    # Seed default local user
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == 1).first()
        if not user:
            db.add(User(id=1, name="Local User", daily_goal=80))
            db.commit()
    finally:
        db.close()

    yield


app = FastAPI(
    title="Doktorn API",
    description="Medical study app – flashcards with FSRS spaced repetition",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Existing API routes
app.include_router(decks.router, prefix="/api")
app.include_router(cards.router, prefix="/api")
app.include_router(reviews.router, prefix="/api")
app.include_router(upload.router, prefix="/api")
app.include_router(stats.router, prefix="/api")
app.include_router(exams.router, prefix="/api")

# New orchestrator routes
app.include_router(anki.router, prefix="/api")
app.include_router(calendar.router, prefix="/api")
app.include_router(schedule.router, prefix="/api")
app.include_router(documents.router, prefix="/api")
app.include_router(pre_lecture.router, prefix="/api")
app.include_router(tags.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Doktorn"}
