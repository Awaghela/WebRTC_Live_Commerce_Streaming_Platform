@echo off
echo LIVEFLUX — WebRTC Live Commerce Platform
echo =========================================

where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Python not found. Please install Python 3.9+
    pause
    exit /b 1
)

cd /d "%~dp0"

if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
)

call .venv\Scripts\activate.bat

echo Installing dependencies...
pip install -r requirements.txt -q

echo.
echo Server starting at http://localhost:8000
echo Open your browser to http://localhost:8000
echo Press Ctrl+C to stop
echo.

cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
pause
