@echo off
REM Opens a live progress display for the Chatterbox model download.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0download-status.ps1"
