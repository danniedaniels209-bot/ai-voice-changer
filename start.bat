@echo off
REM Starts the AI Voice Changer backend (FastAPI/uvicorn) and frontend (Vite) dev servers.
setlocal

set ROOT=%~dp0

REM The HF Xet transfer backend stalls on this network — force plain HTTPS
REM for any model downloads the app performs at runtime.
set HF_HUB_DISABLE_XET=1

REM No --reload: the auto-reload watcher restarts the server (killing any
REM running conversion) when the RVC library rewrites its own files at startup.
start "AI Voice Changer - Backend" cmd /k "cd /d "%ROOT%backend" && call .venv\Scripts\activate.bat && uvicorn app.main:app --port 8000"

start "AI Voice Changer - Frontend" cmd /k "cd /d "%ROOT%frontend" && npm run dev"

endlocal
