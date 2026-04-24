# LIVEFLUX — WebRTC Live Commerce Streaming Platform

A production-ready, low-latency live commerce streaming platform built with Python, FastAPI, WebRTC, and WebSockets.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Browser (Host)                       │
│  getUserMedia → RTCPeerConnection → WebSocket Signaling  │
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket (ws://)
                         ▼
┌─────────────────────────────────────────────────────────┐
│           FastAPI Signaling Server (Python)              │
│  • Session management   • ICE candidate relay           │
│  • SDP offer/answer     • Chat broadcast                │
│  • Viewer tracking      • Purchase notifications        │
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket (ws://)
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    Browser (Viewer)                      │
│  RTCPeerConnection → MediaStream → <video> element      │
└─────────────────────────────────────────────────────────┘
```

## Features

- **Low-latency WebRTC streaming** — sub-500ms peer-to-peer video/audio
- **FastAPI signaling server** — async WebSocket-based SDP/ICE relay
- **Session management** — unique session IDs, host/viewer roles
- **Live chat** — real-time broadcast to all session participants
- **Purchase intents** — viewers signal buy intent, host is notified
- **Connection stats** — RTT, packet loss, frame rate monitoring
- **ICE restart** — automatic recovery from connection drops
- **Multi-viewer** — one host streams to many concurrent viewers

## Quick Start

### macOS / Linux

```bash
chmod +x start.sh
./start.sh
```

### Windows

```
start.bat
```

### Manual

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Then open `http://localhost:8000` in your browser.

## Usage

### As a Host

1. Click **Go Live**
2. Fill in stream title, product details, and price
3. Click **Preview Camera & Go Live** — allow camera/microphone
4. Share the **Session ID** (shown bottom-left of your stream)
5. Viewers join using that ID — you'll see their count in real time

### As a Viewer

1. Click **Join Stream**
2. Enter your name and the Session ID
3. Watch the live stream, chat, and click **Buy Now** to signal intent

## Project Structure

```
webrtc-platform/
├── backend/
│   └── main.py              # FastAPI app + WebSocket signaling
├── frontend/
│   ├── static/
│   │   ├── css/style.css    # Full UI stylesheet
│   │   └── js/
│   │       ├── webrtc.js    # WebRTC connection manager
│   │       └── app.js       # Application logic
│   └── templates/
│       └── index.html       # Single-page app
├── requirements.txt
├── start.sh
├── start.bat
└── README.md
```

## WebRTC Signaling Flow

```
Viewer                  Server                   Host
  |                       |                        |
  |── join_session ───────►|                        |
  |◄── session_joined ─────|                        |
  |                       |──── viewer_joined ─────►|
  |── offer (SDP) ─────────►────────────────────────►|
  |                       |◄─── answer (SDP) ────────|
  |◄── answer (SDP) ───────|                        |
  |── ICE candidates ──────►──── ICE candidates ────►|
  |◄── ICE candidates ─────|◄─── ICE candidates ─────|
  |                       |                        |
  |◄════ Direct P2P WebRTC Stream ═════════════════►|
```

## Tech Stack

- **Backend**: Python 3.9+, FastAPI, Uvicorn, WebSockets
- **Frontend**: Vanilla JS, WebRTC API, WebSocket API
- **Fonts**: Bebas Neue, DM Sans, JetBrains Mono
- **No external media dependencies** — pure browser WebRTC

## Network Requirements

WebRTC requires both peers to be reachable via STUN. For production deployments behind symmetric NAT, add a TURN server to the `iceServers` config in `webrtc.js`
