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
from ..database import get_db
from ..models import ChatMessage, User
from ..services.tutor import stream_tutor_response, extract_and_save_concerns

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

    # Fetch last 20 messages as context (keeps prompt manageable)
    history = (
        db.query(ChatMessage)
        .filter(ChatMessage.user_id == current_user.id)
        .order_by(ChatMessage.created_at.asc())
        .limit(20)
        .all()
    )

    # Save user message immediately
    user_msg = ChatMessage(
        user_id=current_user.id,
        role="user",
        content=req.message.strip(),
    )
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)

    async def generate():
        full_response = []
        try:
            async for chunk in stream_tutor_response(current_user, req.message, history, db):
                full_response.append(chunk)
                # SSE format: data: <json>\n\n
                yield f"data: {json.dumps({'chunk': chunk})}\n\n"

            # Save assistant message
            assistant_text = "".join(full_response)
            assistant_msg = ChatMessage(
                user_id=current_user.id,
                role="assistant",
                content=assistant_text,
            )
            db.add(assistant_msg)
            db.commit()

            # Background concern extraction (non-blocking)
            asyncio.create_task(
                extract_and_save_concerns(current_user, assistant_text, db)
            )

            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
