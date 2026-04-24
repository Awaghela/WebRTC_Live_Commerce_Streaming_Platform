#!/usr/bin/env bash
set -e

echo "🎥 LIVEFLUX — WebRTC Live Commerce Platform"
echo "============================================"

# Check Python
if ! command -v python3 &>/dev/null; then
  echo "❌ Python 3 not found. Please install Python 3.9+"
  exit 1
fi

cd "$(dirname "$0")"

# Create virtual environment if needed
if [ ! -d ".venv" ]; then
  echo "📦 Creating virtual environment..."
  python3 -m venv .venv
fi

source .venv/bin/activate

echo "📦 Installing dependencies..."
pip install -r requirements.txt -q

echo ""
echo "✅ Starting server at http://localhost:8000"
echo "   Open your browser and navigate to http://localhost:8000"
echo "   Press Ctrl+C to stop"
echo ""

cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload --log-level info
