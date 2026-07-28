@echo off
REM Starts the AI Voice Changer backend (FastAPI/uvicorn) and frontend (Vite) dev servers.
setlocal

set ROOT=%~dp0

REM The HF Xet transfer backend stalls on this network — force plain HTTPS
REM for any model downloads the app performs at runtime.
set HF_HUB_DISABLE_XET=1

REM Auto-reload is SCOPED, not blanket. A plain --reload watches everything
REM under backend/, which restarts the server (killing any running conversion)
REM whenever the RVC patcher rewrites the vendored library or a model download
REM lands — that's why it used to be off entirely.
REM
REM Watching only the request-handling code gets the benefit without that
REM problem: edit a route or a pydantic model and the server picks it up.
REM Without this, a changed model silently keeps serving the OLD schema —
REM pydantic drops fields it doesn't know about, so a new field just vanishes
REM on the wire with no error, which reads as a frontend bug and is miserable
REM to track down.
REM
REM Deliberately NOT watched: app/rvc_lib, app/services (model loading), and
REM .venv — the paths the patcher and downloads touch.
start "AI Voice Changer - Backend" cmd /k "cd /d "%ROOT%backend" && call .venv\Scripts\activate.bat && uvicorn app.main:app --port 8000 --reload --reload-dir app\api --reload-dir app\core --reload-dir app\motion_studio --reload-dir app\schemas --reload-dir app\subtitle_engine"

start "AI Voice Changer - Frontend" cmd /k "cd /d "%ROOT%frontend" && npm run dev"

endlocal
