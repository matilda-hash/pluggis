"""
AI Tutor router — streaming chat with full course material context.
"""

import asyncio
import json
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import SessionLocal, get_db
from ..models import ChatMessage, User
from ..services.tutor import stream_tutor_response, extract_and_save_concerns, _build_context, _build_messages

router = APIRouter(prefix="/tutor", tags=["tutor"])


class ChatRequest(BaseModel):
    message: str


class ChatMessageOut(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/history", response_model=List[ChatMessageOut])
def get_history(
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return recent chat history for the current user."""
    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.user_id == current_user.id)
        .order_by(ChatMessage.created_at.asc())
        .limit(limit)
        .all()
    )
    return messages


@router.delete("/history")
def clear_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Clear all chat history for the current user."""
    db.query(ChatMessage).filter(ChatMessage.user_id == current_user.id).delete()
    db.commit()
    return {"ok": True}


@router.post("/chat")
async def chat(
    req: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stream a tutor response via SSE. Saves both messages to DB."""
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Meddelandet kan inte vara tomt.")

    # Extract everything from DB BEFORE returning StreamingResponse.
    # FastAPI closes the dependency-injected session when the endpoint returns,
    # so the generator must not reference `current_user` (ORM obj) or `db` after that.
    user_id = current_user.id

    history = (
        db.query(ChatMessage)
        .filter(ChatMessage.user_id == user_id)
        .order_by(ChatMessage.created_at.asc())
        .limit(20)
        .all()
    )

    # Pre-build context strings while session is still open
    context_str, concerns_str = _build_context(current_user, db)
    # Convert history to plain dicts (detach from session)
    history_dicts = [{"role": m.role, "content": m.content} for m in history]

    # Save user message while session is still open
    user_msg = ChatMessage(user_id=user_id, role="user", content=req.message.strip())
    db.add(user_msg)
    db.commit()

    message_text = req.message.strip()

    async def generate():
        full_response = []
        try:
            async for chunk in stream_tutor_response(
                user_id, message_text, history_dicts, context_str, concerns_str
            ):
                full_response.append(chunk)
                yield f"data: {json.dumps({'chunk': chunk})}\n\n"

            assistant_text = "".join(full_response)

            # Save assistant message using a fresh session (original may be closed)
            save_db = SessionLocal()
            try:
                save_db.add(ChatMessage(user_id=user_id, role="assistant", content=assistant_text))
                save_db.commit()
            finally:
                save_db.close()

            asyncio.create_task(extract_and_save_concerns(user_id, assistant_text))
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
