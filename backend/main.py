"""
WebRTC Live Commerce Streaming Platform
FastAPI Backend with WebSocket Signaling Server
"""

import json
import uuid
import asyncio
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, Set, Optional, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Project root (one level up from backend/)
BASE_DIR = Path(__file__).parent.parent

app = FastAPI(title="WebRTC Live Commerce Platform", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Data Models ────────────────────────────────────────────────────────────

class StreamSession:
    def __init__(self, host_id: str, title: str, product: dict):
        self.id = str(uuid.uuid4())[:8].upper()
        self.host_id = host_id
        self.title = title
        self.product = product
        self.viewers: Set[str] = set()
        self.created_at = datetime.utcnow()
        self.is_live = True
        self.viewer_count = 0
        self.chat_messages = []
        self.peak_viewers = 0

class ConnectionManager:
    def __init__(self):
        self.connections: Dict[str, WebSocket] = {}
        self.sessions: Dict[str, StreamSession] = {}
        self.peer_sessions: Dict[str, str] = {}
        self.peer_roles: Dict[str, str] = {}

    async def connect(self, peer_id: str, ws: WebSocket):
        await ws.accept()
        self.connections[peer_id] = ws
        logger.info(f"Peer connected: {peer_id}")

    def disconnect(self, peer_id: str):
        self.connections.pop(peer_id, None)
        session_id = self.peer_sessions.pop(peer_id, None)
        role = self.peer_roles.pop(peer_id, None)

        if session_id and session_id in self.sessions:
            session = self.sessions[session_id]
            session.viewers.discard(peer_id)
            session.viewer_count = len(session.viewers)
            if role == "host":
                session.is_live = False

        logger.info(f"Peer disconnected: {peer_id}")
        return session_id, role

    async def send_to(self, peer_id: str, message: dict):
        ws = self.connections.get(peer_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception as e:
                logger.error(f"Failed to send to {peer_id}: {e}")

    async def broadcast_to_session(self, session_id: str, message: dict, exclude: str = None):
        session = self.sessions.get(session_id)
        if not session:
            return
        targets = session.viewers | {session.host_id}
        for pid in list(targets):
            if pid != exclude and pid in self.connections:
                await self.send_to(pid, message)

    async def broadcast_viewer_count(self, session_id: str):
        session = self.sessions.get(session_id)
        if session:
            await self.broadcast_to_session(session_id, {
                "type": "viewer_count",
                "count": session.viewer_count,
                "peak": session.peak_viewers
            })

manager = ConnectionManager()

# ─── REST API ────────────────────────────────────────────────────────────────

class CreateStreamRequest(BaseModel):
    title: str
    product_name: str
    product_price: float
    product_description: str
    product_image: Optional[str] = ""

@app.get("/")
async def root():
    return FileResponse(BASE_DIR / "frontend/templates/index.html")

@app.get("/stream/{session_id}")
async def stream_page(session_id: str):
    return FileResponse(BASE_DIR / "frontend/templates/index.html")

@app.get("/api/sessions")
async def list_sessions():
    live = []
    for s in manager.sessions.values():
        if s.is_live:
            live.append({
                "id": s.id,
                "title": s.title,
                "product": s.product,
                "viewer_count": s.viewer_count,
                "started_at": s.created_at.isoformat()
            })
    return {"sessions": live}

@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    session = manager.sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "id": session.id,
        "title": session.title,
        "product": session.product,
        "viewer_count": session.viewer_count,
        "is_live": session.is_live,
        "started_at": session.created_at.isoformat()
    }

# ─── WebSocket Signaling ──────────────────────────────────────────────────────

@app.websocket("/ws/{peer_id}")
async def websocket_endpoint(ws: WebSocket, peer_id: str):
    await manager.connect(peer_id, ws)

    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get("type")

            if msg_type == "create_session":
                product = {
                    "name": data.get("product_name", "Featured Product"),
                    "price": data.get("product_price", 99.99),
                    "description": data.get("product_description", ""),
                    "image": data.get("product_image", "")
                }
                session = StreamSession(
                    host_id=peer_id,
                    title=data.get("title", "Live Stream"),
                    product=product
                )
                manager.sessions[session.id] = session
                manager.peer_sessions[peer_id] = session.id
                manager.peer_roles[peer_id] = "host"

                await manager.send_to(peer_id, {
                    "type": "session_created",
                    "session_id": session.id,
                })
                logger.info(f"Session created: {session.id}")

            elif msg_type == "join_session":
                session_id = data.get("session_id", "").upper()
                session = manager.sessions.get(session_id)

                if not session or not session.is_live:
                    await manager.send_to(peer_id, {
                        "type": "error",
                        "message": "Session not found or has ended"
                    })
                    continue

                session.viewers.add(peer_id)
                session.viewer_count = len(session.viewers)
                session.peak_viewers = max(session.peak_viewers, session.viewer_count)
                manager.peer_sessions[peer_id] = session_id
                manager.peer_roles[peer_id] = "viewer"

                await manager.send_to(peer_id, {
                    "type": "session_joined",
                    "session_id": session_id,
                    "title": session.title,
                    "product": session.product,
                    "host_id": session.host_id
                })

                await manager.send_to(session.host_id, {
                    "type": "viewer_joined",
                    "viewer_id": peer_id,
                    "viewer_count": session.viewer_count
                })

                await manager.broadcast_viewer_count(session_id)

            elif msg_type == "offer":
                target = data.get("target")
                if target:
                    await manager.send_to(target, {
                        "type": "offer",
                        "sdp": data.get("sdp"),
                        "from": peer_id
                    })

            elif msg_type == "answer":
                target = data.get("target")
                if target:
                    await manager.send_to(target, {
                        "type": "answer",
                        "sdp": data.get("sdp"),
                        "from": peer_id
                    })

            elif msg_type == "ice_candidate":
                target = data.get("target")
                if target:
                    await manager.send_to(target, {
                        "type": "ice_candidate",
                        "candidate": data.get("candidate"),
                        "from": peer_id
                    })

            elif msg_type == "chat_message":
                session_id = manager.peer_sessions.get(peer_id)
                if session_id:
                    session = manager.sessions.get(session_id)
                    role = manager.peer_roles.get(peer_id, "viewer")
                    msg = {
                        "type": "chat_message",
                        "from": peer_id,
                        "role": role,
                        "text": data.get("text", "")[:200],
                        "timestamp": datetime.utcnow().isoformat(),
                        "username": data.get("username", f"User-{peer_id[:4]}")
                    }
                    if session:
                        session.chat_messages.append(msg)
                        session.chat_messages = session.chat_messages[-100:]
                    await manager.broadcast_to_session(session_id, msg)

            elif msg_type == "purchase_intent":
                session_id = manager.peer_sessions.get(peer_id)
                if session_id:
                    session = manager.sessions.get(session_id)
                    if session:
                        await manager.send_to(session.host_id, {
                            "type": "purchase_notification",
                            "viewer_id": peer_id,
                            "product": session.product,
                            "username": data.get("username", f"User-{peer_id[:4]}")
                        })
                        await manager.broadcast_to_session(session_id, {
                            "type": "purchase_alert",
                            "username": data.get("username", f"User-{peer_id[:4]}"),
                            "product": session.product["name"]
                        })

            elif msg_type == "ping":
                await manager.send_to(peer_id, {"type": "pong"})

    except WebSocketDisconnect:
        session_id, role = manager.disconnect(peer_id)
        if session_id:
            await manager.broadcast_to_session(session_id, {
                "type": "peer_disconnected",
                "peer_id": peer_id,
                "role": role
            })
            await manager.broadcast_viewer_count(session_id)
    except Exception as e:
        logger.error(f"Error for peer {peer_id}: {e}")
        manager.disconnect(peer_id)

# ─── Static Files ─────────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "frontend/static")), name="static")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
